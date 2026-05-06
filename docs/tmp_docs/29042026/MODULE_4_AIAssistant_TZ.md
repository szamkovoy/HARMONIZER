# MODULE 4: AI-ASSISTANT (Orchestrator-Driven Dialogue) — Полное техническое задание

## Назначение

ИИ-ассистент — это диалоговый слой, который ведёт пользователя от запроса (калибровка психологического профиля или обсуждение дневной рекомендации) до полезного результата (откалиброванная карта или предложение практики йоги). Главное отличие от классических ботов: **диалог не следует фиксированному сценарию, а адаптируется к пользователю в реальном времени.**

Use cases:

1. **Калибровка** — после первой регистрации или по запросу из настроек. Цель: уточнить S и H планет на основе самовосприятия пользователя, заполнить states_map и user_lexicon.
2. **Дневной диалог** — при нажатии «Конкретней» под рекомендацией или на иконке окна возможностей. Цель: дать инсайт + предложить уместную практику.

В обоих случаях используется одна и та же архитектура **Orchestrator-Driven Dialogue**, но с разными целевыми функциями.

---

## Принципиальная архитектура: Orchestrator-Driven Dialogue

Это ключевое архитектурное решение. Вместо фиксированного конечного автомата (`greeting → collect_state → close` с предопределённым числом итераций) используется двухуровневая модель:

```
                            ┌─────────────────────────────┐
                            │   ORCHESTRATOR (мета-LLM)   │
                            │  Решает: какая фаза сейчас, │
                            │  что нужно собрать, готовы  │
                            │  ли мы к финалу             │
                            │  Модель: gemini-2.5-flash   │
                            │  Output: структурированный  │
                            │  decision JSON              │
                            └────────────┬────────────────┘
                                         │
                    подсказка             │  передаёт фазу + инструкции
                    о фазе                │
                                         ↓
┌────────────────┐                ┌─────────────────────────────┐
│   USER MSG     │ ─────────────→ │  RESPONDER (основной LLM)   │
│                │                │  Генерирует ответ для        │
│                │ ←───────────── │  пользователя, опираясь на   │
│                │  ответ +       │  текущую фазу, лексику,      │
│                │  state markers │  стиль                       │
└────────────────┘                │  Модель: gemini-2.5-flash    │
                                  │  Output: streamed text +     │
                                  │  inline markers              │
                                  └─────────────────────────────┘
```

### Что делает Orchestrator

После каждого сообщения пользователя (до того, как Responder начнёт отвечать) — короткий вызов оркестратора. Он анализирует:
- **Information completeness** — какая информация уже собрана и что ещё нужно. Каждый use case определяет свой набор «осей»:
  - Для калибровки: упомянуты ли все 7 чакр? Сильные и слабые стороны?
  - Для дневного диалога: понятно ли состояние, контекст дня, доступное время?
- **Information density** — насколько информативно отвечает пользователь. Анализ длины, конкретности, открытости.
- **User signals** — пользователь готов к действию? Сопротивляется? Хочет глубже?
- **Time of day** — утро / день / вечер. Влияет на тип финального предложения.
- **Dialog length** — сколько уже было обменов сообщениями.

И решает: **какая следующая фаза**.

### Что делает Responder

Это основной LLM, который генерирует видимый текст ответа. Он получает:
- Текущую фазу от оркестратора («ты сейчас в фазе deep_inquiry»).
- Стилевые подсказки (лексика пользователя, time of day).
- Контекст диалога (последние сообщения).
- Цель текущей фазы.

Responder **не решает**, когда переходить к практике или закрывать диалог. Это решает оркестратор. Responder только производит уместную реплику.

---

## Архитектура фаз: декларативная, не процедурная

Вместо линейной последовательности фаз — **граф возможных переходов** с условиями. Оркестратор выбирает следующую фазу из доступных, опираясь на собранную информацию.

### Фазы для use case «calibration»

```
                                ┌───────────────────┐
                          start →│ welcome_and_hint  │← начало
                                 └─────────┬─────────┘
                                           │
                                  ┌────────┴────────────┐
                                  │   listen_user       │  пользователь говорит
                                  └────────┬────────────┘
                                           │
                                ┌──────────┴──────────────┐
                                │                         │
                                ↓                         ↓
                         ┌────────────────┐    ┌────────────────────┐
                         │ deepen_specific │←──→│ acknowledge_and_close │
                         │ chakra          │    └────────┬───────────┘
                         └────────┬───────┘             │
                                  │                     ↓
                                  └─────────────→ [end → /api/calibration/extract]
```

**Логика:**
- `welcome_and_hint` — приветствие, объяснение, что ждём от пользователя
- `listen_user` — пользователь говорит (system phase, не генерирует ответ ассистента)
- `deepen_specific_chakra` — оркестратор увидел, что одна из чакр нечётко описана и стоит уточнить
- `acknowledge_and_close` — благодарность, объяснение, что калибровка проведена, переход на главный экран

Оркестратор может **не вызывать** `deepen_specific_chakra`, если первый ответ уже исчерпывающий. Может вызвать его 1-3 раза для разных чакр. Жёсткого ограничения нет — есть **soft cap = 4 итерации**, после которого оркестратор предпочитает закрыть.

### Фазы для use case «daily_dialog»

```
                          ┌──────────────────────┐
                  start →│ contextual_greeting   │
                          └──────────┬───────────┘
                                     ↓
                          ┌──────────────────────┐
                          │ collect_state         │
                          └──────────┬───────────┘
                                     ↓
                  ┌──────────────────┴──────────────────┐
                  ↓                  ↓                  ↓
        ┌──────────────────┐ ┌────────────────┐ ┌────────────────┐
        │ deepen_inquiry   │ │ offer_insight  │ │ ask_practice_  │
        │ (если мало инф)  │ │ (1 инсайт)     │ │   intent       │
        └──────────┬───────┘ └────────┬───────┘ └────────┬───────┘
                   ↓                  ↓                  ↓
                 [back to              ↓                  ↓
                  collect_state]   ┌──────────────────────┐
                                   │ suggest_practice     │
                                   └──────────┬───────────┘
                                              ↓
                                   ┌──────────────────────┐
                                   │ confirm_and_close    │
                                   └──────────────────────┘
```

