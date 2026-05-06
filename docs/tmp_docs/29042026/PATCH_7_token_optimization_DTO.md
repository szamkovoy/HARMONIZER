# PATCH 7 [P2]: Оптимизация LLM-контекста через компактные DTO

## Что не так

Из аудита (Audit orchestrator cost):

> 1. В респондере `user_phrases` и `user_profile_summary` оба равны `profileSummary(context)` — дублирование одного и того же JSON-блока в одном промпте.
> 2. На каждый ход вызывается `choosePractice` и `filtered_practices_list` попадает в фазовые переменные, даже когда фаза не `suggest_practice`.
> 3. `calibration_extraction` отправляет полный previous calibration вместе с portrait/chunks.
> 4. `recommendation-text` отправляет весь forecast row.
> 5. `auto-calibrate` отправляет весь states_map и до 40 сообщений без char/token budget.

Каждый из этих пунктов даёт 5-15% перерасхода токенов. Суммарно — **15-25% LLM-bill**.

## Стратегия: ввести компактные DTO с явными лимитами

DTO = Data Transfer Objects — прослойка между «сырыми» БД-объектами и тем, что попадает в промпт. Преимущества:
1. Гарантированный лимит на размер.
2. Удаление полей, которые LLM не использует (id, timestamps, nested arrays).
3. Чёткая ответственность: «это всё, что нужно LLM».
4. Логирование размера контекста — мониторинг.

## Структура DTO

Создать файл `_legacy_web/app/api/_utils/dto.ts`:

```typescript
import type { CalibrationRow, NatalProfile, DailyForecast } from "./types";

// =============================================================================
// БЮДЖЕТЫ ТОКЕНОВ (приближённо: 1 токен ≈ 3.5 символа кириллицы)
// =============================================================================

const TOKEN_BUDGETS = {
  profile_summary: 350,           // ~1200 символов
  forecast_compact: 200,          // ~700 символов
  calibration_compact: 300,       // ~1050 символов
  history_compact: 1500,          // ~5250 символов
  states_map_compact: 250,        // ~875 символов
};

// =============================================================================
// 1. Profile Summary DTO
// =============================================================================

export interface ProfileSummaryDTO {
  name: string;
  birthDate: string;              // YYYY-MM-DD без time
  precisionMode: "precise" | "approximate" | "unknown";
  
  // Семь планет с минимальными метриками для LLM
  chakras: {
    [chakraNumber: number]: {     // 1..7
      planet: string;
      shortLabel: string;         // "витальность", "сила" и т.д.
      strength: number;           // S, округлено до 0.01
      harmony: number;            // H, округлено до 0.01
      flag?: "weak" | "strong" | "harmonic" | "dissonant";  // только если значимо отличается от среднего
    };
  };
  
  isCalibrated: boolean;          // true если есть active calibration
}

export function buildProfileSummary(
  natal: NatalProfile,
  calibration: CalibrationRow | null,
  user: { full_name?: string; birth_date?: string }
): ProfileSummaryDTO {
  const chakras: ProfileSummaryDTO["chakras"] = {};
  
  for (const planet of PLANETS_7) {
    const chakraNum = PLANET_TO_CHAKRA[planet];
    const sCal = calibration?.s_calibrated?.[planet] ?? natal.planets[planet].S_initial;
    const hCal = calibration?.h_calibrated?.[planet] ?? natal.planets[planet].H_initial;
    
    let flag: ProfileSummaryDTO["chakras"][number]["flag"];
    if (sCal < 0.3) flag = "weak";
    else if (sCal > 0.75) flag = "strong";
    if (hCal < -0.4) flag = flag ? "weak" : "dissonant";  // не перезаписываем strength flag
    else if (hCal > 0.4 && !flag) flag = "harmonic";
    
    chakras[chakraNum] = {
      planet,
      shortLabel: PLANET_SHORT_LABELS[planet],
      strength: round(sCal, 2),
      harmony: round(hCal, 2),
      ...(flag && { flag }),  // включаем только если есть
    };
  }
  
  return {
    name: user.full_name ?? "User",
    birthDate: user.birth_date ?? "",
    precisionMode: natal.precision_mode,
    chakras,
    isCalibrated: !!calibration,
  };
}

// =============================================================================
// 2. Forecast Compact DTO
// =============================================================================

export interface ForecastCompactDTO {
  date: string;                                    // YYYY-MM-DD
  planet: string;                                  // planet of the day
  chakra: number;                                  // 1..7
  shortLabel: string;
  tone: "harmonic" | "neutral" | "dissonant";
  H: number;                                       // calibrated harmony of planet of day
  S: number;                                       // calibrated strength
  isAlternativeChoice: boolean;
  // Окна возможностей — только времена, без deg/lon
  windows: {
    sunrise?: string;                              // HH:MM
    culmination?: string;
    exactAspect?: string;
  };
}

export function buildForecastCompact(forecast: DailyForecast): ForecastCompactDTO {
  return {
    date: forecast.forecast_date,
    planet: forecast.planet_of_the_day,
    chakra: PLANET_TO_CHAKRA[forecast.planet_of_the_day],
    shortLabel: PLANET_SHORT_LABELS[forecast.planet_of_the_day],
    tone: forecast.today_planet_state.todayTone,
    H: round(forecast.today_planet_state.naturalHarmoniousness, 2),
    S: round(forecast.importance[forecast.planet_of_the_day], 2),  // как proxy для S дня
    isAlternativeChoice: forecast.is_alternative_choice,
    windows: {
      sunrise: extractHHMM(forecast.windows_of_opportunity.sunrise?.time),
      culmination: extractHHMM(forecast.windows_of_opportunity.culmination?.time),
      exactAspect: extractHHMM(forecast.windows_of_opportunity.exactAspect?.time),
    },
  };
}

// =============================================================================
// 3. Calibration Compact DTO (для extraction)
// =============================================================================

export interface CalibrationCompactDTO {
  version: number;
  // Без portrait, без portrait_chunks, без raw_feedback
  states_summary: {                                // только ключевые состояния, не все
    [planet: string]: {
      positive: string[];                          // top 3
      negative: string[];                          // top 3
    };
  };
  // Без полного user_lexicon, только репрезентативные фразы
  topPhrases: Array<{ text: string; planet: string }>;  // max 10
}

export function buildCalibrationCompact(cal: CalibrationRow): CalibrationCompactDTO {
  const states_summary: CalibrationCompactDTO["states_summary"] = {};
  
  for (const planet of PLANETS_7) {
    const sm = cal.states_map[planet];
    states_summary[planet] = {
      positive: (sm.positive_states ?? []).slice(0, 3).map(s => s.label),
      negative: (sm.negative_states ?? []).slice(0, 3).map(s => s.label),
    };
  }
  
  // Top фразы по frequency
  const topPhrases = (cal.user_lexicon.phrases ?? [])
    .sort((a, b) => (b.frequency ?? 0) - (a.frequency ?? 0))
    .slice(0, 10)
    .map(p => ({ text: p.text, planet: p.associated_planet }));
  
  return {
    version: cal.version,
    states_summary,
    topPhrases,
  };
}

// =============================================================================
// 4. History Compact DTO
// =============================================================================

export interface HistoryCompactDTO {
  messages: Array<{
    role: "user" | "assistant";
    text: string;                  // truncated to 300 chars per message
    phase?: string;                // только для assistant
  }>;
  totalMessages: number;           // исходное число до обрезки
  truncated: boolean;
}

export function buildHistoryCompact(
  messages: Array<{ role: string; content: string; meta?: any }>,
  budgetChars = 5250
): HistoryCompactDTO {
  const compactMessages = messages.map(m => ({
    role: m.role as "user" | "assistant",
    text: truncate(m.content, 300),
    ...(m.role === "assistant" && m.meta?.responder?.phase_used && {
      phase: m.meta.responder.phase_used
    }),
  }));
  
  // Идём с конца (последние сообщения важнее), пока влезаем в budget
  const result: typeof compactMessages = [];
  let totalChars = 0;
  for (let i = compactMessages.length - 1; i >= 0; i--) {
    const msgChars = compactMessages[i].text.length + 50;  // +50 на role/phase markup
    if (totalChars + msgChars > budgetChars) break;
    result.unshift(compactMessages[i]);
    totalChars += msgChars;
  }
  
  return {
    messages: result,
    totalMessages: messages.length,
    truncated: result.length < messages.length,
  };
}

// =============================================================================
// 5. States Map Compact DTO (для auto-calibrate)
// =============================================================================

export interface StatesMapCompactDTO {
  [planet: string]: {
    confirmed_positive: string[];   // что пользователь подтверждал
    confirmed_negative: string[];
    user_added: string[];           // что добавлено пользователем
    rejected: string[];             // НЕ включаем больше
  };
}

export function buildStatesMapCompact(statesMap: any): StatesMapCompactDTO {
  const result: StatesMapCompactDTO = {} as any;
  for (const planet of PLANETS_7) {
    const sm = statesMap[planet];
    result[planet] = {
      confirmed_positive: (sm.positive_states ?? [])
        .filter(s => s.source === "user_confirmed")
        .map(s => s.label),
      confirmed_negative: (sm.negative_states ?? [])
        .filter(s => s.source === "user_confirmed")
        .map(s => s.label),
      user_added: [
        ...(sm.positive_states ?? []),
        ...(sm.negative_states ?? []),
      ].filter(s => s.source === "user_added").map(s => s.label),
      rejected: (sm.rejected_states ?? []).map(s => s.label),
    };
  }
  return result;
}

// =============================================================================
// Утилиты
// =============================================================================

function round(x: number, decimals: number): number {
  return Math.round(x * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + "...";
}

function extractHHMM(isoTime?: string): string | undefined {
  if (!isoTime) return undefined;
  return new Date(isoTime).toISOString().slice(11, 16);
}

// =============================================================================
// Логирование размера для мониторинга
// =============================================================================

export function logDTOSize(dtoName: string, dto: any, budget: number) {
  const json = JSON.stringify(dto);
  const chars = json.length;
  const tokens = Math.ceil(chars / 3.5);  // approx for Cyrillic
  
  if (tokens > budget) {
    console.warn(`[DTO] ${dtoName} exceeds budget: ${tokens} > ${budget} tokens`);
  }
  
  // Можно также писать в user_event_log для анализа
  return { chars, tokens };
}
```

