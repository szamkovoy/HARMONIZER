# PATCH 10 [P1]: Insight Engine — детекция инсайта, готовности и адаптивная длина диалога

## Что это решает

Текущий оркестратор работает на эвристиках («density, информационные оси»), но не использует научно обоснованные методы детекции инсайта и готовности к практике. Из исследования (PDF "Orchestrator__Инсайт..."):

1. **Cognitive Shift Index (CSI)** — формула из академических работ по психотерапии. Детектирует когнитивный сдвиг (инсайт) по 4 лингвистическим маркерам.
2. **Транстеоретическая модель (TTM)** Прочаски — 5 стадий готовности к изменению. Запрещает предлагать практику до стадии preparation.
3. **Emotional Trajectory Volatility (ETV)** — метрика эмоциональной нестабильности, по которой адаптируется длина диалога.

Этот патч добавляет все три метрики к оркестратору, не меняя его архитектуру. Они становятся новыми сигналами, которые подаются в `OrchestratorDecision`.

## Эффект

После применения:
- **Инсайт детектируется автоматически** — оркестратор знает, был ли «аха-момент» в последних 2 ходах.
- **Практика не предлагается раньше времени** — пока пользователь в `preconcept` или `concept` стадии (сопротивление, амбивалентность), оркестратор копает глубже.
- **Длина диалога адаптируется к стабильности эмоций** — если пользователь раскачивается (горка эмоций), даём больше времени; если ровный — быстрее к практике.

## Файлы для изменения

1. **Создать** `_legacy_web/app/api/_utils/insightDetection.ts` — модуль с тремя функциями.
2. **Обновить** `_legacy_web/app/api/_utils/orchestrator.ts` — встроить вызовы в `buildDecision()`.
3. **Расширить** структуру `OrchestratorDecision` — добавить поля `csi`, `ttm_stage`, `etv`.
4. **Обновить** промпт `orchestrator_decision` — учесть новые сигналы при выборе фазы.
5. **Расширить** структуру `messages.meta` — сохранять метрики для аналитики.

---

## 1. Insight Detection Module