**Логика:**
- `contextual_greeting` — приветствие, учитывающее time of day и entry source
- `collect_state` — узнаём, что с пользователем сейчас
- `deepen_inquiry` — один уточняющий вопрос если информации мало (soft cap 2 раза)
- `offer_insight` — даём один инсайт о связи состояния с темой дня
- `ask_practice_intent` — спрашиваем длительность и тип
- `suggest_practice` — конкретное предложение, может повториться 2-3 раза если пользователь хочет другую
- `confirm_and_close` — подтверждение, корректировка дневной рекомендации (если нужно)

**Soft cap = 6 итераций** для дневного диалога. После него оркестратор плавно переводит к практике.

### Принципы дизайна фаз

1. **Stateless фазы** — каждая фаза описана в `prompts` table как самодостаточная инструкция. Можно менять без передеплоя.
2. **Не все фазы обязательны** — оркестратор может пропускать те, что не нужны для конкретного пользователя.
3. **Циклы разрешены** — `collect_state ↔ deepen_inquiry` могут зацикливаться 1-2 раза.
4. **Soft cap, не hard cap** — после soft cap оркестратор предпочитает закрытие, но не рубит на полуслове.

---

## Контракт данных

### Структура prompts (расширенная)

В дополнение к структуре из предыдущей версии:

```sql
-- prompt_type расширяется
ALTER TABLE public.prompts 
  DROP CONSTRAINT IF EXISTS prompts_prompt_type_check,
  ADD CONSTRAINT prompts_prompt_type_check 
  CHECK (prompt_type IN ('system', 'phase', 'orchestrator', 'extraction', 'summary', 'recommendation', 'portrait'));
```

`prompt_type = 'phase'` — для фазовых инструкций (заменяет `'stage'` из предыдущей версии).

### Структура messages.meta для оркестратора

`messages.meta` уже jsonb, миграция не нужна. Используем расширенную структуру:

```json
{
  "use_case": "daily_dialog",
  "orchestrator_decision": {
    "next_phase": "offer_insight",
    "reasoning": "Пользователь дал плотный ответ за 1 ход, тема ясна, готов к инсайту",
    "information_completeness": {
      "user_state": 0.9,
      "context": 0.7,
      "practice_intent": 0.0
    },
    "information_density": 0.85,
    "user_signals": ["open", "self_reflective"],
    "iteration_number": 2,
    "soft_cap_remaining": 4,
    "decision_source": "fresh"
  },
  "responder": {
    "phase_used": "offer_insight",
    "extracted_states": ["lost_meaning", "exhaustion"],
    "ai_state_proposals": [],
    "tokens_used": { "input": 1456, "output": 187 },
    "model_used": "gemini-2.5-flash"
  }
}
```

**Пример при greeting bypass** (первый ход, оркестратор не вызывался):

```json
{
  "use_case": "daily_dialog",
  "orchestrator_decision": {
    "next_phase": "contextual_greeting",
    "reasoning": "Bypass: первый ход диалога, фаза детерминирована",
    "information_completeness": {},
    "information_density": 0,
    "user_signals": [],
    "iteration_number": 1,
    "decision_source": "bypass_greeting",
    "bypass_reason": "no_history"
  },
  "responder": { ... }
}
```

**Пример при cache reuse** (на ходах ≥ 3):

```json
{
  "use_case": "daily_dialog",
  "orchestrator_decision": {
    "next_phase": "deepen_inquiry",
    "reasoning": "Reused: similarity 0.85 > 0.8 threshold at iter 3",
    "information_completeness": { "user_state": 0.4, "context": 0.3 },
    "information_density": 0.3,
    "user_signals": ["terse", "deflecting"],
    "iteration_number": 3,
    "decision_source": "cache_reused",
    "cache_similarity": 0.85
  },
  "responder": { ... }
}
```

### Структура orchestrator_decision (output оркестратора)

```typescript
interface OrchestratorDecision {
  next_phase: string;                      // ID фазы из prompts
  reasoning: string;                       // короткое обоснование (для логов и debug)
  
  information_completeness: {              // 0..1 по каждой оси
    [axis: string]: number;
  };
  information_density: number;             // 0..1, насколько информативно отвечает пользователь
  
  user_signals: UserSignal[];              // массив обнаруженных сигналов
  
  should_close: boolean;                   // подсказка: переходить ли к финалу
  close_reason?: "goal_reached" | "soft_cap_hit" | "user_disengaged";
  
  responder_hints?: {                      // подсказки Responder'у
    tone?: "warm" | "neutral" | "energising" | "calming";
    use_user_phrases?: string[];           // конкретные фразы пользователя для ре-юза
    avoid_topics?: string[];
  };
  
  // Метаданные источника решения (заполняются бэкендом, не LLM)
  decision_source?: "fresh" | "bypass_greeting" | "cache_reused";
  cache_similarity?: number;               // только при cache_reused (0..1)
  bypass_reason?: string;                  // только при bypass_greeting
}

type UserSignal = 
  | "open"                | "closed"
  | "self_reflective"     | "deflecting"
  | "ready_for_action"    | "needs_processing"
  | "disengaged"          | "confused"
  | "verbose"             | "terse";
```

**Важно:** поля `decision_source`, `cache_similarity`, `bypass_reason` НЕ передаются в LLM (их не существует на момент вызова) и не должны присутствовать в JSON, который оркестратор возвращает. Они проставляются бэкендом после получения решения (свежего, переиспользованного из кеша или синтетического для bypass) и сохраняются в `messages.meta` для аналитики.

---

## Цели и оси информации по use case

Это **самая важная часть** настройки оркестратора. Каждый use case определяет, что считается «достаточной» информацией.

### Use case: calibration

```typescript
const CALIBRATION_AXES = {
  positive_traits_described: {
    weight: 0.3,
    description: "Пользователь описал свои сильные стороны и ресурсы",
    threshold: 0.6
  },
  challenges_described: {
    weight: 0.3,
    description: "Пользователь описал свои слабые места и зоны напряжения",
    threshold: 0.6
  },
  chakras_coverage: {
    weight: 0.4,
    description: "Сколько из 7 чакр явно или косвенно упомянуты в речи",
    threshold: 0.5  // 4+ из 7
  }
};
```

