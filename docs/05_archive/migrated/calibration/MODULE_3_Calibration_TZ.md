# MODULE 3: CALIBRATION — Полное техническое задание

## Назначение

Калибровка — это механизм адаптации алгоритма под индивидуальное самовосприятие пользователя. После того как M1 рассчитал натальный профиль, Calibration:

1. Генерирует психологический портрет на основе натального профиля.
2. Принимает голосовую обратную связь пользователя (через Groq Whisper-v3 на бэкенде).
3. Корректирует значения `S` и `H` каждой планеты — создавая `S_calibrated`, `H_calibrated` через усреднение «натальное × 60% + извлечённое из текста × 40%» (для ручных калибровок) или 50/50 для автоматических агрегированных.
4. Формирует **states_map** — семантическую карту состояний пользователя по каждой чакре (позитивные и негативные маркеры), с возможностью ИИ дополнять её на основе диалогов.
5. Формирует **user_lexicon** — словарь конкретных лингвистических паттернов пользователя (его уникальные фразы и слова).
6. Поддерживает повторные калибровки: ручную (через настройки) и автоматическую агрегированную (раз в 7–14 дней анализ диалогов).

Все LLM-вызовы и транскрипция идут через Next.js бэкенд (`_legacy_web/app/api/...`) с проксированием в Groq и Gemini.

---

## Принципиальное разделение States vs Vocabulary

Это ключевое архитектурное решение, влияющее на всю работу ассистента.

### States (Состояния)

**Что это:** психофизиологические маркеры, привязанные к чакрам/планетам. Это **семантическая карта** пользователя.

**Примеры (Вишуддха / Сатурн):**

- Позитивные: «мастерство», «свобода речи», «творчество», «коммуникабельность»
- Негативные: «одиночество», «заикание», «непринадлежность», «меня не слышат»

**Как обновляется:**

1. На калибровке — пользователь явно подтверждает или отвергает базовые состояния и добавляет свои.
2. **ИИ-ассистент дополняет** карту состояний автоматически в фоне: если в диалоге пользователь описывает что-то, семантически близкое к Вишуддхе («не нашёл слов на встрече», «закрылся от коллег»), ассистент может предложить добавить это состояние в `states_map[Saturn]`.

**Что с этим делать:** при формировании дневной рекомендации ассистент использует именно States (через них формулирует, что сегодня может ощущаться). Это «кнопки», на которые нажимают слова.

### Vocabulary (Словарь)

**Что это:** лингвистические паттерны — конкретные фразы и слова, которыми пользователь сам говорит о состояниях.

**Примеры:**

- «когда меня не слышат на совещании»
- «как будто в стене»
- «всё ок, но что-то пресновато» — может быть Венера в дисгармонии

**Как обновляется:**

1. На калибровке — собирается из текста обратной связи.
2. В диалогах с ассистентом — фразы пользователя сохраняются как авторские паттерны.

**Что с этим делать:** ассистент использует Vocabulary как **стиль речи** в текстах рекомендаций. Это создаёт ощущение «приложение говорит как я».

### Связь между ними

В `states_map` каждое состояние имеет привязку к чакре (планете). В `user_lexicon` каждая фраза имеет привязку к одному или нескольким состояниям через поле `triggers_states[]`. Это позволяет ассистенту правильно интерпретировать слова пользователя:

```
"когда меня не слышат на совещании" 
  → triggers_states: ["меня не слышат"] 
  → state «меня не слышат» 
  → в states_map[Saturn].negative
  → Saturn / Vishuddha
```

---

## Контракт данных

### Структура user_calibrations (новая таблица БД)