```typescript
// _legacy_web/app/api/_utils/insightDetection.ts

/**
 * INSIGHT DETECTION: Cognitive Shift Index (CSI)
 * 
 * Детектирует когнитивный сдвиг (инсайт) по лингвистическим маркерам.
 * Источник: исследования автоматического анализа психотерапевтических диалогов.
 * 
 * Маркеры:
 * 1. Сдвиг временной ориентации (от прошлого к будущему/настоящему)
 * 2. Изменение местоимений (от "я" к "мы" / третье лицо)
 * 3. Повышение когнитивной сложности (слова мышления: понимаю, причина, потому что)
 * 4. Агентность (активные конструкции, "я выбираю", "я замечаю")
 * 
 * Формула:
 * CSI = w1 * (cognitive_words / total_words)
 *     + w2 * (future_tense / (past_tense + 1))
 *     - w3 * (1st_person_singular / (1st_person_plural + 1))
 * 
 * Устойчивый рост CSI 2-3 хода подряд → детекция инсайта.
 */

const CSI_WEIGHTS = { w1: 0.4, w2: 0.3, w3: 0.3 };

// Лингвистические маркеры (RU + EN)
const COGNITIVE_WORDS_RU = [
  "понимаю", "поняла", "понял", "вижу", "осознаю", "замечаю", "знаю", "значит",
  "потому что", "из-за того", "следовательно", "связано с", "причина", "поэтому",
  "оказывается", "как будто", "догадалась", "догадался", "теперь ясно"
];

const COGNITIVE_WORDS_EN = [
  "understand", "see", "realize", "notice", "know", "means", "because", "due to",
  "therefore", "related to", "reason", "so", "turns out", "as if", "got it", "now clear"
];

const FUTURE_MARKERS_RU = [
  "буду", "будет", "будем", "стану", "станет", "сделаю", "попробую", "хочу попробовать",
  "планирую", "намерен", "собираюсь", "готов", "теперь", "с этого момента"
];

const FUTURE_MARKERS_EN = [
  "will", "going to", "plan to", "intend to", "ready to", "from now on", "next time"
];

const PAST_MARKERS_RU = [
  "был", "была", "было", "сделал", "сделала", "помню", "тогда", "раньше",
  "когда-то", "до этого", "прежде", "в прошлом"
];

const PAST_MARKERS_EN = [
  "was", "were", "had", "did", "remember", "back then", "before", "previously"
];

const FIRST_PERSON_SINGULAR_RU = ["я", "мне", "меня", "мной", "мой", "моя", "мои", "моё"];
const FIRST_PERSON_SINGULAR_EN = ["i", "me", "my", "mine", "myself"];

const FIRST_PERSON_PLURAL_RU = ["мы", "нас", "нам", "наш", "наша", "наши", "наше"];
const FIRST_PERSON_PLURAL_EN = ["we", "us", "our", "ours", "ourselves"];

function countMatches(text: string, words: string[]): number {
  const lower = text.toLowerCase();
  let count = 0;
  for (const word of words) {
    // Используем word boundary для точности
    const regex = new RegExp(`\\b${escapeRegex(word)}\\b`, "gi");
    const matches = lower.match(regex);
    if (matches) count += matches.length;
  }
  return count;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getTotalWords(text: string): number {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

export function computeCSI(message: string, language: string): number {
  if (!message || message.trim().length < 5) return 0;
  
  const isRu = language.startsWith("ru");
  const cognitiveWords = isRu ? COGNITIVE_WORDS_RU : COGNITIVE_WORDS_EN;
  const futureMarkers = isRu ? FUTURE_MARKERS_RU : FUTURE_MARKERS_EN;
  const pastMarkers = isRu ? PAST_MARKERS_RU : PAST_MARKERS_EN;
  const fps = isRu ? FIRST_PERSON_SINGULAR_RU : FIRST_PERSON_SINGULAR_EN;
  const fpp = isRu ? FIRST_PERSON_PLURAL_RU : FIRST_PERSON_PLURAL_EN;
  
  const totalWords = getTotalWords(message);
  if (totalWords < 3) return 0;
  
  const cognitiveCount = countMatches(message, cognitiveWords);
  const futureCount = countMatches(message, futureMarkers);
  const pastCount = countMatches(message, pastMarkers);
  const fpsCount = countMatches(message, fps);
  const fppCount = countMatches(message, fpp);
  
  // Нормализованные компоненты
  const cognitiveRatio = cognitiveCount / totalWords;     // 0..1
  const tenseRatio = futureCount / (pastCount + 1);       // 0..N (clamp до 1)
  const personRatio = fpsCount / (fppCount + 1);          // 0..N (clamp до 1)
  
  const csi = 
    CSI_WEIGHTS.w1 * Math.min(cognitiveRatio * 5, 1) +    // x5 — потому что cognitive слова редкие
    CSI_WEIGHTS.w2 * Math.min(tenseRatio, 1) -
    CSI_WEIGHTS.w3 * Math.min(personRatio / 5, 1);        // /5 — нормализация
  
  return Math.max(0, Math.min(1, csi));
}

/**
 * Детекция «аха-момента» — устойчивого роста CSI на 2+ ходах подряд
 */
export function detectInsightMoment(csiHistory: number[]): {
  detected: boolean;
  confidence: number;
  reason: string;
} {
  if (csiHistory.length < 2) {
    return { detected: false, confidence: 0, reason: "not_enough_data" };
  }
  
  const last3 = csiHistory.slice(-3);
  
  // Условие 1: последние 2 значения выше 0.4
  const recentAvg = last3.slice(-2).reduce((s, x) => s + x, 0) / 2;
  if (recentAvg < 0.4) {
    return { detected: false, confidence: recentAvg, reason: "csi_too_low" };
  }
  
  // Условие 2: рост между предпоследним и последним
  const last = last3[last3.length - 1];
  const prev = last3[last3.length - 2];
  const growth = last - prev;
  
  if (growth < 0.1) {
    return { detected: false, confidence: recentAvg, reason: "no_growth" };
  }
  
  return {
    detected: true,
    confidence: recentAvg,
    reason: `csi_grew_from_${prev.toFixed(2)}_to_${last.toFixed(2)}`,
  };
}

/**
 * EMOTIONAL TRAJECTORY VOLATILITY (ETV)
 * 
 * Измеряет нестабильность эмоций пользователя в последних N сообщениях.
 * Используется для адаптации длины диалога:
 *   высокая ETV → пользователь раскачивается → даём больше итераций
 *   низкая ETV → пользователь стабилен → быстрее к практике
 * 
 * Реализация: 
 * Каждому сообщению присваиваем эмоциональную валентность от -1 до +1
 * по простым словарям. ETV = стандартное отклонение этих значений.
 */

const POSITIVE_WORDS_RU = [
  "хорошо", "отлично", "класс", "приятно", "люблю", "радость", "спокойно",
  "благодарна", "благодарен", "счастлив", "счастлива", "легко", "интересно",
  "круто", "замечательно", "повезло", "получилось", "удалось"
];

const NEGATIVE_WORDS_RU = [
  "плохо", "ужасно", "тяжело", "грустно", "тревожно", "страшно", "злюсь",
  "бесит", "ненавижу", "устала", "устал", "выгорание", "бессилие", "одиноко",
  "обидно", "разочарован", "разочарована", "напряжение", "стресс", "паника"
];

const POSITIVE_WORDS_EN = [
  "good", "great", "nice", "love", "joy", "calm", "grateful", "happy", "easy",
  "interesting", "cool", "wonderful", "lucky", "managed", "succeeded"
];

const NEGATIVE_WORDS_EN = [
  "bad", "terrible", "hard", "sad", "anxious", "scared", "angry", "annoying",
  "hate", "tired", "burned out", "powerless", "lonely", "hurt", "disappointed",
  "tension", "stress", "panic"
];

export function estimateEmotionalValence(message: string, language: string): number {
  if (!message || message.trim().length < 3) return 0;
  
  const isRu = language.startsWith("ru");
  const positiveWords = isRu ? POSITIVE_WORDS_RU : POSITIVE_WORDS_EN;
  const negativeWords = isRu ? NEGATIVE_WORDS_RU : NEGATIVE_WORDS_EN;
  
  const posCount = countMatches(message, positiveWords);
  const negCount = countMatches(message, negativeWords);
  
  if (posCount === 0 && negCount === 0) return 0;
  
  // Нормализованная разность
  return (posCount - negCount) / (posCount + negCount);
}

/**
 * Считает ETV на массиве последних эмоциональных оценок.
 * Возвращает [0..1], где 0 = стабильно, 1 = очень нестабильно.
 */
export function computeETV(valenceHistory: number[]): number {
  if (valenceHistory.length < 2) return 0;
  
  const mean = valenceHistory.reduce((s, x) => s + x, 0) / valenceHistory.length;
  const variance = valenceHistory.reduce((s, x) => s + (x - mean) ** 2, 0) / valenceHistory.length;
  const stdDev = Math.sqrt(variance);
  
  // Нормализуем: при stdDev=1 (макс. возможный размах от -1 до +1) → ETV=1
  return Math.min(1, stdDev);
}

/**
 * TRANSTHEORETICAL MODEL (TTM) STAGES
 * 
 * Прочаска: 5 стадий готовности к изменению.
 * Используется для запрета предложения практики до стадии "preparation".
 */

export type TTMStage = "preconcept" | "concept" | "preparation" | "action" | "maintenance";

const PRECONCEPT_MARKERS_RU = [
  "у меня нет проблем", "это всё из-за", "не моя вина", "я в порядке",
  "просто такой период", "у всех так", "ничего не поделаешь", "это не я"
];

const CONCEPT_MARKERS_RU = [
  "может быть", "когда-нибудь", "наверное стоит", "я думаю об этом",
  "иногда замечаю", "не уверен", "не уверена", "не знаю", "сложно сказать",
  "хочется бы", "было бы хорошо"
];

const PREPARATION_MARKERS_RU = [
  "я готов", "я готова", "хочу попробовать", "что мне сделать", "как мне начать",
  "я решила", "я решил", "я хочу", "давай попробуем", "что нужно сделать",
  "пора", "сейчас", "прямо сейчас"
];

const ACTION_MARKERS_RU = [
  "я уже начал", "я уже начала", "сегодня сделал", "сегодня сделала",
  "выполнил практику", "выполнила практику", "пробую", "практикую"
];

const MAINTENANCE_MARKERS_RU = [
  "я делаю это уже", "уже месяц", "уже неделя", "регулярно", "каждое утро",
  "каждый день", "вошло в привычку", "стало частью"
];

const PRECONCEPT_MARKERS_EN = [
  "no problems", "not my fault", "i'm fine", "just a phase", "everyone has it"
];

const CONCEPT_MARKERS_EN = [
  "maybe", "someday", "perhaps", "i think about it", "not sure",
  "would be nice", "should probably"
];

const PREPARATION_MARKERS_EN = [
  "i'm ready", "want to try", "what should i", "how do i start", "i decided",
  "let's try", "what needs to be done", "right now", "let's go"
];

const ACTION_MARKERS_EN = [
  "i've started", "i did", "completed practice", "i'm trying", "practicing"
];

const MAINTENANCE_MARKERS_EN = [
  "i've been doing this", "for a month", "for a week", "regularly", "every morning",
  "every day", "became a habit", "part of my"
];

export function detectTTMStage(
  recentMessages: string[],
  language: string
): { stage: TTMStage; confidence: number; markers: string[] } {
  if (recentMessages.length === 0) {
    return { stage: "concept", confidence: 0.3, markers: [] };
  }
  
  const isRu = language.startsWith("ru");
  
  const stagesAndMarkers: Array<[TTMStage, string[]]> = [
    ["preconcept", isRu ? PRECONCEPT_MARKERS_RU : PRECONCEPT_MARKERS_EN],
    ["concept", isRu ? CONCEPT_MARKERS_RU : CONCEPT_MARKERS_EN],
    ["preparation", isRu ? PREPARATION_MARKERS_RU : PREPARATION_MARKERS_EN],
    ["action", isRu ? ACTION_MARKERS_RU : ACTION_MARKERS_EN],
    ["maintenance", isRu ? MAINTENANCE_MARKERS_RU : MAINTENANCE_MARKERS_EN],
  ];
  
  // Объединяем последние 3 сообщения для контекста
  const combinedText = recentMessages.slice(-3).join(" ");
  
  const counts: Array<{ stage: TTMStage; count: number; matched: string[] }> = [];
  
  for (const [stage, markers] of stagesAndMarkers) {
    const matched: string[] = [];
    let count = 0;
    for (const marker of markers) {
      const regex = new RegExp(`\\b${escapeRegex(marker)}\\b`, "gi");
      const matches = combinedText.match(regex);
      if (matches) {
        count += matches.length;
        matched.push(marker);
      }
    }
    counts.push({ stage, count, matched });
  }
  
  // Берём стадию с максимальным количеством маркеров
  counts.sort((a, b) => b.count - a.count);
  const top = counts[0];
  
  if (top.count === 0) {
    // Никаких маркеров не нашли — дефолт concept (амбивалентность)
    return { stage: "concept", confidence: 0.2, markers: [] };
  }
  
  // Уверенность: чем больше маркеров на чистый текст, тем выше
  const totalWords = getTotalWords(combinedText);
  const confidence = Math.min(1, top.count / Math.sqrt(Math.max(totalWords, 10)));
  
  return {
    stage: top.stage,
    confidence,
    markers: top.matched,
  };
}

/**
 * READINESS CHECK
 * Готов ли пользователь к предложению практики?
 * Возвращает блокировку, если не готов.
 */
export function isReadyForPractice(ttmStage: TTMStage): {
  ready: boolean;
  reason: string;
} {
  switch (ttmStage) {
    case "preconcept":
      return { ready: false, reason: "preconcept_resistance" };
    case "concept":
      return { ready: false, reason: "concept_ambivalence" };
    case "preparation":
      return { ready: true, reason: "preparation_signals" };
    case "action":
      return { ready: true, reason: "already_in_action" };
    case "maintenance":
      return { ready: true, reason: "maintenance_phase" };
  }
}
```