## Применение в эндпоинтах

### 1. `/api/communicator/v2/dialog/route.ts`

```typescript
import { 
  buildProfileSummary, 
  buildForecastCompact, 
  buildHistoryCompact,
  logDTOSize 
} from "@/app/api/_utils/dto";

// БЫЛО:
// user_phrases: profileSummary(context),
// user_profile_summary: profileSummary(context),  // дублируется
// daily_context: useCase === "daily_dialog" ? dailyContext(context) : "",
// filtered_practices_list: choosePractice(...),  // всегда!

// СТАЛО:
const profileDTO = buildProfileSummary(context.natalProfile, context.calibration, context.user);
const forecastDTO = useCase === "daily_dialog" ? buildForecastCompact(context.forecast) : null;
const historyDTO = buildHistoryCompact(context.history, 5250);

logDTOSize("profile", profileDTO, 350);
logDTOSize("forecast", forecastDTO, 200);
logDTOSize("history", historyDTO, 1500);

// Practices загружаем ТОЛЬКО для нужных фаз
const practicesNeededFor = ["suggest_practice", "ask_practice_intent"];
const practicesList = practicesNeededFor.includes(decision.next_phase)
  ? await getFilteredPracticesStack(userId, planetOfDay, 7)
  : null;

const prompt = renderPrompt(responderPrompt.template, {
  current_phase: decision.next_phase,
  phase_instruction: renderedPhase,
  tone: decision.responder_hints?.tone ?? "neutral",
  
  // user_phrases — РАЗНЫЕ от profile_summary
  user_phrases: getRelevantPhrases(context.calibration, planetOfDay).slice(0, 5),
  user_profile_summary: profileDTO,  // компактный
  
  use_user_phrases: decision.responder_hints?.use_user_phrases ?? [],
  avoid_topics: decision.responder_hints?.avoid_topics ?? [],
  daily_context: forecastDTO,        // компактный, или null
  filtered_practices_list: practicesList,  // только когда нужно
  history: historyDTO,
});
```