```sql
CREATE TABLE public.user_calibrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  version integer NOT NULL,                  -- 1 для первой, 2+ для последующих
  source text NOT NULL CHECK (source IN ('initial', 'manual_resync', 'auto_aggregated')),
  based_on_version integer,                  -- NULL для v1, иначе version предыдущей
  is_active boolean NOT NULL DEFAULT true,   -- только одна active калибровка на пользователя
  
  -- Скорректированные числовые значения
  s_calibrated jsonb NOT NULL,               -- { Sun: 0.65, Moon: 0.42, ... }
  h_calibrated jsonb NOT NULL,               -- { Sun: 0.20, Moon: -0.15, ... }
  
  -- Дельты от натального (для аналитики и UI)
  delta_from_initial jsonb NOT NULL,         -- { Sun: { dS, dH }, ... }
  
  -- Семантическая карта состояний по 7 чакрам
  states_map jsonb NOT NULL,                 -- структура ниже
  
  -- Лингвистический словарь пользователя
  user_lexicon jsonb NOT NULL,               -- структура ниже
  
  -- Сырая обратная связь (аудит)
  raw_feedback jsonb NOT NULL,
  
  -- Сгенерированный портрет
  portrait text,
  portrait_chunks jsonb,                     -- { Sun: "...", Moon: "...", ... }
  
  last_calibration_date timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  
  UNIQUE (user_id, version)
);

CREATE INDEX idx_user_calibrations_user_active ON public.user_calibrations(user_id) WHERE is_active = true;
CREATE INDEX idx_user_calibrations_user_history ON public.user_calibrations(user_id, version DESC);

-- RLS: пользователь видит только свои калибровки
ALTER TABLE public.user_calibrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_calibrations_select_own ON public.user_calibrations FOR SELECT USING (user_id = auth.uid());
-- Запись только через service_role (бэкенд решает, когда обновить)
```

**Логика is_active:** при создании новой версии — старая `UPDATE SET is_active = false`, новая `INSERT is_active = true`. Один пользователь = ровно одна активная калибровка.

### Структура states_map (jsonb)

```json
{
  "Sun": {
    "chakra_number": 7,
    "positive_states": [
      { "id": "self_clarity", "label": "ясность намерения", "source": "baseline", "weight": 1.0 },
      { "id": "presence", "label": "королевское присутствие", "source": "user_confirmed", "weight": 1.0 },
      { "id": "knowing_my_path", "label": "знание своего пути", "source": "user_added", "weight": 1.0 }
    ],
    "negative_states": [
      { "id": "lost_meaning", "label": "потеря смысла", "source": "baseline", "weight": 1.0 },
      { "id": "autopilot", "label": "автопилот", "source": "user_confirmed", "weight": 1.0 }
    ],
    "rejected_states": [
      { "id": "burnout", "label": "выгорание", "source": "baseline" }
    ],
    "is_confirmed": true
  },
  "Saturn": { /* ... */ },
  "Moon": { /* ... */ },
  /* и т.д. для всех 7 */
}
```

**Поля state-объекта:**

- `id` — стабильный идентификатор (используется при поиске по диалогам).
- `label` — человекочитаемое название.
- `source`:
  - `"baseline"` — из стандартного набора (`chakra_states_baseline.json`), пользователь не отверг.
  - `"user_confirmed"` — пользователь явно упомянул на калибровке как актуальное.
  - `"user_added"` — добавлено пользователем как новое (которого не было в baseline).
  - `"ai_proposed"` — ассистент в фоне предложил, пользователь подтвердил кнопкой «да, это про меня».
- `weight` — насколько актуально (0.5 = «иногда», 1.0 = «постоянно»). По умолчанию 1.0.

### Структура user_lexicon (jsonb)

```json
{
  "phrases": [
    {
      "id": "phrase_uuid_1",
      "text": "когда меня не слышат на совещании",
      "triggers_states": ["meta_not_heard", "professional_silence"],
      "associated_planet": "Saturn",
      "first_seen_at": "2026-04-15T10:00:00Z",
      "frequency": 3,                       // сколько раз пользователь её употреблял
      "source": "calibration_v1"
    },
    {
      "id": "phrase_uuid_2",
      "text": "тащу через силу",
      "triggers_states": ["lost_meaning", "exhaustion"],
      "associated_planet": "Sun",
      "frequency": 1,
      "source": "dialog_2026-04-20"
    }
  ],
  "style_markers": {
    "speaks_in_metaphors": true,            // обнаруженные паттерны общения
    "uses_diminutives": false,
    "formal_register": false,
    "preferred_pronouns": "you_informal"     // ты / вы
  }
}
```

**Использование в диалогах:** ассистент в стиле общения подражает паттернам из `style_markers` и использует фразы из `phrases[]`, когда они уместны.

### Вход в API калибровки

```typescript
interface CalibrationInput {
  // Из контекста: user_id берётся из JWT, не из тела запроса
  natalProfile: NatalProfile;                // получается на бэкенде из user_natal_charts
  previousCalibration?: Calibration;         // если есть активная — передаётся
  source: "initial" | "manual_resync" | "auto_aggregated";
  
  // Для initial и manual_resync:
  feedbackText?: string;                     // транскрибированный текст от Groq
  
  // Для auto_aggregated:
  conversationDigest?: ConversationDigest;
  
  language: string;                          // "ru", "en", ...
}
```

