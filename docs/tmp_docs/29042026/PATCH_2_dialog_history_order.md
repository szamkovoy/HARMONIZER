# PATCH 2 [P0]: Исправление загрузки истории сообщений в /api/communicator/v2/dialog

## Что не так

В `_legacy_web/app/api/communicator/v2/dialog/route.ts` история диалога грузится так:

```typescript
const { data: history } = await supabase
  .from("messages")
  .select("*")
  .eq("conversation_id", conversationId)
  .order("created_at", { ascending: true })  // ← старые сначала
  .limit(40);                                 // ← обрезаем хвост
```

Это даёт **первые 40 сообщений диалога**, а не последние. На длинных диалогах (после 40 сообщений) Gemini получает контекст «начала разговора» и не видит, что обсуждалось последние ~5-10 ходов.

## Эффект

1. **Decision cache ломается** — `getLastOrchestratorDecision(history)` возвращает `decision` от первого ассистент-сообщения, а не последнего. Cache hit/miss работает на устаревших данных.
2. **`shouldForceFreshDecision()` сравнивает не последние, а первые два сообщения** → защита от стагнации не работает.
3. **Качество ответов Gemini** — без понимания недавнего контекста ассистент задаёт уже отвеченные вопросы и игнорирует новые темы.

Сейчас не виден, потому что в реальных диалогах редко больше 5-10 сообщений. Выстрелит при росте retention и при автокалибровке (там длинные сводки).

## Файлы для изменения

1. `_legacy_web/app/api/communicator/v2/dialog/route.ts` — функция загрузки истории.
2. Все остальные места в кодовой базе, где грузятся `messages` с `order ascending + limit` без явной причины (нужно проверить).

## Конкретные изменения

### Правильная загрузка последних N сообщений

```typescript
const HISTORY_LIMIT = 40;

async function getMessageHistory(supabase, conversationId: string, limit = HISTORY_LIMIT) {
  // 1. Берём последние N сообщений (descending)
  const { data, error } = await supabase
    .from("messages")
    .select("id, role, content, content_type, meta, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })  // ← descending для последних
    .limit(limit);
  
  if (error) throw error;
  if (!data) return [];
  
  // 2. Разворачиваем обратно в хронологический порядок (старые → новые)
  return data.reverse();
}
```

**Ключевое:** `order desc + limit + reverse()` — стандартный паттерн «дай последние N».

### Применение в dialog/route.ts

Заменить текущий вызов на новый. Скорее всего код выглядит так:

```typescript
// БЫЛО:
const { data: history } = await supabase
  .from("messages")
  .select("*")
  .eq("conversation_id", conversationId)
  .order("created_at", { ascending: true })
  .limit(40);

// СТАЛО:
const history = await getMessageHistory(supabase, conversationId, 40);
```

### Согласованность с `lastAssistantDecisions` и `lastUserMessage`

В аудите упомянуты функции `lastAssistantDecisions` и `lastUserMessage` в том же `dialog/route.ts`. Они должны работать корректно с правильно отсортированной историей:

```typescript
function getLastAssistantDecisions(history, count = 2): OrchestratorDecision[] {
  // history уже в хронологическом порядке (старые → новые)
  return history
    .filter(m => m.role === "assistant" && m.meta?.orchestrator_decision)
    .slice(-count)  // последние count
    .map(m => m.meta.orchestrator_decision);
}

function getLastUserMessage(history): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "user") return history[i].content;
  }
  return null;
}
```

Эти функции при правильно отсортированной истории дадут реальные «последние».

### Проверить другие места

Поиском по репозиторию найти все места, где грузятся messages, и проверить корректность:

```bash
grep -rn "from(\"messages\")" _legacy_web/ supabase/functions/ modules/
grep -rn "from('messages')" _legacy_web/ supabase/functions/ modules/
```

Особенно проверить:
- `supabase/functions/auto-calibrate/index.ts` — там грузится для `loadMessagesSince()` диалоги для digest. Для агрегации нужны **все** сообщения за период, не последние.
- `_legacy_web/app/api/communicator/v2/dialog/summarization` (если есть).
- Главный экран, если он показывает превью диалогов.