---

## 2. Обновление structure OrchestratorDecision

В `_legacy_web/app/api/_utils/orchestrator.ts` добавить новые поля:

```typescript
export interface OrchestratorDecision {
  next_phase: string;
  reasoning: string;
  
  information_completeness: { [axis: string]: number };
  information_density: number;
  user_signals: UserSignal[];
  
  should_close: boolean;
  close_reason?: "goal_reached" | "soft_cap_hit" | "user_disengaged";
  
  responder_hints?: {
    tone?: "warm" | "neutral" | "energising" | "calming";
    use_user_phrases?: string[];
    avoid_topics?: string[];
  };
  
  // NEW: Insight Engine метрики
  insight_metrics?: {
    csi: number;                       // 0..1, current cognitive shift index
    csi_trend: number[];               // история CSI за последние 5 ходов
    insight_detected: boolean;         // зафиксирован «аха-момент»
    insight_confidence?: number;
    
    ttm_stage: TTMStage;
    ttm_confidence: number;
    ready_for_practice: boolean;
    readiness_reason: string;
    
    etv: number;                       // 0..1, emotional volatility
    valence_trend: number[];           // последние эмоциональные значения
  };
  
  decision_source?: "fresh" | "bypass_greeting" | "cache_reused";
  cache_similarity?: number;
  bypass_reason?: string;
}
```