### Выход

```typescript
interface Calibration {
  id: string;
  version: number;
  source: "initial" | "manual_resync" | "auto_aggregated";
  basedOnVersion?: number;
  
  S_calibrated: { [planet: string]: number };
  H_calibrated: { [planet: string]: number };
  deltaFromInitial: { [planet: string]: { dS: number; dH: number } };
  
  states_map: StatesMap;
  user_lexicon: UserLexicon;
  
  rawFeedback: { ... };
  portrait: string;
  portraitChunks: { [planet: string]: string };
  
  lastCalibrationDate: string;
  createdAt: string;
}
```

---

## Инфраструктура (бэкенд)

### Эндпоинты

```
POST /api/calibration/transcribe
  Headers: Authorization: Bearer <supabase_jwt>
  Content-Type: multipart/form-data
  Body: audio file (m4a/wav/mp3, до 5 минут)
  Response: { 
    text: string, 
    language: string, 
    durationSeconds: number,
    confidence: number
  }
  Backend: Groq API (модель whisper-large-v3)
  Latency: 200-500ms на минуту аудио
  Стоимость: ~$0.04/час

POST /api/calibration/extract
  Headers: Authorization: Bearer <supabase_jwt>
  Body: CalibrationInput
  Response: Calibration
  Backend: 
    1. Загружает natalProfile и активную previousCalibration из БД
    2. Берёт промпт типа "calibration_extraction" из таблицы prompts
    3. Вызывает Gemini для извлечения дельт и фраз
    4. Применяет детерминированное усреднение
    5. Сохраняет новую версию в user_calibrations
    6. Деактивирует предыдущую (is_active = false)
  Стоимость: ~$0.005

POST /api/calibration/portrait
  Headers: Authorization: Bearer <supabase_jwt>
  Body: { language }
  Response: { portrait, portraitChunks }
  Backend: 
    Берёт промпт "portrait_generation" из prompts (или работает по шаблонному движку в MVP)
  Стоимость: 0 (шаблоны) или $0.002 (LLM)

POST /api/calibration/recalibrate
  Headers: Authorization: Bearer <supabase_jwt>
  Body: { /* пусто */ }
  Response: { calibrationId, audioRecordingUrl }
  Назначение: запустить новую калибровку из настроек приложения
```

### Безопасность

Все эндпоинты:

1. **Уровень 1:** проверка JWT через `supabase.auth.getUser(token)`. Возвращает `userId` для всей логики.
2. **Уровень 2:** rate limiting в Redis по `userId`:
  - `/transcribe`: 30 запросов в час
  - `/extract`: 5 в сутки
  - `/portrait`: 5 в сутки

Реализация rate limit:

```typescript
async function checkRateLimit(userId: string, endpoint: string, limit: number, windowSec: number) {
  const key = `rate:${userId}:${endpoint}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSec);
  if (count > limit) throw new Error("Rate limit exceeded");
}
```

Если Redis недоступен в первой версии — простой in-memory rate limit на бэкенде (с очисткой при рестарте). Для тысяч пользователей это уже не годится, но для первых сотен — да.

---

## Этап A: Генерация портрета

### A1: Шаблонный движок (MVP)

Содержит ~300 текстовых вариантов, выбирается по `(planet × S_range × H_range)`. Файл `portrait_templates.json`:

```json
[
  {
    "planet": "Saturn",
    "S_range": [0.7, 1.0],
    "H_range": [0.3, 1.0],
    "variants": [
      "У вас сильная и созидательная Вишуддха (5 чакра). Вы способны выражать себя ясно, доводить замыслы до завершённой формы и давать словам и делам долговечность. В жизни это проявляется как мастерство, дисциплина и умение быть услышанным.",
      "Сатурн в вашей карте работает как архитектор: вы создаёте структуры, которые служат долго. Ваша речь и творчество имеют вес. Вы умеете собирать дисциплину, не теряя живости."
    ]
  }
]
```

Алгоритм:

1. Для каждой планеты выбираем подходящий шаблон по диапазонам S и H.
2. Случайно из вариантов.
3. Склеиваем 7 фрагментов через двойной перенос строки.
4. Сохраняем `portraitChunks` — по фрагменту на чакру для UI «развернуть подробнее».

### A2: LLM-обогащение (post-MVP)

Промпт хранится в таблице `prompts` с типом `"portrait_generation"`:

```
Ты — генератор персональных психологических портретов на основе данных о 7 чакрах.