Когда суммарная информация по этим осям достигает 0.7 (взвешенно) — оркестратор переходит в `acknowledge_and_close`.

### Use case: daily_dialog

```typescript
const DAILY_DIALOG_AXES = {
  user_state: {
    weight: 0.3,
    description: "Понятно ли текущее состояние пользователя (физическое, эмоциональное)",
    threshold: 0.6
  },
  context: {
    weight: 0.2,
    description: "Понятен ли контекст дня (что уже было, что предстоит)",
    threshold: 0.4
  },
  insight_offered: {
    weight: 0.2,
    description: "Был ли пользователю предложен инсайт связи его состояния с темой дня",
    threshold: 1.0    // 0 или 1 — был или не был
  },
  practice_intent: {
    weight: 0.3,
    description: "Известны ли длительность и тип желаемой практики",
    threshold: 0.8
  }
};
```

`practice_intent` нужен для перехода в `suggest_practice`. Если он 0 — оркестратор выбирает `ask_practice_intent`.

### Time of day влияние

```typescript
function timeOfDayHints(localHour: number): { tone: string; preferredPracticeKinds: string[] } {
  if (localHour >= 5 && localHour < 11)  return { tone: "energising", preferredPracticeKinds: ["asanas", "pranayama"] };
  if (localHour >= 11 && localHour < 17) return { tone: "neutral",    preferredPracticeKinds: ["pranayama", "meditation"] };
  if (localHour >= 17 && localHour < 21) return { tone: "warm",       preferredPracticeKinds: ["meditation", "pranayama"] };
  return { tone: "calming", preferredPracticeKinds: ["meditation"] };  // ночь
}
```

Это передаётся оркестратору как input → он включает в `responder_hints`.

---

## Промпт оркестратора (базовый, будет в seed)

`prompt_key = "orchestrator_decision"`, `prompt_type = "orchestrator"`:

```
Ты — оркестратор диалога в приложении психологической гармонизации. Ты не общаешься 
с пользователем напрямую. Твоя задача — после каждого сообщения пользователя решить, 
КАКАЯ ФАЗА должна быть следующей в диалоге.

ТЕКУЩИЙ USE CASE: {{use_case}}
ДОСТУПНЫЕ ФАЗЫ для этого use case:
{{available_phases}}

ОСИ ИНФОРМАЦИИ для этого use case:
{{information_axes}}

ВРЕМЯ СУТОК пользователя: {{time_of_day}} ({{local_hour}}:00 локально)
ПОДСКАЗКА ПО ВРЕМЕНИ: {{time_of_day_hint}}

НОМЕР ИТЕРАЦИИ: {{iteration_number}} (soft cap: {{soft_cap}})

ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ (краткая сводка):
{{user_profile_summary}}

ИСТОРИЯ ДИАЛОГА:
{{conversation_history}}

ПОСЛЕДНЕЕ СООБЩЕНИЕ ПОЛЬЗОВАТЕЛЯ:
{{user_message}}

—

ЗАДАЧА:

1. Оцени, насколько каждая ось информации заполнена (0..1) на основе всего диалога.

2. Оцени information_density последнего сообщения (0..1):
   - 0.0–0.3 — короткое, неинформативное ("ну норм", "не знаю")
   - 0.3–0.6 — обычное
   - 0.6–1.0 — плотное, развёрнутое, с конкретикой

3. Определи user_signals из списка: open, closed, self_reflective, deflecting, 
   ready_for_action, needs_processing, disengaged, confused, verbose, terse.

4. Реши, нужно ли закрывать диалог (should_close = true), если:
   - Все оси превысили threshold;
   - Soft cap исчерпан и пользователь не углубляется;
   - Пользователь disengaged или несколько раз "не знаю";
   - Цель достигнута.

5. Выбери next_phase из ДОСТУПНЫХ. Если should_close — выбери закрывающую фазу.

6. Дай responder_hints: tone (warm / neutral / energising / calming), какие фразы 
   пользователя стоит ре-юзнуть в ответе, какие темы избегать.

ПРАВИЛА:
- Если пользователь сразу дал плотный ответ (density > 0.7) — НЕ задавай уточняющих 
  вопросов. Переходи к insight или practice.
- Если пользователь terse 2 раза подряд — переходи к offer_insight или 
  ask_practice_intent. Не дави.
- Циклы deepen_inquiry → collect_state допустимы максимум 2 раза.
- Если есть phase "ai_state_proposal_check" и в речи пользователя обнаружено новое 
  устойчивое описание состояния — можно её вставить.

ФОРМАТ ОТВЕТА: строгий JSON, без markdown:
{
  "next_phase": "...",
  "reasoning": "1-2 предложения почему эта фаза",
  "information_completeness": { "axis_name": 0.0..1.0, ... },
  "information_density": 0.0..1.0,
  "user_signals": [...],
  "should_close": true|false,
  "close_reason": "goal_reached" | "soft_cap_hit" | "user_disengaged" | null,
  "responder_hints": {
    "tone": "warm|neutral|energising|calming",
    "use_user_phrases": ["...", "..."],
    "avoid_topics": []
  }
}
```

Модель: `gemini-2.5-flash`, `temperature: 0.3` (нужна стабильность решений), `max_output_tokens: 512`.

---

## Промпт responder (базовый)

`prompt_key = "responder_main"`, `prompt_type = "system"`:

```
Ты — Эмпатичный Помощник в приложении психологической гармонизации.

ОСНОВНЫЕ ПРИНЦИПЫ:
- Ты говоришь в стиле и лексике пользователя (их фразы — ниже).
- НЕ упоминаешь астрологию, чакры, аспекты, транзиты, гороскоп — если пользователь 
  сам не спрашивает про это.
- Говоришь о состояниях, теле, отношениях, делах — на бытовом языке.
- Каждое сообщение — 1-3 коротких предложения. Без воды.
- Ты не психотерапевт, не лектор, не эзотерик. Ты внимательный собеседник, 
  который точно слушает и точно отзеркаливает.

ТЕКУЩАЯ ФАЗА: {{current_phase}}
ИНСТРУКЦИЯ ДЛЯ ЭТОЙ ФАЗЫ:
{{phase_instruction}}

TONE: {{tone}}
СТИЛЬ ПОЛЬЗОВАТЕЛЯ: {{style_markers}}

ЛЕКСИКА ПОЛЬЗОВАТЕЛЯ (используй когда уместно): 
{{user_phrases}}

ПОДСКАЗКИ ОТ ОРКЕСТРАТОРА:
- Использовать фразы: {{use_user_phrases}}
- Избегать тем: {{avoid_topics}}

ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ:
{{user_profile_summary}}

КОНТЕКСТ ТЕКУЩЕГО ДНЯ (для use_case=daily_dialog):
{{daily_context}}

—

СПЕЦИАЛЬНЫЕ МАРКЕРЫ В ОТВЕТЕ:

Если ты заметил в речи пользователя устойчивое описание состояния, которого нет в 
его states_map, добавь в КОНЕЦ ответа маркер (он будет вырезан перед показом):

[STATE_PROPOSAL: planet="Sun" label="тащу через силу" polarity="negative"]

Если в фазе suggest_practice ты выбираешь практику из стека, ты можешь её 
прокомментировать, но финальный выбор будет сделан backend-логикой. Не выдумывай 
ID практик.

—

Сейчас ответь пользователю в фазе {{current_phase}}.
```

Модель: `gemini-2.5-flash`, `temperature: 0.7`, `max_output_tokens: 400`.

---

## Промпты фаз

Каждая фаза — отдельная запись в `prompts` с `prompt_type = 'phase'`.

### Калибровка

**`phase_welcome_and_hint`:**
```
Это начало калибровки психологического портрета. Только что пользователь увидел 
описание себя, сгенерированное по натальным данным.

Поприветствуй ({{time_of_day_greeting}}) и кратко (1 предложение) объясни, что ты 
рад уточнить портрет. Предложи нажать кнопку микрофона и рассказать:
- что попало точно,
- что не так,
- что хочется добавить.

Подчеркни в одной фразе: "Это не редактирование текста — это перестройка фундамента, 
из которого описание получилось". Используй именно эту мысль.

Длина: ~3-4 предложения.
```

**`phase_listen_user`:** служебная, ассистент не отвечает (просто принимает голосовое).

**`phase_deepen_specific_chakra`:**
```
Оркестратор определил, что одна тема не до конца ясна. Тема: {{focus_chakra_label}}
(чакра номер {{focus_chakra_number}}).

Задай ОДИН короткий вопрос про эту тему — не упоминая саму чакру. Используй язык 
состояний.

Например, если фокус на 1 чакре (Луна) — спроси про телесное самочувствие, сон, 
способность расслабиться. Если на 5 чакре (Сатурн) — про самовыражение, речь, 
способность отстаивать своё.

Длина: 1-2 предложения.
```

**`phase_acknowledge_and_close`:**
```
Калибровка завершена. Поблагодари пользователя по сути его ответов (упомяни 1-2 
конкретные вещи, которые он сказал). Затем фиксированная фраза:

"Благодарю! Карта твоих внутренних сил скорректирована. Ты можешь найти её в 
настройках и провести калибровку снова в любой момент."

После твоего ответа диалог закроется и пользователь перейдёт на главный экран.
```

### Дневной диалог

**`phase_contextual_greeting`:**
```
Пользователь только что нажал {{entry_source_label}}. Источник: {{entry_source}}.

Поприветствуй ({{time_of_day_greeting}}: "Доброе утро" / "Добрый день" / "Добрый 
вечер"). 

Сделай короткий контекстный заход (1 предложение):
- entry_source = "home": лёгкая отсылка к теме дня без астрологических терминов
- entry_source = "event_reminder": "Вижу, ты пришёл к окну в {{window_time}}..."
- entry_source = "stories": "Пришёл из сторис..."

Время суток адаптируй вопросы:
- утро: "Как спалось? Какие планы на день?"
- день: "Как проходит день? Что сейчас на тебе?"  
- вечер: "Как прошёл день? Что хочется отпустить?"
- ночь: "Засыпаешь? Хочешь короткую успокаивающую практику?"

Длина: 2-3 предложения.
```

**`phase_collect_state`:**
```
Узнай, что с пользователем сейчас. Если он в greeting уже сказал — НЕ переспрашивай.

Иначе: предложи в одной фразе 4-5 коротких вариантов состояний (на выбор) — взяв 
их из его positive_states и negative_states по сегодняшней теме:
{{today_states_options}}

Подскажи, что можно ответить голосом.
```

**`phase_deepen_inquiry`:**
```
Информации мало. Оркестратор просит копнуть глубже в одну ось: {{deepen_axis}}.
- "user_state" → "А в теле сейчас что чувствуется?" / "Что в фоне эмоций?"
- "context" → "Что было с утра?" / "Что предстоит?"

Задай ОДИН тёплый, открытый вопрос. Не давай интерпретаций. Не учи.

Длина: 1-2 предложения.
```

**`phase_offer_insight`:**
```
Дай ОДИН инсайт о связи состояния пользователя с темой дня. Это сердце диалога.

Тема дня (зашифрованная для тебя): {{planet_of_day_summary}}.
Состояние пользователя: {{user_current_state_summary}}.

Инсайт должен быть:
- Не очевидным ("ты устал, поэтому отдохни" — НЕ инсайт).
- Связывающим внешнее с внутренним ("замечал, что когда {X}, у тебя обычно {Y}?").
- В лексике пользователя.

Длина: 2-3 предложения. После инсайта — короткая пауза-вопрос: "Откликается?"
```

**`phase_ask_practice_intent`:**
```
Пора предложить практику. Спроси:
- Сколько у пользователя есть времени (5/10/20/30+ мин)
- Какой тип хочет (медитация/пранаяма/асаны)

Адаптируй к {{tone}}:
- утро: можешь предложить асаны для бодрости.
- вечер: чаще медитацию или пранаяму.
- ночь: только медитацию.

1-2 предложения.
```