---

## 3. Использование в `buildDecision()`

```typescript
// _legacy_web/app/api/communicator/v2/dialog/route.ts

import { 
  computeCSI, 
  detectInsightMoment,
  estimateEmotionalValence, 
  computeETV,
  detectTTMStage,
  isReadyForPractice,
} from "@/app/api/_utils/insightDetection";

async function buildDecision(params): Promise<{ decision, orchestratorLatencyMs }> {
  // ... существующая логика bypass / cache ...
  
  // Вычисляем insight metrics ДО вызова оркестратора
  // (они нужны и при cache_reused, и при fresh)
  const language = (user.locale ?? "ru").slice(0, 2);
  
  const userMessages = params.history
    .filter(m => m.role === "user")
    .map(m => m.content);
  
  const allUserMessages = [...userMessages, params.userMessage];
  const recentMessages = allUserMessages.slice(-5);
  
  // CSI trend — на основе последних сообщений
  const csiTrend = recentMessages.map(m => computeCSI(m, language));
  const insightDetection = detectInsightMoment(csiTrend);
  
  // Valence + ETV
  const valenceTrend = recentMessages.map(m => estimateEmotionalValence(m, language));
  const etv = computeETV(valenceTrend);
  
  // TTM stage
  const ttmDetection = detectTTMStage(recentMessages, language);
  const readiness = isReadyForPractice(ttmDetection.stage);
  
  const insightMetrics = {
    csi: csiTrend[csiTrend.length - 1] ?? 0,
    csi_trend: csiTrend,
    insight_detected: insightDetection.detected,
    insight_confidence: insightDetection.confidence,
    
    ttm_stage: ttmDetection.stage,
    ttm_confidence: ttmDetection.confidence,
    ready_for_practice: readiness.ready,
    readiness_reason: readiness.reason,
    
    etv,
    valence_trend: valenceTrend,
  };
  
  // ВАЖНО: если пользователь в стадии preconcept или concept,
  // оркестратор НЕ должен выбирать `ask_practice_intent` или `suggest_practice`,
  // даже если оси информации заполнены. Передаём это в промпт оркестратора 
  // через переменную blocked_phases.
  
  const blockedPhases: string[] = [];
  if (!readiness.ready) {
    blockedPhases.push("ask_practice_intent", "suggest_practice");
  }
  
  // Также: если CSI вырос (insight_detected), оркестратор должен ЛИБО 
  // дать пользователю «закрепить» инсайт (offer_insight ещё раз с акцентом),
  // ЛИБО переходить к practice (если ttm_stage позволяет)
  
  // Все эти подсказки уходят в промпт оркестратора:
  
  if (greetingBypass) {
    return { decision: { ...syntheticDecision, insight_metrics: insightMetrics }, ... };
  }
  
  if (cacheHit) {
    // Кеш всё равно обновляем insight metrics (они эфемерны)
    return { 
      decision: { 
        ...previousDecision, 
        insight_metrics: insightMetrics,
        decision_source: "cache_reused",
      }, 
      ...
    };
  }
  
  // Fresh orchestrator call — добавляем insight metrics в input
  const orchestratorOutput = await callGemini({
    prompt: renderPrompt(orchestratorPrompt.template, {
      // ... существующие переменные ...
      
      // NEW переменные:
      insight_metrics_json: JSON.stringify(insightMetrics, null, 2),
      blocked_phases: blockedPhases.join(", ") || "none",
      etv_hint: etv > 0.6 ? "high (пользователь раскачивается, копай глубже)" 
              : etv < 0.3 ? "low (стабилен, можно к практике)"
              : "moderate",
      ttm_hint: `Стадия готовности: ${ttmDetection.stage}. ${readiness.ready ? "Готов к практике." : `НЕ ГОТОВ к практике (${readiness.reason}).`}`,
      insight_hint: insightDetection.detected 
        ? `Инсайт детектирован (CSI=${insightDetection.confidence?.toFixed(2)}). Можно закреплять или переходить к практике.`
        : "Инсайт не детектирован.",
    }),
    // ...
  });
  
  const decision = {
    ...parseOrchestratorDecision(orchestratorOutput),
    insight_metrics: insightMetrics,
    decision_source: "fresh",
  };
  
  return { decision, orchestratorLatencyMs };
}
```