Правила:
- НЕ упоминай астрологию, планеты, аспекты, транзиты, гороскоп, знаки зодиака.
- Говори о состояниях, поведении, жизненных паттернах.
- Тон: точный, тёплый, без эзотерики и без фамильярности.
- Длина: ровно ~1000 символов суммарно.

Формат ответа: строгий JSON {"portrait": "...", "portraitChunks": {"Sun": "...", ...}}

Данные пользователя:
{{user_chakra_data}}
```

Входная переменная `{{user_chakra_data}}` подставляется бэкендом.

---

## Этап B: Голосовая запись и транскрипция (через Groq)

### Поток

1. Frontend записывает аудио (`expo-av` оставляем, как в существующем коде).
2. Аудио шлётся multipart на `/api/calibration/transcribe`.
3. Backend проксирует в Groq (модель `whisper-large-v3`):
  ```typescript
   const formData = new FormData();
   formData.append("file", audioBlob, "audio.m4a");
   formData.append("model", "whisper-large-v3");
   formData.append("language", "ru");
   formData.append("response_format", "verbose_json");

   const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
     method: "POST",
     headers: { "Authorization": `Bearer ${process.env.GROQ_API_KEY}` },
     body: formData
   });
  ```
4. Возвращает `{ text, language, durationSeconds, confidence }`.

### Confidence

Groq в `verbose_json` возвращает segments с `avg_logprob`. Мы рассчитываем:

```typescript
const avgConf = segments.reduce((s, x) => s + Math.exp(x.avg_logprob), 0) / segments.length;
```

Если `avgConf < 0.6` — UI показывает текст с примечанием «возможны ошибки распознавания» и даёт editable textarea.

### MIME и форматы

Groq принимает: `flac`, `mp3`, `mp4`, `mpeg`, `mpga`, `m4a`, `ogg`, `wav`, `webm`. Это шире, чем у Gemini, поэтому существующая логика `audioMime.ts` работает без изменений.

---

## Этап C: Извлечение дельт через Gemini

Промпт хранится в таблице `prompts` с типом `"calibration_extraction"`:

```
СИСТЕМНАЯ РОЛЬ:
Ты — анализатор обратной связи пользователя для калибровки астропсихологической 
модели. У пользователя есть оценки силы (S, 0..1) и гармоничности (H, -1..+1) 
семи чакр-планет. На основе слов пользователя:

(1) Для каждой ИЗ УПОМЯНУТЫХ или ЯВНО ПОДРАЗУМЕВАЕМЫХ планет предложи 
    дельты к S и H. Диапазон: -0.30..+0.30. Если про планету ничего нет — 
    dS=0, dH=0, confirmed=false.

(2) Для каждой планеты верни:
    - confirmedStates: какие из baseline harmonic+dissonant states 
      пользователь явно подтвердил.
    - rejectedStates: какие отверг.
    - addedStates: новые состояния, которых не было в baseline (только если 
      они семантически чётко привязаны к этой чакре).
    - personalPhrases: уникальные фразы, которыми описывает состояния.

ПРАВИЛА:
- «Я общительный, легко выступаю» → Сатурн (Вишуддха): dS=+0.15, dH=+0.20.
- «Я тревожный, плохо сплю» → Луна: dS=0, dH=-0.20.
- «У меня нет проблем с этим» → dH=+0.10, не +0.30. Не разгоняй дельты.
- При явном приукрашивании («я во всём идеален») — снижай дельты.
- Если про планету ничего не сказано — НЕ выдумывай.

ФОРМАТ ОТВЕТА: строгий JSON, без markdown:
{
  "deltas": {
    "Sun":     { "dS": 0.0, "dH": 0.0, "confirmed": false },
    "Moon":    { "dS": 0.0, "dH": -0.10, "confirmed": true },
    "Mercury": { ... }, "Venus": { ... }, "Mars": { ... }, 
    "Jupiter": { ... }, "Saturn": { ... }
  },
  "vocabulary": {
    "Sun":     { "confirmedStates": [], "rejectedStates": [], "addedStates": [], "personalPhrases": [] },
    /* остальные 6 */
  }
}