**`phase_suggest_practice`:**
```
Из отобранного стека практик:
{{filtered_practices_list}}

Выбери ОДНУ — которая лучше всего подходит по всем параметрам и которую 
пользователь не выполнял давно. Представь её в 2 предложениях:
- что это (название + суть)
- почему именно сейчас (1 фраза, связанная с состоянием пользователя).

В конце добавь маркер выбора:
[PRACTICE_PICK: id="..." reason="..."]

Финальный выбор будет произведён бэкендом.
```

**`phase_confirm_and_close`:**
```
Подтверди выбор практики. Скажи короткое тёплое напутствие в стиле пользователя 
(1 предложение). 

Если в диалоге пользователь сказал что-то, что меняет дневную рекомендацию (например 
"я в самолёте сегодня") — добавь маркер:

[CORRECT_RECOMMENDATION: short_text="..." windows_correction="..."]

Длина: 2-3 предложения.
```

---

## Эндпоинты бэкенда

### POST /api/communicator/v2/dialog

```
Headers: Authorization: Bearer <supabase_jwt>
Content-Type: application/json
Body: {
  "conversationId": "uuid" | null,
  "useCase": "calibration" | "daily_dialog",
  "entrySource": "home" | "event_reminder" | "practice_discuss" | "stories" | "onboarding",
  "triggerMeta": { ... },
  "userMessage": "транскрибированный текст",
  "userTimezone": "Europe/Prague"
}

Backend logic:
1. Validate JWT, rate limit
2. Load context (calibration, forecast, history, profile)
3. ОПРЕДЕЛЕНИЕ ФАЗЫ — три пути (см. раздел «Оптимизации latency и стоимости»):
   
   3a. **Greeting bypass** — если это первый ход в диалоге (history.length == 0 ИЛИ 
       conversationId == null), пропускаем оркестратор. Фаза заранее известна:
       - useCase == "calibration" → phase = "welcome_and_hint"
       - useCase == "daily_dialog" → phase = "contextual_greeting"
       Сохраняем decision_source = "bypass_greeting" в meta.
   
   3b. **Decision cache hit** — если itrationNumber >= 3 и контекст квалифицируется как 
       "почти не изменился" (см. раздел про кеширование), берём предыдущее decision, 
       помечаем decision_source = "cache_reused".
   
   3c. **Full orchestrator call** — иначе вызываем оркестратор:
       - Build orchestrator prompt with all context
       - Call gemini-2.5-flash, parse JSON output → OrchestratorDecision
       - Сохраняем decision_source = "fresh".

4. Если decision.next_phase == "listen_user" — никакой ответ не нужен 
   (служебная фаза для калибровки, ждём следующего голосового). Возвращаем {phase, no_response: true}.
5. ВЫЗОВ RESPONDER:
   - Load phase prompt by next_phase
   - Build responder prompt with phase + responder_hints
   - Stream gemini-2.5-flash response
6. Parse markers from response:
   - [STATE_PROPOSAL: ...] → save в ai_state_proposals
   - [PRACTICE_PICK: id="..."] → trigger /select-practice логика
   - [CORRECT_RECOMMENDATION: ...] → trigger /correct-recommendation
7. Save messages with full meta (orchestrator decision + responder data + decision_source)
8. Stream response к клиенту

Response: SSE stream
event: orchestrator_decision
data: { ...OrchestratorDecision }

event: chunk
data: { text: "..." }

event: complete
data: {
  messageId, fullText, 
  shouldClose: bool, 
  practicePicked?: { id, name },
  recommendationCorrected?: { newShortText }
}
```

**Latency и стоимость по типам ходов:**

| Тип хода | Оркестратор | Responder | Total to first token | Вызовов LLM |
|---|---|---|---|---|
| Greeting (первый ход) | bypass | streaming | ~300мс | 1 |
| Cached decision | bypass (cache hit) | streaming | ~300мс | 1 |
| Fresh orchestrator | 500-800мс | streaming | ~1000мс | 2 |

В среднем (по нашим оценкам) ~30% ходов попадут в bypass или cache hit, что снижает совокупный LLM-bill на 15-20%. Подробности — в разделе «Оптимизации latency и стоимости» ниже.

### POST /api/communicator/v2/transcribe

Без изменений из предыдущего ТЗ — Groq Whisper-v3.

### POST /api/communicator/v2/greeting

Это **shortcut endpoint** для случая «пользователь только что нажал кнопку, ничего ещё не сказал». Внутри он эквивалентен вызову `/dialog` с пустым userMessage и принудительным greeting bypass.

```
Body: { useCase, entrySource, triggerMeta, userTimezone }
Response: { conversationId, greetingText, suggestedOptions: [...] }

Бэкенд:
1. Создаёт новую conversation (entry_source, trigger_meta).
2. Запускает Responder напрямую с фазой "welcome_and_hint" (calibration) 
   или "contextual_greeting" (daily_dialog). Без оркестратора.
3. Возвращает текст приветствия и suggestedOptions (для daily_dialog — 
   предложенные варианты ответов из states_map для сегодняшней чакры).
4. Cache TTL = 1 час по ключу 
   (useCase, entrySource, planet_of_day, time_of_day_bucket, calibration_version)
   — если в кеше есть, возвращаем из кеша без LLM-вызова.

Latency: 300-500мс (без оркестратора, только responder со стримингом).
Cache hit rate: ожидаем ~80% (приветствия похожи в одинаковых условиях).
```

**Важно для клиента:** после получения greetingText пользователь продолжает диалог через `/dialog` (а не через повторный `/greeting`).

### Остальные эндпоинты

`/select-practice`, `/correct-recommendation`, `/recommendation-text` — без изменений из предыдущего ТЗ.

---

## Оптимизации latency и стоимости

Базовая архитектура «оркестратор + responder» делает два LLM-вызова на каждый ход пользователя. Это качественнее, чем один вызов с переусложнённым промптом, но даёт +500-800мс задержки и удваивает токены оркестратора.

Чтобы не платить эту цену там, где она не нужна, реализуем две оптимизации.

### Оптимизация 1: Greeting bypass

**Что это:** при первом ходе в новом диалоге (или при вызове `/greeting`) фаза заранее известна, оркестратору решать нечего. Полностью пропускаем его вызов.

**Когда применяется:**
```
greetingBypass(req) = (
  req.conversationId == null OR
  history(req.conversationId).length == 0
)
```