### 2. `/api/calibration/extract/route.ts`

```typescript
import { buildProfileSummary, buildCalibrationCompact } from "@/app/api/_utils/dto";

// При вызове calibration_extraction prompt:
const prompt = renderPrompt(extractionPrompt.template, {
  natal_profile: buildNatalCompact(natalProfile),  // только S_initial, H_initial по 7 планетам
  baseline_states: BASELINE_STATES,                 // из JSON, не трогаем
  user_feedback_text: feedbackText,
  // БЫЛО: previous_calibration: previousCal (с portrait, chunks, raw_feedback...)
  // СТАЛО:
  previous_calibration: previousCal ? buildCalibrationCompact(previousCal) : null,
});
```

### 3. `/api/communicator/v2/recommendation-text/route.ts`

```typescript
import { buildForecastCompact, buildProfileSummary } from "@/app/api/_utils/dto";

// БЫЛО: forecast: fullForecastRow (со всеми полями БД)
// СТАЛО:
const forecastDTO = buildForecastCompact(forecastRow);
const profileDTO = buildProfileSummary(natal, calibration, user);

const prompt = renderPrompt(recommendationPrompt.template, {
  forecast: forecastDTO,
  profile: profileDTO,
  language,
});
```

### 4. `supabase/functions/auto-calibrate/index.ts`

```typescript
// Импорт DTO в Deno-совместимом виде (см. PATCH 4 о shared core)
import { buildStatesMapCompact, buildHistoryCompact } from "../_shared/dto.ts";

// При формировании prompt для digest:
const compactStates = buildStatesMapCompact(activeCalibration.states_map);
const compactHistory = buildHistoryCompact(allMessages, 8000);  // больше budget для digest

const prompt = renderPrompt(digestPrompt.template, {
  states_map: compactStates,
  conversation_history: compactHistory,
  // ...
});
```

## Прогноз эффекта

По грубой оценке:

| Эндпоинт | Сейчас (tokens) | После DTO | Экономия |
|---|---|---|---|
| `/dialog` (responder) | ~2500 | ~1700 | -32% |
| `/dialog` (orchestrator) | ~1800 | ~1300 | -28% |
| `/calibration/extract` | ~3500 | ~2200 | -37% |
| `/recommendation-text` | ~1200 | ~700 | -42% |
| `/auto-calibrate digest` | ~5000 | ~3200 | -36% |

Совокупная экономия ~30-35% LLM-bill после внедрения.

## Тесты