---

## 4. Обновление промпта `orchestrator_decision`

В seed-миграции (создать новую версию v2 промпта):

```sql
UPDATE public.prompts
SET is_active = false
WHERE prompt_key = 'orchestrator_decision' AND is_active = true;

INSERT INTO public.prompts (
  prompt_key, prompt_type, use_case, version, is_active,
  template, variables, model_hint, temperature, max_output_tokens, response_format
) VALUES (
  'orchestrator_decision', 'orchestrator', NULL, 2, true,
  $TEMPLATE$
Ты — оркестратор диалога. Твоя задача — после каждого сообщения пользователя решить, КАКАЯ ФАЗА должна быть следующей.

ТЕКУЩИЙ USE CASE: {{use_case}}
ДОСТУПНЫЕ ФАЗЫ: {{available_phases}}
ОСИ ИНФОРМАЦИИ: {{information_axes}}

⛔ ЗАБЛОКИРОВАННЫЕ ФАЗЫ (нельзя выбирать!):
{{blocked_phases}}

📊 INSIGHT METRICS:
{{insight_metrics_json}}

ПОДСКАЗКИ ИЗ МЕТРИК:
- TTM: {{ttm_hint}}
- ETV: {{etv_hint}}
- INSIGHT: {{insight_hint}}

ВРЕМЯ СУТОК: {{time_of_day}} ({{local_hour}}:00)
НОМЕР ИТЕРАЦИИ: {{iteration_number}} (soft cap: {{soft_cap}})
ПРОФИЛЬ: {{user_profile_summary}}
ИСТОРИЯ: {{conversation_history}}
ПОСЛЕДНЕЕ СООБЩЕНИЕ ПОЛЬЗОВАТЕЛЯ: {{user_message}}

—

ЗАДАЧА:

1. Оцени information_completeness каждой оси (0..1).
2. Оцени information_density текущего сообщения (0..1).
3. Определи user_signals: open, closed, self_reflective, deflecting, ready_for_action, needs_processing, disengaged, confused, verbose, terse.
4. Реши should_close на основе:
   - все оси выше threshold,
   - пользователь disengaged несколько ходов подряд,
   - soft cap исчерпан,
   - ИЛИ: ttm_stage = action/maintenance И инсайт уже был.
5. Выбери next_phase (из ДОСТУПНЫХ, исключая ЗАБЛОКИРОВАННЫЕ).

🆕 ПРАВИЛА С УЧЁТОМ INSIGHT METRICS:

A) Если ttm_stage = "preconcept":
   → Пользователь сопротивляется, не верит что у него есть проблема.
   → Используй фазу "deepen_inquiry" с открытыми вопросами.
   → НЕ предлагай инсайт прямо сейчас (он не примет).
   → НЕ переходи к практике.

B) Если ttm_stage = "concept":
   → Пользователь амбивалентен ("может быть...", "не уверен").
   → Используй "deepen_inquiry" чтобы помочь ему разобраться.
   → Можно осторожно ввести инсайт через "offer_insight".
   → Практику пока НЕ предлагать.

C) Если ttm_stage = "preparation":
   → Пользователь готов к действию.
   → Ускоряй переход к "ask_practice_intent" → "suggest_practice".
   → Если инсайта ещё не было, дай его быстро — затем сразу к практике.

D) Если ttm_stage = "action" / "maintenance":
   → Пользователь уже что-то делает.
   → Поддержи, можно сразу suggest_practice или confirm_and_close.

E) Если insight_detected = true:
   → Не давай ещё один инсайт сразу. 
   → Закрепи реакцию пользователя (короткое подтверждение от responder)
     или переходи к ask_practice_intent (если ttm позволяет).

F) Если ETV > 0.6 (высокая волатильность):
   → Пользователь раскачивается эмоционально.
   → Не торопись с практикой. Используй deepen_inquiry или offer_insight.
   → Soft cap эффективно увеличивается на 1-2 (даём ему время).

G) Если ETV < 0.3 и ttm_stage = preparation:
   → Пользователь стабилен и готов. Можно ускоряться к практике.

ФОРМАТ ОТВЕТА: строгий JSON (БЕЗ markdown блоков):
{
  "next_phase": "...",
  "reasoning": "1-2 предложения почему эта фаза, обязательно упомяни ttm_stage и insight_detected если они влияли на решение",
  "information_completeness": { ... },
  "information_density": 0.0..1.0,
  "user_signals": [...],
  "should_close": bool,
  "close_reason": "goal_reached|soft_cap_hit|user_disengaged|null",
  "responder_hints": {
    "tone": "warm|neutral|energising|calming",
    "use_user_phrases": [...],
    "avoid_topics": [...]
  }
}
$TEMPLATE$,
  '{
    "use_case": {"type": "string", "required": true},
    "available_phases": {"type": "string", "required": true},
    "information_axes": {"type": "string", "required": true},
    "blocked_phases": {"type": "string", "required": true},
    "insight_metrics_json": {"type": "string", "required": true},
    "ttm_hint": {"type": "string", "required": true},
    "etv_hint": {"type": "string", "required": true},
    "insight_hint": {"type": "string", "required": true},
    "time_of_day": {"type": "string", "required": true},
    "local_hour": {"type": "number", "required": true},
    "iteration_number": {"type": "number", "required": true},
    "soft_cap": {"type": "number", "required": true},
    "user_profile_summary": {"type": "string", "required": true},
    "conversation_history": {"type": "string", "required": true},
    "user_message": {"type": "string", "required": true}
  }'::jsonb,
  'gemini-2.5-flash',
  0.3,
  600,
  'json_object'
);
```