**Что происходит:**
- Загружаем сразу промпт фазы `welcome_and_hint` (calibration) или `contextual_greeting` (daily_dialog).
- Конструируем синтетический `OrchestratorDecision`:
  ```typescript
  const syntheticDecision: OrchestratorDecision = {
    next_phase: useCase === "calibration" ? "welcome_and_hint" : "contextual_greeting",
    reasoning: "Bypass: первый ход диалога, фаза детерминирована",
    information_completeness: {},
    information_density: 0,
    user_signals: [],
    should_close: false,
    responder_hints: {
      tone: timeOfDayHints(localHour).tone,
      use_user_phrases: [],
      avoid_topics: []
    }
  };
  ```
- Передаём в Responder как обычно.
- В `messages.meta.orchestrator_decision` сохраняем синтетический decision, но дополнительно — `decision_source: "bypass_greeting"` для аналитики.

**Эффект:**
- Latency первого видимого токена: с ~1000мс до ~300-500мс (только Responder).
- Стоимость: -1 LLM-вызов на каждый новый диалог.
- Так как `/greeting` дополнительно кешируется (TTL 1 час) — при cache hit нет вообще ни одного LLM-вызова.

**Граничные случаи:**
- Если пользователь начинает диалог через `/dialog` напрямую (не через `/greeting`) с непустым userMessage в первом запросе — greetingBypass всё равно срабатывает, но Responder получает userMessage и фаза `contextual_greeting` приветствует его, отвечая на вопрос. Оркестратор включится со второго хода.
- Если по какой-то причине история есть, но фаза листенера-молчания (`listen_user` для калибровки) — greetingBypass НЕ срабатывает, оркестратор вызывается.

### Оптимизация 2: Decision caching после стабилизации

**Что это:** после 3 итераций, если контекст «почти не изменился», переиспользуем предыдущее `OrchestratorDecision` вместо нового LLM-вызова.

**Когда применяется:**
```
canReuseDecision(req, history) = (
  iterationNumber >= 3 AND
  hasPreviousDecision(history) AND
  previousDecision.next_phase NOT IN TERMINAL_PHASES AND
  contextSimilarity(currentMessage, previousMessage, previousDecision) > 0.8
)

TERMINAL_PHASES = [
  "acknowledge_and_close",
  "confirm_and_close", 
  "suggest_practice"  // эти всегда требуют свежей оценки
]
```

**Как считается `contextSimilarity`:**

Это **детерминированная функция без LLM-вызова**, основанная на эвристиках. Возвращает значение 0..1.

```typescript
function contextSimilarity(
  currentMessage: string,
  previousMessage: string,
  previousDecision: OrchestratorDecision
): number {
  let score = 0;
  
  // 1. Длина текущего сообщения сопоставима с предыдущим (±50%)
  const lenRatio = Math.min(currentMessage.length, previousMessage.length) /
                   Math.max(currentMessage.length, previousMessage.length);
  if (lenRatio > 0.5) score += 0.3;
  
  // 2. Density estimation (та же эвристика, что использовал бы оркестратор)
  const currentDensity = estimateDensity(currentMessage);
  const previousDensity = previousDecision.information_density;
  if (Math.abs(currentDensity - previousDensity) < 0.2) score += 0.3;
  
  // 3. Нет ключевых маркеров перехода в речи пользователя
  const transitionMarkers = [
    /давай(те)? (попроб|сделаем|начнём)/i,    // готовность к действию
    /хочу (попроб|сделать|выполнить)/i,
    /(сколько времени|какая практика|какую)/i,  // запрос практики
    /(всё|хватит|закончим|давай уже)/i,        // желание закрыть
    /(а если|а что|а почему|расскажи)/i        // желание глубже
  ];
  const hasTransition = transitionMarkers.some(rx => rx.test(currentMessage));
  if (!hasTransition) score += 0.2;
  
  // 4. Совпадение dominant signal pattern
  const currentSignals = quickSignalDetection(currentMessage); 
  const previousSignals = previousDecision.user_signals;
  const overlap = currentSignals.filter(s => previousSignals.includes(s)).length;
  const signalSimilarity = overlap / Math.max(currentSignals.length, 1);
  score += 0.2 * signalSimilarity;
  
  return Math.min(score, 1.0);
}

// Грубая оценка плотности по характеристикам строки
function estimateDensity(text: string): number {
  if (!text || text.length < 10) return 0.0;
  const wordCount = text.trim().split(/\s+/).length;
  if (wordCount < 5) return 0.1;
  if (wordCount < 15) return 0.4;
  if (wordCount < 50) return 0.7;
  return 0.9;
}

// Быстрое определение сигналов без LLM
function quickSignalDetection(text: string): UserSignal[] {
  const signals: UserSignal[] = [];
  const len = text.trim().length;
  const wordCount = text.trim().split(/\s+/).length;
  
  if (wordCount > 80) signals.push("verbose");
  else if (wordCount < 10) signals.push("terse");
  
  if (/я (не|не знаю|не уверен)/i.test(text)) signals.push("deflecting");
  if (/я (чувствую|думаю|замечаю|вижу)/i.test(text)) signals.push("self_reflective");
  if (/(давай|хочу|готов|пора)/i.test(text)) signals.push("ready_for_action");
  
  return signals;
}
```

**Что происходит при cache hit:**
- Берём `previousDecision` из meta предыдущего ассистент-сообщения.
- Конструируем «обновлённый» decision:
  ```typescript
  const reusedDecision: OrchestratorDecision = {
    ...previousDecision,
    reasoning: `Reused: similarity ${similarity.toFixed(2)} > 0.8 threshold at iter ${iterationNumber}`,
    // Обновляем эфемерные поля
    information_density: estimateDensity(currentMessage),
    user_signals: quickSignalDetection(currentMessage)
  };
  ```
- В `messages.meta.orchestrator_decision` сохраняем с `decision_source: "cache_reused"` и `cache_similarity: 0.85`.

**Эффект:**
- Ожидаемая частота cache hit на ходах 3+: ~25-35% (зависит от пользователя).
- Latency на cache hit: ~300-500мс вместо ~1000мс.
- Стоимость: -1 LLM-вызов на каждый кешированный ход.