## Тесты

Добавить в `_legacy_web/app/api/communicator/v2/dialog/route.test.ts` (или создать):

```typescript
import { describe, it, expect, vi } from "vitest";

// Mock supabase
function createMockSupabase(messages) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: messages, error: null })
          })
        })
      })
    })
  };
}

describe("getMessageHistory", () => {
  it("returns last N messages in chronological order", async () => {
    // 50 messages, descending in mock (last first)
    const allMessages = Array.from({ length: 50 }, (_, i) => ({
      id: `msg_${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Message ${i}`,
      created_at: new Date(2026, 0, 1, 0, 0, i).toISOString()
    })).reverse(); // descending
    
    // Supabase возвращает первые 40 из descending = последние 40 в хронологии
    const supabase = createMockSupabase(allMessages.slice(0, 40));
    
    const history = await getMessageHistory(supabase, "conv1", 40);
    
    expect(history).toHaveLength(40);
    expect(history[0].id).toBe("msg_10");      // самое старое из последних 40
    expect(history[39].id).toBe("msg_49");     // самое новое
  });
  
  it("returns all if conversation shorter than limit", async () => {
    const messages = [
      { id: "1", role: "user", content: "Hi", created_at: "2026-01-01T00:00:00Z" },
      { id: "2", role: "assistant", content: "Hello", created_at: "2026-01-01T00:00:01Z" },
    ].reverse();
    
    const supabase = createMockSupabase(messages);
    const history = await getMessageHistory(supabase, "conv1", 40);
    
    expect(history).toHaveLength(2);
    expect(history[0].id).toBe("1");
    expect(history[1].id).toBe("2");
  });
  
  it("returns empty array for empty conversation", async () => {
    const supabase = createMockSupabase([]);
    const history = await getMessageHistory(supabase, "conv1", 40);
    expect(history).toEqual([]);
  });
});

describe("decision cache with correct history", () => {
  it("getLastAssistantDecisions returns last decisions, not first", () => {
    const history = [
      { role: "user", content: "msg 1", meta: {} },
      { role: "assistant", content: "ans 1", meta: { orchestrator_decision: { next_phase: "phase_A" } } },
      { role: "user", content: "msg 2", meta: {} },
      { role: "assistant", content: "ans 2", meta: { orchestrator_decision: { next_phase: "phase_B" } } },
      { role: "user", content: "msg 3", meta: {} },
      { role: "assistant", content: "ans 3", meta: { orchestrator_decision: { next_phase: "phase_C" } } },
    ];
    
    const lastTwo = getLastAssistantDecisions(history, 2);
    expect(lastTwo).toHaveLength(2);
    expect(lastTwo[0].next_phase).toBe("phase_B");  // предпоследний
    expect(lastTwo[1].next_phase).toBe("phase_C");  // последний
  });
});
```

## Как проверить

1. Создать тестовый диалог из 45 сообщений (можно скриптом seed).
2. Послать новое сообщение → в логах посмотреть, что в промпт Gemini попадают сообщения **последние** 40 (с msg_5 по msg_44), а не первые 40 (msg_0..msg_39).
3. В debug-данных оркестратора `iteration_number` должен быть 23+ (если сообщения user/assistant чередуются), а не 1.

## Дополнительная гигиена: лимит на user_event_log

Если этот же баг есть в `user_event_log` (загрузка для аналитики) — там тоже стоит проверить, иначе дашборды покажут данные «начала эры», а не недавние.

## Критерий приёмки

- ✅ `getMessageHistory()` возвращает последние N сообщений в хронологическом порядке.
- ✅ `getLastAssistantDecisions()` берёт последние, не первые.
- ✅ Юнит-тесты на оба случая проходят.
- ✅ В тестовом длинном диалоге (>40 сообщений) Gemini получает свежий контекст.
- ✅ Decision cache работает корректно — на 3-й итерации длинного диалога видны cache_reused записи.