---

## 5. Сохранение в `messages.meta`

В обработчике сохранения сообщения assistant — добавляем `insight_metrics`:

```typescript
await saveMessage({
  conversationId,
  role: "assistant",
  content: cleanText,
  meta: {
    use_case: useCase,
    orchestrator_decision: decision,  // включает insight_metrics
    responder: { ... },
  }
});
```

Это даёт нам:
1. **Аналитику в `user_event_log`** — можно потом построить дашборд «как часто детектировался инсайт», «средний CSI на закрытие диалога».
2. **Откат при проблемах** — если новые правила окажутся слишком строгими, видно по логам где «застряло».
3. **A/B-тесты** — сравнение версий промптов через CSI на закрытии диалога.

---

## 6. Тесты

```typescript
// _legacy_web/app/api/_utils/insightDetection.test.ts

import { describe, it, expect } from "vitest";
import { 
  computeCSI, detectInsightMoment,
  estimateEmotionalValence, computeETV,
  detectTTMStage, isReadyForPractice,
} from "./insightDetection";

describe("computeCSI", () => {
  it("returns low CSI for past-tense self-focused message", () => {
    const text = "я был очень расстроен. меня обидели. я плакал.";
    expect(computeCSI(text, "ru")).toBeLessThan(0.3);
  });
  
  it("returns high CSI for future-oriented cognitive message", () => {
    const text = "я понимаю, что нужно сделать. теперь я знаю, как это связано. буду пробовать с этого момента.";
    expect(computeCSI(text, "ru")).toBeGreaterThan(0.5);
  });
  
  it("returns 0 for empty or very short message", () => {
    expect(computeCSI("", "ru")).toBe(0);
    expect(computeCSI("ага", "ru")).toBe(0);
  });
  
  it("works for English", () => {
    const text = "i understand now. i will try this from now on. it's because of...";
    expect(computeCSI(text, "en")).toBeGreaterThan(0.4);
  });
});

describe("detectInsightMoment", () => {
  it("detects insight when CSI grew from low to high", () => {
    const result = detectInsightMoment([0.2, 0.3, 0.6]);
    expect(result.detected).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.4);
  });
  
  it("does not detect when CSI is consistently low", () => {
    const result = detectInsightMoment([0.1, 0.2, 0.15]);
    expect(result.detected).toBe(false);
    expect(result.reason).toBe("csi_too_low");
  });
  
  it("does not detect when CSI is high but flat", () => {
    const result = detectInsightMoment([0.5, 0.55, 0.5]);
    expect(result.detected).toBe(false);
    expect(result.reason).toBe("no_growth");
  });
});

describe("computeETV", () => {
  it("returns 0 for stable valence", () => {
    expect(computeETV([0.5, 0.5, 0.5, 0.5])).toBeLessThan(0.1);
  });
  
  it("returns high for swinging valence", () => {
    expect(computeETV([0.8, -0.7, 0.6, -0.8])).toBeGreaterThan(0.6);
  });
});

describe("detectTTMStage", () => {
  it("detects preconcept resistance", () => {
    const result = detectTTMStage([
      "у меня нет проблем",
      "это всё из-за начальника"
    ], "ru");
    expect(result.stage).toBe("preconcept");
  });
  
  it("detects concept ambivalence", () => {
    const result = detectTTMStage([
      "может быть, что-то надо менять",
      "не уверена, надо ли"
    ], "ru");
    expect(result.stage).toBe("concept");
  });
  
  it("detects preparation readiness", () => {
    const result = detectTTMStage([
      "хочу попробовать",
      "что мне сделать прямо сейчас"
    ], "ru");
    expect(result.stage).toBe("preparation");
  });
});

describe("isReadyForPractice", () => {
  it("blocks practice in preconcept", () => {
    expect(isReadyForPractice("preconcept").ready).toBe(false);
  });
  
  it("blocks practice in concept", () => {
    expect(isReadyForPractice("concept").ready).toBe(false);
  });
  
  it("allows practice in preparation+", () => {
    expect(isReadyForPractice("preparation").ready).toBe(true);
    expect(isReadyForPractice("action").ready).toBe(true);
    expect(isReadyForPractice("maintenance").ready).toBe(true);
  });
});
```

