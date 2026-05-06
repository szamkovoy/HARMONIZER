# PATCH 5 [P1]: Сужение RLS-политик для целостности данных

## Что не так

Согласно аудиту:

> RLS включён для всех новых таблиц, но часть политик широковата:
> - `user_natal_charts` и `user_daily_forecasts` имеют `FOR ALL` для владельца → клиент с пользовательским JWT может писать в эти кеши напрямую через PostgREST.
> - `ai_state_proposals_update_own` позволяет владельцу обновлять не только `status`, но потенциально и содержимое предложения.

Это **integrity-риски**, не утечки. Клиент может:
- Подменить свой натальный профиль через прямой UPDATE → следующий прогноз будет посчитан на испорченных данных.
- Изменить дневной прогноз → видеть неправильные рекомендации.
- Изменить AI-предложение состояния → подсунуть в свой states_map любые слова.

Нужно ограничить запись только бэкендом (service_role).

## Файлы для изменения

Создать новую миграцию: `supabase/migrations/<timestamp>_tighten_rls_policies.sql`

## Конкретные SQL-изменения

```sql
-- ============================================================================
-- Migration: Tighten RLS policies for cache and proposal tables
-- ============================================================================

-- =============================================
-- 1. user_natal_charts — только чтение для владельца
-- =============================================
-- Натальный профиль пишет только бэкенд через service_role.
-- Клиент должен только читать.

DROP POLICY IF EXISTS user_natal_charts_self ON public.user_natal_charts;
DROP POLICY IF EXISTS natal_charts_select_own ON public.user_natal_charts;
DROP POLICY IF EXISTS natal_charts_all_own ON public.user_natal_charts;

CREATE POLICY natal_charts_select_own ON public.user_natal_charts 
  FOR SELECT USING (user_id = auth.uid());

-- INSERT/UPDATE/DELETE — только service_role (по умолчанию обходит RLS).
-- Клиент с anon/authenticated не сможет менять.

-- =============================================
-- 2. user_daily_forecasts — только чтение для владельца
-- =============================================

DROP POLICY IF EXISTS daily_forecasts_self ON public.user_daily_forecasts;
DROP POLICY IF EXISTS daily_forecasts_select_own ON public.user_daily_forecasts;
DROP POLICY IF EXISTS daily_forecasts_all_own ON public.user_daily_forecasts;

CREATE POLICY daily_forecasts_select_own ON public.user_daily_forecasts 
  FOR SELECT USING (user_id = auth.uid());

-- =============================================
-- 3. ai_state_proposals — UPDATE только status и responded_at, не payload
-- =============================================
-- Клиент может только подтвердить/отвергнуть proposal, но не менять его содержимое.
-- Используем колонку-уровневую защиту через CHECK + GRANT.

DROP POLICY IF EXISTS proposals_update_own ON public.ai_state_proposals;
DROP POLICY IF EXISTS ai_state_proposals_update_own ON public.ai_state_proposals;
DROP POLICY IF EXISTS ai_state_proposals_self ON public.ai_state_proposals;

-- Чтение — своё
CREATE POLICY proposals_select_own ON public.ai_state_proposals 
  FOR SELECT USING (user_id = auth.uid());

-- UPDATE с проверкой что меняется только status и responded_at
-- Postgres RLS не поддерживает column-level update directly через USING,
-- поэтому используем триггер для защиты неизменяемых полей.

CREATE POLICY proposals_update_own ON public.ai_state_proposals 
  FOR UPDATE 
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND status IN ('pending', 'accepted', 'rejected', 'expired')
  );

-- Триггер защищает immutable поля от изменения
CREATE OR REPLACE FUNCTION protect_proposal_content()
RETURNS TRIGGER AS $$
BEGIN
  -- Если запрос идёт от authenticated user (не service_role) и меняются content-поля → ошибка
  IF current_setting('request.jwt.claims', true)::json->>'role' = 'authenticated' THEN
    IF NEW.proposed_planet IS DISTINCT FROM OLD.proposed_planet
       OR NEW.proposed_label IS DISTINCT FROM OLD.proposed_label
       OR NEW.proposed_polarity IS DISTINCT FROM OLD.proposed_polarity
       OR NEW.trigger_phrase IS DISTINCT FROM OLD.trigger_phrase
       OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
      RAISE EXCEPTION 'Only status and responded_at can be modified by user';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS proposals_protect_content ON public.ai_state_proposals;
CREATE TRIGGER proposals_protect_content
  BEFORE UPDATE ON public.ai_state_proposals
  FOR EACH ROW
  EXECUTE FUNCTION protect_proposal_content();

-- INSERT и DELETE — только через service_role, у клиента нет policy

-- =============================================
-- 4. user_event_log — запись через service_role, чтение/удаление для владельца ОК
-- =============================================
-- (опционально — обсуждалось в аудите)
-- Если клиент должен писать события напрямую — оставляем как есть.
-- Если нет — сужаем INSERT до service_role.

-- Текущая политика user_event_log_self FOR ALL — оставляем,
-- потому что некоторые клиентские события (нажатия кнопок) пишутся напрямую.
-- Но добавим комментарий-предупреждение в схеме.

COMMENT ON TABLE public.user_event_log IS 
  'User event log. Клиент может писать свои события (UI clicks, etc.). Системные события пишет backend через service_role.';
```

## Влияние на существующий код

После применения миграции:

1. **`/api/astro/natal/route.ts`** должен использовать `createServiceSupabase()` (а не клиента с user JWT) при INSERT в `user_natal_charts`. Проверить, что это так.

2. **`/api/astro/daily-forecast/route.ts`** аналогично — INSERT/UPDATE через service_role.

3. **`/api/communicator/v2/dialog/route.ts`** при работе с `ai_state_proposals`:
   - INSERT новых предложений — через service_role (это уже так в аудите).
   - При accepting/rejecting со стороны клиента — должно идти через специальный endpoint (см. ниже), а не прямой UPDATE.

4. **Подтверждение/отказ предложений со стороны клиента** — нужен новый endpoint:

```typescript
// _legacy_web/app/api/proposals/[id]/respond/route.ts

export async function POST(req, { params }) {
  const userId = await validateJwt(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  
  const { action } = await req.json();  // "accept" | "reject"
  if (!["accept", "reject"].includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
  
  const supabase = createServiceSupabase();  // service role!
  
  const { data, error } = await supabase
    .from("ai_state_proposals")
    .update({
      status: action === "accept" ? "accepted" : "rejected",
      responded_at: new Date().toISOString()
    })
    .eq("id", params.id)
    .eq("user_id", userId)  // важно: проверка владельца
    .select()
    .single();
  
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  
  // Если accepted — добавить в states_map активной калибровки
  if (action === "accept") {
    await addStateToActiveCalibration(supabase, userId, data);
  }
  
  return NextResponse.json({ success: true, proposal: data });
}
```

И на клиенте — заменить прямой `supabase.from("ai_state_proposals").update(...)` на вызов этого endpoint.

## Тесты RLS

Создать `supabase/tests/rls.test.sql` (Supabase поддерживает PgTAP-стиль тесты):

```sql
-- Test: user can read own natal chart
SELECT auth.set_jwt_claims_for_test('{"sub": "test-user-1", "role": "authenticated"}');

INSERT INTO public.user_natal_charts (user_id, version, ...) 
  VALUES ('test-user-1', 1, ...);

-- ⚠️ Этот INSERT с user JWT должен ПАДАТЬ:
EXPECT_EXCEPTION 'permission denied' WHEN
  INSERT INTO public.user_natal_charts (user_id, version, ...) 
    VALUES ('test-user-1', 2, ...);
```

Альтернатива — TypeScript интеграционный тест с двумя клиентами Supabase (anon и service_role):

```typescript
import { createClient } from "@supabase/supabase-js";

describe("RLS: user_natal_charts", () => {
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  beforeEach(async () => {
    // Создаём тестового пользователя через serviceClient
    // ...
  });
  
  it("user CAN read own chart", async () => {
    const { data, error } = await userClient
      .from("user_natal_charts")
      .select()
      .eq("user_id", testUserId);
    expect(error).toBeNull();
    expect(data).toBeDefined();
  });
  
  it("user CANNOT insert own chart directly", async () => {
    const { error } = await userClient
      .from("user_natal_charts")
      .insert({ user_id: testUserId, version: 99, /* ... */ });
    expect(error).toBeDefined();
    expect(error.code).toBe("42501"); // permission denied
  });
  
  it("user CANNOT update own chart directly", async () => {
    const { error } = await userClient
      .from("user_natal_charts")
      .update({ version: 99 })
      .eq("user_id", testUserId);
    expect(error).toBeDefined();
  });
  
  it("service_role CAN insert chart", async () => {
    const { error } = await serviceClient
      .from("user_natal_charts")
      .insert({ user_id: testUserId, version: 99, /* ... */ });
    expect(error).toBeNull();
  });
});

// Аналогично для user_daily_forecasts и ai_state_proposals
```

## Откат миграции (на случай проблем)

```sql
-- Если что-то пошло не так, откатываем к FOR ALL
DROP POLICY natal_charts_select_own ON public.user_natal_charts;
CREATE POLICY natal_charts_self ON public.user_natal_charts FOR ALL USING (user_id = auth.uid());

DROP POLICY daily_forecasts_select_own ON public.user_daily_forecasts;
CREATE POLICY daily_forecasts_self ON public.user_daily_forecasts FOR ALL USING (user_id = auth.uid());

DROP TRIGGER proposals_protect_content ON public.ai_state_proposals;
DROP FUNCTION protect_proposal_content();
DROP POLICY proposals_update_own ON public.ai_state_proposals;
CREATE POLICY proposals_update_own ON public.ai_state_proposals FOR UPDATE USING (user_id = auth.uid());
```

## Как проверить

1. Применить миграцию.
2. Запустить интеграционные RLS-тесты — должны проходить.
3. Открыть приложение, выполнить полный пользовательский сценарий: регистрация → калибровка → дневной прогноз → диалог → принять proposal. Всё должно работать.
4. Попробовать через Supabase Dashboard SQL Editor с `set role authenticated` сделать `UPDATE user_natal_charts` — должна быть ошибка permission denied.

## Критерий приёмки

- ✅ Миграция применяется без ошибок.
- ✅ Все эндпоинты, которые писали в `user_natal_charts` / `user_daily_forecasts`, используют `createServiceSupabase()`.
- ✅ Подтверждение/отказ AI-proposals идёт через `/api/proposals/[id]/respond`, не прямым клиентским update.
- ✅ Интеграционные RLS-тесты проходят.
- ✅ Существующий пользовательский функционал не сломан.