**Защита от стагнации:**
Если последние 2 кешированных decision подряд → принудительно вызываем оркестратора, даже если similarity > 0.8. Это гарантирует, что мы не залипнем в одной фазе.

```typescript
function shouldForceFreshDecision(history): boolean {
  const lastTwo = history.slice(-2)
    .filter(m => m.role === "assistant")
    .map(m => m.meta?.orchestrator_decision?.decision_source);
  return lastTwo.length === 2 && lastTwo.every(s => s === "cache_reused");
}
```

### Расширение структуры orchestrator_decision

Добавляем поле для отслеживания источника:

```typescript
interface OrchestratorDecision {
  // ... все существующие поля ...
  
  decision_source?: "fresh" | "bypass_greeting" | "cache_reused";
  cache_similarity?: number;          // только при cache_reused
  bypass_reason?: string;             // только при bypass_greeting
}
```

Это поле не передаётся в LLM (его не существует на момент вызова), но сохраняется в `messages.meta` для аналитики и debug.

### Метрики для мониторинга оптимизаций

В `user_event_log` пишем при каждом ходе:

```json
{
  "kind": "dialog_turn",
  "payload": {
    "user_id": "...",
    "conversation_id": "...",
    "iteration": 3,
    "decision_source": "cache_reused",
    "phase": "deepen_inquiry",
    "orchestrator_latency_ms": 0,
    "responder_latency_ms": 850,
    "first_token_latency_ms": 320,
    "cache_similarity": 0.85,
    "tokens_input": 0,
    "tokens_output": 0
  }
}
```

Дашборд в Grafana / Metabase должен показывать:
- **Bypass rate** — процент ходов с `decision_source = "bypass_greeting"`. Ожидаем 15-20% (по числу новых диалогов / общих ходов).
- **Cache hit rate** — процент ходов с `decision_source = "cache_reused"` среди итераций ≥ 3. Ожидаем 25-35%.
- **Median first-token latency** — отдельно по `decision_source`. Bypass и cache должны быть ≈ в 2 раза быстрее fresh.
- **Cost per dialog** — средние токены и долларовая стоимость на полный диалог. Должна снизиться на 15-20% после внедрения.

### Feature flags

Обе оптимизации включаются через переменные окружения, чтобы можно было быстро откатить при проблемах:

```
DIALOG_GREETING_BYPASS_ENABLED=true        # default: true
DIALOG_DECISION_CACHE_ENABLED=true         # default: true
DIALOG_DECISION_CACHE_MIN_ITERATION=3      # default: 3
DIALOG_DECISION_CACHE_THRESHOLD=0.8        # default: 0.8
```

При `DIALOG_DECISION_CACHE_ENABLED=false` все ходы идут через свежий оркестратор. При `DIALOG_GREETING_BYPASS_ENABLED=false` оркестратор зовётся даже на первый ход.

### Тестовые сценарии для оптимизаций

**Тест: Bypass greeting (calibration)**
- Создаётся новый диалог с conversationId=null. 
- Ожидание: `messages.meta.orchestrator_decision.decision_source = "bypass_greeting"`. LLM-вызов оркестратора НЕ происходит (логи показывают 0 tokens на оркестратор для этого хода).

**Тест: Bypass greeting (daily_dialog)**
- То же, но useCase=daily_dialog. Фаза должна быть `contextual_greeting`.

**Тест: Cache hit на 3-й итерации**
- Имитация: пользователь даёт три похожих по плотности и тону ответа подряд («не знаю», «ну такое», «да всё нормально»).
- Ожидание: на 3-м ходу `decision_source = "cache_reused"`, cache_similarity > 0.8.

**Тест: Cache miss из-за смены сигнала**
- Пользователь: «не знаю» → «не знаю» → «слушай, давай уже какую-нибудь практику».
- Ожидание: на 3-м ходу transition marker сработал, similarity < 0.8 → fresh orchestrator call. Фаза должна перейти на `ask_practice_intent`.

**Тест: Защита от стагнации**
- Имитация: 4 коротких ответа подряд, все по similarity > 0.8.
- Ожидание: на ходах 3 и 4 cache hit, на 5-м — принудительный fresh decision из-за `shouldForceFreshDecision == true`.

**Тест: Terminal phase не кешируется**
- Предыдущий decision: `next_phase = "suggest_practice"`. Пользователь отвечает.
- Ожидание: даже при высокой similarity — fresh orchestrator call (terminal phases в exclusion list).

---

## Сжатие истории

При длине истории > 20 сообщений или > 25k токенов — суммаризация старой части:

```
prompt_key = "summary_messages"
template:
"Сожми эту беседу до 4-5 ключевых пунктов:
- что пользователь рассказал о состоянии и контексте
- какие инсайты прозвучали
- какие практики обсуждались / приняты / отвергнуты
- ключевые фразы пользователя

Не более 250 слов. Сохрани лексику пользователя.

Беседа:
{{messages_to_summarize}}"
```

Модель: `gemini-2.5-flash-8b` (минимальная для дешёвой суммаризации).

---

## Алгоритм выбора практики (детерминированный)

Без изменений из предыдущего ТЗ — `getFilteredPracticesStack` + `selectPractice`.

Ключевые моменты:
- Stack из 5-7 практик передаётся в Responder в фазе `suggest_practice`.
- Responder делает [PRACTICE_PICK: id="..."] маркер.
- Backend проверяет: id из stack? — да → подтверждаем. Нет → fallback на top-1 из stack.

---

## Time-of-Day awareness

Везде, где упоминается `time_of_day`, используется единая функция:

```typescript
function timeOfDayContext(localDateTime: Date): TimeOfDayContext {
  const h = localDateTime.getHours();
  
  let timeOfDay: "morning" | "day" | "evening" | "night";
  let greeting: string;
  let energy: "rising" | "peak" | "falling" | "low";
  let preferredPracticeKinds: string[];
  
  if (h >= 5 && h < 11) {
    timeOfDay = "morning"; greeting = "Доброе утро"; energy = "rising";
    preferredPracticeKinds = ["asanas", "pranayama"];
  } else if (h >= 11 && h < 17) {
    timeOfDay = "day"; greeting = "Добрый день"; energy = "peak";
    preferredPracticeKinds = ["pranayama", "meditation"];
  } else if (h >= 17 && h < 22) {
    timeOfDay = "evening"; greeting = "Добрый вечер"; energy = "falling";
    preferredPracticeKinds = ["meditation", "pranayama"];
  } else {
    timeOfDay = "night"; greeting = "Доброй ночи"; energy = "low";
    preferredPracticeKinds = ["meditation"];
  }
  
  return { timeOfDay, greeting, energy, preferredPracticeKinds };
}
```

