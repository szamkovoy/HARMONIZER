# PATCH 6 [P1]: Исправление «вечного pending» в auto-calibrate

## Что не так

В `supabase/functions/auto-calibrate/index.ts` функция `isPendingProposal()` блокирует автокалибровку, если в `users.user_settings.preferences.autoCalibrationProposal` есть запись со статусом `pending`. Условие проверки:

```typescript
function isPendingProposal(proposal): boolean {
  if (!proposal) return false;
  if (proposal.status !== "pending") return false;
  // ⚠️ Если expiresAt отсутствует — считаем proposal активным навсегда
  if (!proposal.expiresAt || new Date(proposal.expiresAt) > new Date()) {
    return true;
  }
  return false;
}
```

Проблема в условии `!proposal.expiresAt || ...` — это **OR**, а не **AND**:
- Если `expiresAt` отсутствует → `!proposal.expiresAt` = true → возвращает true.
- Получается: proposal без expiresAt блокирует автокалибровку **навсегда**.

## Эффект

Любая запись `autoCalibrationProposal` без поля `expiresAt`:
- ручная вставка через админку,
- старые записи до того, как `expiresAt` стал обязательным,
- баг при создании,

— приводит к тому, что у пользователя **никогда** не сработает автокалибровка. Cron будет каждый день видеть `proposal_already_pending` и пропускать.

## Файлы для изменения

1. `supabase/functions/auto-calibrate/index.ts` — функция `isPendingProposal()`.
2. Место создания proposal — гарантировать `expiresAt`.
3. Опционально: миграция данных для существующих пользователей.

## Конкретные изменения

### 1. Исправление логики `isPendingProposal()`

```typescript
const PROPOSAL_TTL_DAYS = 14;
const FALLBACK_TTL_DAYS = 30;  // для proposal без expiresAt — считаем «протухшим» через 30 дней с момента создания

interface AutoCalibrationProposal {
  status: "pending" | "accepted" | "rejected" | "expired";
  createdAt?: string;
  expiresAt?: string;
  digestId?: string;
}

function isPendingProposal(proposal?: AutoCalibrationProposal): boolean {
  if (!proposal) return false;
  if (proposal.status !== "pending") return false;
  
  const now = new Date();
  
  // Если есть expiresAt — используем его
  if (proposal.expiresAt) {
    return new Date(proposal.expiresAt) > now;
  }
  
  // Если expiresAt отсутствует — fallback на createdAt + 30 дней
  if (proposal.createdAt) {
    const fallbackExpiry = new Date(proposal.createdAt);
    fallbackExpiry.setDate(fallbackExpiry.getDate() + FALLBACK_TTL_DAYS);
    return fallbackExpiry > now;
  }
  
  // Если нет ни expiresAt, ни createdAt — считаем proposal сломанным, не блокируем
  console.warn("[auto-calibrate] Found proposal without expiresAt or createdAt, ignoring", proposal);
  return false;
}
```

**Логика:**
- `expiresAt` есть → действует до этой даты.
- `expiresAt` нет, но есть `createdAt` → действует 30 дней с момента создания.
- Нет ни того, ни другого → proposal сломан, не блокирует. Логируем warning для диагностики.

### 2. Гарантировать создание `expiresAt`

В месте, где создаётся proposal (вероятно тот же `auto-calibrate/index.ts`):

```typescript
const PROPOSAL_TTL_DAYS = 14;

async function createProposal(supabase, userId, digest) {
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + PROPOSAL_TTL_DAYS);
  
  const proposal: AutoCalibrationProposal = {
    status: "pending",
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),  // ← ВСЕГДА проставляем
    digestId: digest.id,
  };
  
  // Получаем текущие preferences
  const { data: user } = await supabase
    .from("users")
    .select("user_settings")
    .eq("id", userId)
    .single();
  
  const preferences = user.user_settings?.preferences ?? {};
  preferences.autoCalibrationProposal = proposal;
  
  await supabase
    .from("user_settings")
    .update({ preferences })
    .eq("user_id", userId);
}
```

### 3. Миграция существующих сломанных данных

Создать миграцию `supabase/migrations/<timestamp>_fix_proposals_missing_expires_at.sql`:

```sql
-- Migration: Fix auto-calibration proposals missing expiresAt
-- 
-- Для всех users с preferences.autoCalibrationProposal без expiresAt — 
-- проставляем expiresAt = createdAt + 14 days, или now() + 1 day если нет createdAt.

UPDATE public.user_settings us
SET preferences = jsonb_set(
  preferences,
  '{autoCalibrationProposal,expiresAt}',
  to_jsonb(
    COALESCE(
      (preferences->'autoCalibrationProposal'->>'createdAt')::timestamptz + interval '14 days',
      now() + interval '1 day'  -- если нет createdAt — даём 1 день, чтобы пользователь успел отреагировать
    )::text
  )
)
WHERE preferences->'autoCalibrationProposal' IS NOT NULL
  AND preferences->'autoCalibrationProposal'->>'status' = 'pending'
  AND preferences->'autoCalibrationProposal'->'expiresAt' IS NULL;

-- Подсчёт исправленных
DO $$
DECLARE 
  fixed_count int;
BEGIN
  SELECT COUNT(*) INTO fixed_count
  FROM public.user_settings 
  WHERE preferences->'autoCalibrationProposal'->>'status' = 'pending'
    AND preferences->'autoCalibrationProposal'->>'expiresAt' IS NOT NULL;
  
  RAISE NOTICE 'Fixed % proposals with missing expiresAt', fixed_count;
END $$;
```