ВХОД:
Натальный профиль: {{natal_profile_json}}
Базовые состояния: {{baseline_states_json}}
Текст пользователя: {{user_feedback_text}}
Предыдущая калибровка: {{previous_calibration_json}}
```

Модель: `gemini-2.5-flash` (быстрая и дешёвая).

---

## Этап D: Усреднение (защита от приукрашивания)

Детерминированная JS-логика:

```javascript
function averageWithProtection(natal, llmOutput, source) {
  const w_natal = (source === "auto_aggregated") ? 0.5 : 0.6;
  const w_proposed = 1 - w_natal;
  
  const result = { S_calibrated: {}, H_calibrated: {}, deltaFromInitial: {} };
  
  for (const planet of PLANETS_7) {
    const S_initial = natal.planets[planet].S_initial;
    const H_initial = natal.planets[planet].H_initial;
    const dS = llmOutput.deltas[planet].dS;
    const dH = llmOutput.deltas[planet].dH;
    
    const S_proposed = clamp(S_initial + dS, 0, 1);
    const H_proposed = clamp(H_initial + dH, -1, 1);
    
    const S_cal = w_natal * S_initial + w_proposed * S_proposed;
    const H_cal = w_natal * H_initial + w_proposed * H_proposed;
    
    result.S_calibrated[planet] = clamp(S_cal, 0, 1);
    result.H_calibrated[planet] = clamp(H_cal, -1, 1);
    result.deltaFromInitial[planet] = {
      dS: result.S_calibrated[planet] - S_initial,
      dH: result.H_calibrated[planet] - H_initial
    };
  }
  return result;
}
```

**Важное правило:** каждая калибровка пересчитывается **от натального профиля**, а не от предыдущей. Защита от накопления дрейфа.

---

## Этап E: Сборка states_map и user_lexicon

```javascript
function buildStatesMap(planet, llmOutput, baseline, previous) {
  const llm = llmOutput.vocabulary[planet];
  const base = baseline[planet];
  const prev = previous?.states_map[planet];
  
  // Позитивные состояния
  const positive_states = [];
  
  // 1. Confirmed из baseline
  for (const stateLabel of llm.confirmedStates) {
    const baselineState = base.harmonicStates.find(s => s === stateLabel);
    if (baselineState) {
      positive_states.push({
        id: slugify(baselineState),
        label: baselineState,
        source: "user_confirmed",
        weight: 1.0
      });
    }
  }
  
  // 2. Added (новые, не из baseline) — только если LLM пометил как позитивные
  for (const added of llm.addedStates.filter(s => s.polarity === "positive")) {
    positive_states.push({
      id: slugify(added.label),
      label: added.label,
      source: "user_added",
      weight: 1.0
    });
  }
  
  // 3. Унаследованные из предыдущей калибровки (если не отвергнуты)
  if (prev) {
    for (const oldState of prev.positive_states) {
      if (!llm.rejectedStates.includes(oldState.label) && 
          !positive_states.find(s => s.id === oldState.id)) {
        positive_states.push(oldState);
      }
    }
  }
  
  // 4. Если ничего не подтверждено — берём top-4 baseline с source=baseline
  if (positive_states.length === 0) {
    for (const s of base.harmonicStates.slice(0, 4)) {
      positive_states.push({ id: slugify(s), label: s, source: "baseline", weight: 0.5 });
    }
  }
  
  // Аналогично negative_states ...
  // rejected_states — список отвергнутых (для исключения из текстов)
  
  return {
    chakra_number: PLANET_TO_CHAKRA[planet],
    positive_states,
    negative_states,
    rejected_states,
    is_confirmed: llm.confirmedStates.length > 0 || llm.addedStates.length > 0
  };
}