---

## МИГРАЦИЯ существующего кода

См. отдельный документ MIGRATION_PLAN.md. Ключевые точки:

1. Удаляется `_legacy_web/app/api/communicator/route.ts`.
2. Удаляется `modules/communicator/core/transcript-parser.ts`.
3. Создаются эндпоинты `/api/communicator/v2/*`.
4. Переписывается `services/communicator-client.ts` под двухступенчатый flow.
5. UI Communicator получает поддержку фаз: показывает индикатор "Размышляю..." во время оркестратора, потом стрим ответа.

---

## Тестовые сценарии

### Сценарий 1: «Болтливый пользователь, calibration»
**Вход:** В первом ответе после welcome_and_hint пользователь даёт плотный 4-минутный монолог, упоминая 5 из 7 чакр.

**Ожидание:** 
- Orchestrator: information_completeness ~ 0.85, density 0.9 → next_phase: "acknowledge_and_close"
- Diaog закрывается за 1 итерацию пользователя.

### Сценарий 2: «Молчаливый пользователь, calibration»
**Вход:** В ответе на welcome_and_hint пользователь говорит «Ну я не знаю, всё ок».

**Ожидание:** 
- Orchestrator: density 0.1, signals=[terse, deflecting], completeness 0.1 → next_phase: "deepen_specific_chakra" с focus на одну чакру.
- Через 2-3 уточнения, если плотность не вырастает → close по soft_cap.

### Сценарий 3: «Daily dialog, утро»
**Вход:** time=08:30, entry_source=home, planet_of_day=Saturn (дисгармонично). Пользователь: «Доброе утро. Мне сегодня выступать перед советом директоров, я переживаю».

**Ожидание:**
- Orchestrator: density 0.8, user_state=0.7, context=0.9, signals=[open, self_reflective].
  Решение: пропустить collect_state и deepen_inquiry → сразу offer_insight.
- Responder в фазе offer_insight связывает «выступать» с «не быть услышанным» (Saturn dissonance) — но в лексике пользователя.
- Дальше → ask_practice_intent → suggest_practice (приоритет: пранаяма для голоса/уверенности).

### Сценарий 4: «Daily dialog, вечер»
**Вход:** time=21:30, entry_source=home. Пользователь: «День был тяжёлый».

**Ожидание:**
- Orchestrator: signals=[terse], time_of_day=evening → tone:warm, preferredPracticeKinds:[meditation, pranayama]
- Через 1 уточнение → offer_insight → suggest_practice (медитация на отпускание).

### Сценарий 5: «STATE_PROPOSAL detection»
**Вход:** Пользователь несколько раз употребляет фразу «как будто стена в голове».

**Ожидание:**
- Responder в одном из ответов добавляет: `[STATE_PROPOSAL: planet="Mercury" label="стена в голове" polarity="negative"]`
- Backend сохраняет в `ai_state_proposals` со статусом pending.
- При следующей калибровке (или через мини-карточку в UI) пользователю предлагается подтвердить.

### Сценарий 6: «Корректировка дневной рекомендации»
**Вход:** В ходе диалога пользователь говорит: «У меня сегодня вечером самолёт».

**Ожидание:**
- Responder в фазе confirm_and_close добавляет: `[CORRECT_RECOMMENDATION: short_text="..." windows_correction="..."]`
- Backend обновляет `user_daily_forecasts.recommendation_short_text`, ставит `is_corrected_via_dialog=true`.
- На главной странице по возврату пользователь видит обновлённую рекомендацию.

### Сценарий 7: «Soft cap hit»
**Вход:** Пользователь 6 итераций отвечает односложно, не углубляется.

**Ожидание:**
- На 5-й итерации orchestrator выставляет should_close=true с close_reason="soft_cap_hit".
- Responder в финальной фазе мягко завершает: «Чтобы не растягивать, попробуй эту короткую практику. Если захочешь обсудить глубже — есть основной чат Gemini».

---

## Отладочные данные

В development-режиме каждое сообщение `messages` содержит полное `meta` со всем диагностическим JSON.

В тестовом стенде (Debug Inspector) виден:
- Каждый ход оркестратора с reasoning и information_completeness scores.
- Каждое сообщение responder с фазой и markers.
- Полный prompt, отправленный в LLM.
- Latency по компонентам (оркестратор / responder).

---

## Безопасность

JWT валидация, rate limit, логирование — без изменений из предыдущего ТЗ.

Дополнительно: orchestrator output валидируется через JSON schema (`zod`). При невалидном — fallback на дефолтную фазу для use case.

---

## Что НЕ делает этот модуль

- Не интерпретирует астрологию для пользователя (это работа M2 + конкретные тексты в шаблонах).
- Не пересчитывает калибровку на лету (это M3, отдельный flow с extraction endpoint).
- Не записывает фактическое выполнение практики (это slot отдельного UI «Старт практики»).
- Не управляет автокалибровкой (cron job отдельный).

---

## Зависимости

- `@google/generative-ai` для Gemini.
- `@supabase/supabase-js` для БД и Auth.
- `zod` для валидации orchestrator JSON output.
- Native fetch для Groq.

---

## Заметки на будущее (post-MVP)

- **Multi-agent**: разные «персоны» оркестратора (психолог / йога-тренер / коуч) для разных глубин запросов.
- **Adaptive model selection**: оркестратор может выбирать модель Responder'а — flash для коротких ответов, pro для глубоких инсайтов.
- **Long-term memory**: персональные шаблоны диалога — какие пути с этим пользователем работают чаще всего, какие нет.
- **Self-evaluation**: после каждого диалога — отдельный мини-LLM оценивает, был ли инсайт реальным, был ли пользователь удовлетворён. Эти данные → fine-tuning промптов.