```typescript
// _legacy_web/app/api/_utils/dto.test.ts

describe("buildProfileSummary DTO", () => {
  it("includes all 7 chakras with rounded values", () => {
    const dto = buildProfileSummary(mockNatal, null, { full_name: "Test", birth_date: "1990-01-01" });
    expect(Object.keys(dto.chakras).length).toBe(7);
    for (const k in dto.chakras) {
      expect(dto.chakras[k].strength).toBeLessThanOrEqual(1);
      expect(dto.chakras[k].strength).toBeGreaterThanOrEqual(0);
      // Проверяем что округлено до 2 знаков
      expect(dto.chakras[k].strength.toString().split(".")[1]?.length ?? 0).toBeLessThanOrEqual(2);
    }
  });
  
  it("includes flag only when significantly different", () => {
    const weakNatal = { ...mockNatal, planets: { ...mockNatal.planets, Sun: { S_initial: 0.2, H_initial: 0 } } };
    const dto = buildProfileSummary(weakNatal, null, mockUser);
    expect(dto.chakras[7].flag).toBe("weak");
    
    const averageNatal = { ...mockNatal, planets: { ...mockNatal.planets, Sun: { S_initial: 0.5, H_initial: 0 } } };
    const dto2 = buildProfileSummary(averageNatal, null, mockUser);
    expect(dto2.chakras[7].flag).toBeUndefined();
  });
  
  it("uses calibrated values when available", () => {
    const calibration = { s_calibrated: { Sun: 0.85 }, h_calibrated: { Sun: 0.3 } };
    const dto = buildProfileSummary(mockNatal, calibration, mockUser);
    expect(dto.chakras[7].strength).toBe(0.85);
    expect(dto.chakras[7].harmony).toBe(0.3);
  });
});

describe("buildHistoryCompact", () => {
  it("respects char budget", () => {
    const longMessages = Array.from({ length: 50 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: "a".repeat(500),
    }));
    
    const dto = buildHistoryCompact(longMessages, 5250);
    
    const totalChars = dto.messages.reduce((s, m) => s + m.text.length + 50, 0);
    expect(totalChars).toBeLessThanOrEqual(5250);
    expect(dto.truncated).toBe(true);
  });
  
  it("keeps last messages when truncating", () => {
    const messages = [
      { role: "user", content: "first" },
      { role: "assistant", content: "second" },
      { role: "user", content: "third" },
    ];
    
    const dto = buildHistoryCompact(messages, 200);
    expect(dto.messages[dto.messages.length - 1].text).toBe("third");
  });
});

describe("buildForecastCompact", () => {
  it("excludes raw transit data", () => {
    const dto = buildForecastCompact(mockForecast);
    expect(dto).not.toHaveProperty("transit_chart");
    expect(dto).not.toHaveProperty("activation");
    expect(dto).not.toHaveProperty("ranked_planets");
  });
  
  it("formats times as HH:MM only", () => {
    const dto = buildForecastCompact(mockForecast);
    if (dto.windows.sunrise) {
      expect(dto.windows.sunrise).toMatch(/^\d{2}:\d{2}$/);
    }
  });
});
```

## Логирование для мониторинга

В каждом промпт-вызове логировать размер контекста в `user_event_log`:

```typescript
await supabase.from("user_event_log").insert({
  user_id: userId,
  kind: "llm_prompt_size",
  payload: {
    endpoint: "communicator/v2/dialog",
    profile_tokens: profileSize.tokens,
    forecast_tokens: forecastSize.tokens,
    history_tokens: historySize.tokens,
    total_tokens: profileSize.tokens + forecastSize.tokens + historySize.tokens,
  }
});
```

Дашборд: средние токены на эндпоинт по дням → видим эффект от рефакторинга.

## Как проверить

1. Запустить полный пользовательский сценарий до и после.
2. В логах сравнить `tokens_input` для каждого вызова — должно снизиться на ~30%.
3. Качество ответов не должно деградировать — провести A/B на 5-10 диалогах.

## Критерий приёмки

- ✅ DTO-функции созданы и покрыты тестами.
- ✅ Все 4 эндпоинта используют DTO вместо сырых объектов.
- ✅ `filtered_practices_list` загружается только для phases где он нужен.
- ✅ Дублирование `profileSummary` в responder промпте устранено (`user_phrases` ≠ `user_profile_summary`).
- ✅ Логирование размера контекста в `user_event_log`.
- ✅ Среднее число input-токенов на запрос снизилось на 25-35%.