function buildLexicon(llmOutput, previous, source) {
  const phrases = [];
  
  for (const planet of PLANETS_7) {
    for (const text of llmOutput.vocabulary[planet].personalPhrases) {
      // Поиск дубликата в предыдущем словаре
      const existing = previous?.phrases.find(p => 
        normalizePhrase(p.text) === normalizePhrase(text)
      );
      
      if (existing) {
        existing.frequency += 1;
        phrases.push(existing);
      } else {
        phrases.push({
          id: generateUUID(),
          text,
          triggers_states: llmOutput.vocabulary[planet].confirmedStates.map(slugify),
          associated_planet: planet,
          first_seen_at: new Date().toISOString(),
          frequency: 1,
          source: `calibration_${source}`
        });
      }
    }
  }
  
  // Унаследованные фразы (frequency не менялась — они не звучали в новом тексте)
  if (previous) {
    for (const oldPhrase of previous.phrases) {
      if (!phrases.find(p => p.id === oldPhrase.id)) {
        // Со временем уменьшаем frequency, чтобы старые фразы становились менее приоритетными
        phrases.push({ ...oldPhrase, frequency: Math.max(1, oldPhrase.frequency - 0.5) });
      }
    }
  }
  
  // Ограничение: не более 30 фраз в словаре. Удаляем самые редкие.
  phrases.sort((a, b) => b.frequency - a.frequency);
  
  return {
    phrases: phrases.slice(0, 30),
    style_markers: previous?.style_markers || detectStyleMarkers(llmOutput)
  };
}
```

---

## Этап F: Сохранение и инвалидация кеша

```javascript
async function saveCalibration(userId, calibration) {
  // 1. Деактивируем все предыдущие активные
  await db.from("user_calibrations")
    .update({ is_active: false })
    .eq("user_id", userId)
    .eq("is_active", true);
  
  // 2. Вставляем новую как активную
  const { data, error } = await db.from("user_calibrations")
    .insert({
      user_id: userId,
      version: calibration.version,
      source: calibration.source,
      based_on_version: calibration.basedOnVersion || null,
      is_active: true,
      s_calibrated: calibration.S_calibrated,
      h_calibrated: calibration.H_calibrated,
      delta_from_initial: calibration.deltaFromInitial,
      states_map: calibration.states_map,
      user_lexicon: calibration.user_lexicon,
      raw_feedback: calibration.rawFeedback,
      portrait: calibration.portrait,
      portrait_chunks: calibration.portraitChunks,
      last_calibration_date: new Date().toISOString()
    })
    .select()
    .single();
  
  if (error) throw error;
  
  // 3. Инвалидируем кеш user_daily_forecasts на сегодня и завтра
  await db.from("user_daily_forecasts")
    .delete()
    .eq("user_id", userId)
    .gte("forecast_date", todayLocal());
  
  return data;
}
```

---

## Автоматическая агрегированная калибровка (auto_aggregated)

Запускается **на бэкенде** через cron-job (или Supabase Edge Function на расписании):

```typescript
// supabase/functions/auto-calibrate/index.ts
// Cron: каждый день в 03:00 UTC

for (const user of activeUsers) {
  const lastCalibration = await getLastCalibration(user.id);
  if (lastCalibration && daysSince(lastCalibration.created_at) < 7) continue;
  
  const conversations = await getConversationsSince(user.id, lastCalibration.created_at);
  if (conversations.length < 5) continue;
  
  // Анализ диалогов через Gemini
  const digest = await buildConversationDigest(conversations, user.id);
  
  // Если digest не показывает значительных изменений — не предлагаем
  if (digest.significantChanges < 3) continue;
  
  // Создаём предложение в notifications
  await db.from("notifications").insert({
    user_id: user.id,
    type: "calibration_suggested",
    payload: { digest_id: digest.id }
  });
}
```

При открытии приложения пользователь видит карточку: «Мы заметили несколько устойчивых паттернов в ваших состояниях за неделю. Хотите обновить вашу карту?» — кнопка «Обновить» запускает `/api/calibration/extract` с `source: "auto_aggregated"`.

---

## Расширение: ИИ дополняет states_map в фоне

В диалогах с ассистентом (M4) после каждого сообщения пользователя бэкенд может пометить новое состояние как кандидата:

```typescript
// В обработчике /api/communicator/v2/dialog (M4) после ответа Gemini
const proposedStates = await extractProposedStates(userMessage, currentStatesMap);
// Если LLM нашёл что-то семантически близкое к существующему состоянию,
// но с новой формулировкой — это кандидат в "ai_proposed"