### 4. Cooldown после rejected

Аудит также упомянул:
> Если пользователь отклонит proposal, отдельного cooldown по rejected-статусу не видно, можно повторно предложить калибровку при следующем проходе.

Добавляем cooldown — после rejected не предлагаем новую автокалибровку 30 дней:

```typescript
const REJECTED_COOLDOWN_DAYS = 30;

function isRejectedRecently(proposal?: AutoCalibrationProposal): boolean {
  if (!proposal) return false;
  if (proposal.status !== "rejected") return false;
  
  const respondedAt = proposal.respondedAt ?? proposal.createdAt;
  if (!respondedAt) return false;
  
  const cooldownEnd = new Date(respondedAt);
  cooldownEnd.setDate(cooldownEnd.getDate() + REJECTED_COOLDOWN_DAYS);
  
  return cooldownEnd > new Date();
}

// В processCalibration():
if (isPendingProposal(currentProposal)) {
  return { status: "skipped", reason: "proposal_already_pending" };
}
if (isRejectedRecently(currentProposal)) {
  return { status: "skipped", reason: "rejected_cooldown" };
}
```

## Тесты

```typescript
// supabase/functions/auto-calibrate/proposal.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isPendingProposal, isRejectedRecently } from "./proposal";

describe("isPendingProposal", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  
  it("returns false for null/undefined", () => {
    expect(isPendingProposal(null)).toBe(false);
    expect(isPendingProposal(undefined)).toBe(false);
  });
  
  it("returns false for non-pending status", () => {
    expect(isPendingProposal({ status: "accepted", expiresAt: "2099-01-01T00:00:00Z" })).toBe(false);
    expect(isPendingProposal({ status: "rejected" })).toBe(false);
    expect(isPendingProposal({ status: "expired" })).toBe(false);
  });
  
  it("uses expiresAt when available", () => {
    vi.setSystemTime(new Date("2026-04-29T00:00:00Z"));
    
    expect(isPendingProposal({ status: "pending", expiresAt: "2026-05-01T00:00:00Z" })).toBe(true);
    expect(isPendingProposal({ status: "pending", expiresAt: "2026-04-28T00:00:00Z" })).toBe(false);
  });
  
  it("falls back to createdAt + 30 days when expiresAt missing", () => {
    vi.setSystemTime(new Date("2026-04-29T00:00:00Z"));
    
    // Создан 10 дней назад → ещё не протух (30-day fallback)
    expect(isPendingProposal({ status: "pending", createdAt: "2026-04-19T00:00:00Z" })).toBe(true);
    
    // Создан 40 дней назад → протух
    expect(isPendingProposal({ status: "pending", createdAt: "2026-03-19T00:00:00Z" })).toBe(false);
  });
  
  it("returns false for proposal without expiresAt and createdAt", () => {
    expect(isPendingProposal({ status: "pending" } as any)).toBe(false);
  });
});

describe("isRejectedRecently", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  
  it("returns true within 30 days of rejection", () => {
    vi.setSystemTime(new Date("2026-04-29T00:00:00Z"));
    expect(isRejectedRecently({ 
      status: "rejected", 
      respondedAt: "2026-04-15T00:00:00Z" 
    })).toBe(true);
  });
  
  it("returns false after 30 days", () => {
    vi.setSystemTime(new Date("2026-04-29T00:00:00Z"));
    expect(isRejectedRecently({ 
      status: "rejected", 
      respondedAt: "2026-03-15T00:00:00Z" 
    })).toBe(false);
  });
});
```

## Как проверить

1. Развернуть на test environment.
2. В админке вручную создать пользователя с `preferences.autoCalibrationProposal = { status: "pending" }` (без `expiresAt`, без `createdAt`).
3. Запустить cron вручную → должен пройти, не зацикливаться.
4. Создать другого пользователя с `preferences.autoCalibrationProposal = { status: "pending", createdAt: "2026-01-01T00:00:00Z" }` (40+ дней назад).
5. Запустить cron → fallback должен сработать, proposal не блокирует.
6. Запустить миграцию данных → проверить, что old proposals получили expiresAt.

## Критерий приёмки

- ✅ Сломанные proposals (без `expiresAt`) больше не блокируют автокалибровку навсегда.
- ✅ После rejected — 30-дневный cooldown.
- ✅ Все новые proposals создаются с явным `expiresAt`.
- ✅ Миграция данных применена к существующим пользователям.
- ✅ Юнит-тесты проходят.