---

## 7. Интеграционный тест

```typescript
describe("Insight Engine integration", () => {
  it("blocks suggest_practice when user is in preconcept", async () => {
    // Имитируем диалог пользователя в стадии сопротивления
    const messages = [
      { role: "user", content: "У меня нет проблем, это всё из-за людей вокруг" },
    ];
    
    const decision = await buildDecision({
      conversationIdWasNull: false,
      history: messages,
      userMessage: "Все это бред, мне ничего не нужно",
      // ...
    });
    
    expect(decision.next_phase).not.toBe("suggest_practice");
    expect(decision.next_phase).not.toBe("ask_practice_intent");
    expect(decision.insight_metrics?.ttm_stage).toBe("preconcept");
  });
  
  it("allows suggest_practice when user shows preparation", async () => {
    const messages = [
      { role: "user", content: "Я понимаю, что нужно что-то делать" },
      { role: "assistant", content: "..." },
      { role: "user", content: "Хочу попробовать прямо сейчас, что мне сделать" },
    ];
    
    const decision = await buildDecision({
      conversationIdWasNull: false,
      history: messages,
      userMessage: "Я готов",
      // ...
    });
    
    expect(decision.insight_metrics?.ready_for_practice).toBe(true);
  });
});
```

---

## Прогноз эффекта

| Параметр | До | После |
|---|---|---|
| Преждевременное предложение практики | часто | редко (заблокировано в preconcept/concept) |
| Адаптивная длина диалога | формальная (по soft_cap) | по ETV (волатильность) |
| Детекция инсайта | через эвристику оркестратора | через CSI с историей |
| Latency | без изменений | без изменений (метрики дешёвые JS) |
| Стоимость | без изменений (метрики локальные) | без изменений |
| Качество переходов «обсуждение → практика» | средне | высоко |

---

## Критерий приёмки

- ✅ Создан `insightDetection.ts` с 6 экспортируемыми функциями.
- ✅ Все unit-тесты проходят (10+ тестов).
- ✅ Структура `OrchestratorDecision` расширена полем `insight_metrics`.
- ✅ Промпт `orchestrator_decision` v2 активен в БД.
- ✅ В `messages.meta` сохраняется `insight_metrics` для всех assistant-сообщений.
- ✅ Интеграционный тест: пользователь в `preconcept` НЕ получает предложения практики.
- ✅ Тестовый сценарий: после ответа «у меня нет проблем» → следующая фаза НЕ `suggest_practice`.