if (proposedStates.length > 0) {
  await db.from("ai_state_proposals").insert({
    user_id: userId,
    proposals: proposedStates,
    conversation_id: conversationId,
    status: "pending"
  });
}
```

В UI после нескольких таких накопленных предложений пользователю показывается мини-карточка: «Часто слышу от тебя слово "тащу через силу" — это про потерю смысла? Подтверди или отвергни». Подтверждение → состояние добавляется в `states_map[Sun].negative_states` с `source: "ai_proposed"`.

Эта логика — **post-MVP**. Структура БД (`ai_state_proposals`) проектируется, но в первой версии не используется.

---

## Тестовые сценарии

### Сценарий 1: «Сильно завышающий пользователь»

**Вход:** натальный Saturn = (S: 0.4, H: -0.2). Пользователь: «Я гениальный оратор, у меня нет никаких проблем с самовыражением».
**Ожидание:** LLM даёт dS=+0.30, dH=+0.30. После усреднения (0.6/0.4): S_cal ≈ 0.52; H_cal ≈ -0.08. Защита сработала.

### Сценарий 2: «Молчаливый пользователь»

**Вход:** упоминает только Луну и Венеру.
**Ожидание:** для остальных 5 планет confirmed=false, dS=dH=0, states_map берётся из baseline с пометкой `is_confirmed=false`.

### Сценарий 3: «Точное попадание базовых состояний»

**Вход:** «Когда меня не слышат на работе, я замолкаю. Это мой главный ад».
**Ожидание:** Saturn.positive_states/negative_states содержит «меня не слышат» (source: user_confirmed); user_lexicon.phrases содержит «когда меня не слышат на работе» (associated_planet: Saturn) и «это мой главный ад».

### Сценарий 4: «Повторная калибровка через 60 дней»

**Вход:** previousCalibration version=1; новая запись.
**Ожидание:** version=2, basedOnVersion=1. Усреднение от натального. user_lexicon наследует старые фразы со сниженной frequency.

### Сценарий 5: «Сильное противоречие с натальной картой»

**Вход:** натальный Mars (S: 0.85, H: +0.5). Пользователь: «Я полный овощ, ничего не могу довести до конца».
**Ожидание:** S_cal ≈ 0.73, H_cal ≈ 0.18. Расхождение «карта vs самовосприятие» сохраняется.

### Сценарий 6: «Auto_aggregated»

**Вход:** ConversationDigest с 12 упоминаниями «не могу заснуть», 5 упоминаниями «всё бесит».
**Ожидание:** dH(Moon) ≈ -0.20, dH(Mars) ≈ -0.15, lexicon обогащается. Усреднение 50/50.

### Сценарий 7: «Ai_proposed состояние»

**Вход:** пользователь в нескольких диалогах говорит «мне как будто давит на грудь».
**Ожидание:** через 3 упоминания создаётся ai_state_proposal, пользователю предлагается подтвердить связку с Анахатой/Юпитером.

---

## Отладочные данные для тестирования

В development-режиме в `Calibration` добавляется поле `debug`:

```typescript
interface CalibrationDebug {
  llmRawResponse: any;                       // сырой JSON от Gemini
  averagingProportion: { w_natal: number; w_proposed: number };
  beforeAfterComparison: {
    [planet: string]: {
      S_before: number; S_after: number; S_proposed: number;
      H_before: number; H_after: number; H_proposed: number;
      reasoning: string;
    };
  };
  newPhrasesAdded: number;
  statesAdded: number;
  statesRejected: number;
}
```

Это позволяет на тестовом стенде увидеть детальный отчёт:

1. Что пользователь сказал (сырой текст).
2. Как LLM это понял (raw JSON).
3. Какие дельты предложил по каждой планете.
4. Что в итоге получилось после усреднения.
5. Какие состояния и фразы добавились/отверглись.

---

## Безопасность и приватность

- Аудиофайл удаляется после успешной транскрипции.
- `transcribedText` в БД шифруется (через Supabase Vault или pgcrypto).
- Все LLM-запросы через бэкенд; ключи Groq и Gemini не на клиенте.
- Пользователь может в настройках удалить все калибровки и сбросить states_map к baseline (`DELETE FROM user_calibrations WHERE user_id = ?`).

---

## Что НЕ делает этот модуль

- Не интерпретирует данные текстом для пользователя в режиме диалога — это задача M4. M3 только генерирует начальный портрет.
- Не вмешивается в дневной расчёт — только подаёт скорректированные параметры в M2.
- Не управляет голосовым интерфейсом — это слой приложения, M3 только обрабатывает уже транскрибированный текст.
- Не управляет ai_state_proposals — это часть M4, M3 только использует подтверждённые состояния.

---

## Зависимости

- `@supabase/supabase-js` — для работы с БД и Auth.
- `@groq-sdk` или fetch к Groq REST API — для транскрипции.
- `@google/generative-ai` — для Gemini (уже подключено в `_legacy_web`).
- `redis` (опционально) — для rate limiting.

