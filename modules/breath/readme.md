# Модуль BREATH

Дыхательная практика с биологической обратной связью: индикатор дыхания + мандала + пульсометр через фронтальную камеру со вспышкой, на выходе — структурированные метрики.

Этот README — «черновой контракт» для агентов-кодеров (включая тебя, следующую итерацию этого модуля). Цель: по одному этому файлу понять, что входит/выходит, какими «чёрными ящиками» считаются отдельные метрики, и куда тянуть руки, а куда — нет.

---

## Содержание

- [Точка входа](#точка-входа)
- [Контракт входа (BreathPracticeInput)](#контракт-входа-breathpracticeinput)
- [Контракт выхода (BreathPracticeOutcome)](#контракт-выхода-breathpracticeoutcome)
- [Black-box структура метрик](#black-box-структура-метрик)
- [Флаги тестового режима](#флаги-тестового-режима)
- [Внутреннее устройство (кратко)](#внутреннее-устройство-кратко)

---

## Точка входа

```ts
import { CoherenceBreathScreen } from "@/modules/breath";
// или — тип-безопасный проп-объект:
import type { BreathPracticeInput, BreathPracticeOutcome } from "@/modules/breath";
```

Единственный публичный React-компонент — `CoherenceBreathScreen`. Всё остальное (core-алгоритмы, индикаторы, диагностика) — **не импортируй напрямую**. При необходимости расширить API — добавляй реэкспорт в `modules/breath/index.ts`.

Роут-обёртка — `app/breath-coherence.tsx`. Она парсит query-параметры `practiceId`, `durationMs`, `chakra` и передаёт их в `CoherenceBreathScreen`.

---

## Контракт входа (`BreathPracticeInput`)

Определён в `modules/breath/core/practice-io.ts`.

| Поле | Тип | Дефолт | Смысл |
|------|-----|--------|-------|
| `practiceId` | `BreathPracticeId` | `"coherent"` | Какая практика: когерентное / канальные (nadi-shodhana / surya-bhedana / chandra-bhedana) / square / triangle-up / triangle-down. Полный список — `BREATH_PRACTICES` (`modules/breath/core/practices.ts`). |
| `durationMs` | `number` | 20 мин (`DEFAULT_COHERENCE_TEST_TIMING.totalMs`) | Полная длительность практики. От 10 мин автоматически включается hybrid-режим (split метрик на окна «начало/конец»). |
| `chakra` | `1..7` (`Chakra`) | `3` | Выбор цветового профиля мандалы. Модуль MANDALA реализует 7 пресетов (`DEFAULT_BINDU_SUCCESSION_VISUAL_PRESETS`); `chakra N` → индекс `N-1`. Мэппинг в `modules/breath/core/chakra.ts`. |
| `locale` | `"ru" \| "en"` | `"ru"` | Локаль UI. |

Пример:

```tsx
<CoherenceBreathScreen practiceId="square" durationMs={10 * 60_000} chakra={4} locale="ru" />
```

Навигация с query-параметрами:

```ts
router.push({ pathname: "/breath-coherence", params: { practiceId: "coherent", durationMs: "600000", chakra: "3" } });
```

---

## Контракт выхода (`BreathPracticeOutcome`)

Определён в `modules/breath/core/practice-io.ts`. Используется:

- при нажатии «Обсудить» — сериализуется в `outcomeToCommunicatorPayload()` и отправляется в модуль `communicator`;
- при нажатии «Экспорт JSON (отладка)» — кладётся в `exportDebug` вместе с диагностикой.

Поля:

```ts
interface BreathPracticeOutcome {
  input:      { practiceId, durationMs, chakra, locale };
  summary:    BreathPracticeSummary;      // короткая сводка — см. ниже
  hybrid:     BreathHybridBreakdown | null; // split «начало / конец» если hybrid-режим был
  diagnostics: unknown | null;            // null в проде; JSON-блоб в тестовом режиме
}
```

### `BreathPracticeSummary` (короткая сводка)

```ts
{
  durationMs:                number;
  pulseEmulated:             boolean;       // true если датчик не использовался
  avgPulseBpm:               number | null;
  coherenceAveragePercent:   number | null;
  coherenceMaxPercent:       number | null;
  rsaAmplitudeBpm:           number | null;
  rsaNormalizedPercent:      number | null;
  rmssdMs:                   number | null;
  stressPercent:             number | null; // 0..100
  entryTimeSec:              number | null; // сколько секунд понадобилось войти в когерентность, null если не вошёл
}
```

### `BreathHybridBreakdown.start/end` (окна)

Каждое окно — `BreathWindowMetrics`:

```ts
{
  windowMs: number;            // длительность окна, реально заполнена ≈ 240–300 с
  avgBpm:   number | null;
  coherence: CoherenceSessionResult; // все когерентные метрики: % / RSA / entry time
  hrv:       PracticeHrvMetricsResult | null; // RMSSD + stress из HRV-ядра
}
```

---

## Black-box структура метрик

Эта секция описывает, *какой модуль отвечает за какую метрику*. Если нужно «поменять формулу когерентности, не зацепив RMSSD/стресс» — ищи файл в колонке «Ядро».

| Метрика | Ядро (где меняется формула) | Live-канал (bus) | Финальный расчёт |
|---------|-----------------------------|-------------------|-------------------|
| **Coherence %** (средняя, максимальная, per-second) | `modules/breath/core/coherence-session-analysis.ts` — чистая функция `runCoherenceSessionAnalysis(input): CoherenceSessionResult`. Вход — beats + cycleMs; выход — целый объект с процентами/entry time. | `modules/biofeedback/bus/biofeedback-pipeline.ts` — поле `coherence` публикует stub-значения; реальные % — только в `finalize()`. | `CoherenceEngine.finalize()` — обёртка над `runCoherenceSessionAnalysis`. |
| **RSA** (амплитуда, нормированная, cycles) | Тот же `coherence-session-analysis.ts`. RSA — часть того же результата. Для live-RSA-модуляции плана цикла — `CoherenceEngine.getLiveRsaCycles()`. | Канал `coherence.liveRsaBpm`. | Поля `rsaAmplitudeBpm` / `rsaNormalizedPercent` в `CoherenceSessionResult`. |
| **Entry time** (вхождение в когерентность) | В `coherence-session-analysis.ts`, правила — в `coherence-constants.ts` (`ENTRY_STABILITY_SECONDS`, `ENTRY_COHERENCE_THRESHOLD`). | — | Поле `entryTimeSec` в `CoherenceSessionResult`. |
| **RMSSD** | `modules/biofeedback/core/metrics.ts` — `computePracticeHrvMetricsFullSession(beats): PracticeHrvMetricsResult`. Чистая функция. | `HrvEngine` (`modules/biofeedback/engines/hrv-engine.ts`) → канал `rmssd`. | Та же `computePracticeHrvMetricsFullSession`. |
| **Stress Index (Baevsky)** | Там же — `modules/biofeedback/core/metrics.ts`. Алгоритм (SI = AMo / (2·Mo·MxDMn)) — локально в файле. | `StressEngine` (`modules/biofeedback/engines/stress-engine.ts`) → канал `stress`. | Часть того же `PracticeHrvMetricsResult` (`stressPercent`, `stressRaw`). |
| **Средний пульс** (окна start/end) | `computeMedianBpmFromBeats` в `CoherenceBreathScreen.tsx` — по медианному RR в пределах окна. | Канал `pulseBpm` (пайплайн). | `finalStartAvgBpm` / `finalEndAvgBpm` прямо в UI-стейте. |
| **Baseline BPM EMA** (живая трендовая оценка) | `BreathPhasePlanner.baselineBpm` — скользящая EMA в планнере цикла дыхания. | — | Собирается в `baselineBpmSeries`; попадает в экспорт JSON, но **не в UI-таблицу**. |

### Правила игры для агентов

- **Не трогай смежные формулы.** Хочешь поменять когерентность → редактируй `coherence-session-analysis.ts` и, при необходимости, `coherence-constants.ts`. RMSSD / Stress Index живут **в другом модуле** (`modules/biofeedback/core/metrics.ts`) и физически не пересекаются: входы у них — тот же beats[], выходы — независимые объекты.
- **Все ядра — чистые функции.** Вход — массив `beatTimestampsMs` + доп. параметры. Выход — `Result`-объект. Нет I/O, нет side effects, нет зависимости от React или JSI. Это **гарантирует**, что агент с «не самой мощной» моделью не сможет случайно поломать live-поток, редактируя финальный расчёт.
- **Live-канал ≠ финальный расчёт.** Live-канал (`bus.publish("coherence", ...)`) для UI-индикаторов; цифры там могут быть грубыми/stub-нулевыми. Финальная таблица считается ровно один раз в finalize-эффекте `CoherenceBreathScreen` и берётся из *ядер*, не из bus-каналов.
- **Ядра метрик НЕ знают про практику/чакру/локаль.** Их аргументы — чистые числа (beats, длительности). Если формула нуждается в знании практики — это red flag: либо вынеси контекст в параметры функции, либо передай результирующие числа уже посчитанными.

---

## Флаги тестового режима

Единственный источник истины — `modules/breath/config/debug-flags.ts`.

```ts
BREATH_TESTING_MODE            // мастер-выключатель
├─ PERF_DIAGNOSTICS_ENABLED    // perf-семплинг FPS/heap/thermal/latency
└─ DEBUG_ACTIVATION_EXPORT_ENABLED  // UI-кнопки «Экспорт JSON», «Диагностика активации», debug-строки в итогах
```

Чтобы выключить «тестовый режим» в продакшене — достаточно поставить `BREATH_TESTING_MODE = false` в этом файле. Больше нигде править не нужно: другие флаги берутся от него, `PerfDiag.push` становится no-op, jank-детектор не опрашивается, UI-кнопки экспорта скрываются.

Чтобы **включить** тестовый режим (для приёма фидбека от пользователя) — `BREATH_TESTING_MODE = true`. Пользователь сможет нажать «Экспорт JSON (отладка)» на экране результатов и поделиться файлом.

См. также: `docs/testing-mode.md`, `docs/user-diagnostic-json-reception.md`.

---

## Внутреннее устройство (кратко)

`modules/breath/`
├─ `config/`
│   └─ `debug-flags.ts` — единая точка диагностических флагов.
├─ `core/`
│   ├─ `practices.ts` — каталог практик (coherent, square, треугольники, nadi, ...).
│   ├─ `chakra.ts` — тип `Chakra` + `toChakraPresetIndex(c)`.
│   ├─ `practice-io.ts` — `BreathPracticeInput`/`BreathPracticeOutcome` + `outcomeToCommunicatorPayload`.
│   ├─ `types.ts` — `CoherenceBreathTiming`, дефолты длительности.
│   ├─ `coherence-session-analysis.ts` — **ядро метрики «когерентность + RSA + entryTime»**.
│   ├─ `coherence-constants.ts` — пороги/окна для когерентности.
│   ├─ `coherence-hybrid-merge.ts` — слияние start/end окон в единый результат.
│   ├─ `hybrid-measurement-controller.ts` — ФСМ фазы `realStart → emulated → realEnd`.
│   ├─ `breath-phase-planner.ts` — планировщик цикла дыхания (RSA-модуляция, EMA baseline).
│   └─ ...
├─ `debug/`
│   ├─ `session-runtime-diagnostics.ts` — сэмплер perf-метрик, пишется в JSON-экспорт.
│   └─ `jank-detector.ts` — UI FPS + JS-loop lag.
├─ `i18n/`
│   └─ `coherence.ts` — все строки UI (ru/en).
├─ `ui/`
│   ├─ `CoherenceBreathScreen.tsx` — **главный экран**: оркестрация, finalize, экран результатов.
│   ├─ `BreathBinduMandala.tsx` — мандала: получает `chakraPresetIndex`.
│   ├─ `BreathPracticeShell.tsx` — разметка «мандала + индикатор + панель».
│   ├─ `BreathOverlayControlPanel.tsx` — нижняя панель управления.
│   └─ ...
└─ `index.ts` — **публичный API** модуля (тот, что ты можешь импортировать извне).

### Потоки данных

1. **PPG → Beats → Метрики.** Камера-фронт с вспышкой через `FingerPpgCameraSource` → пайплайн `modules/biofeedback/bus/biofeedback-pipeline.ts` → канал `pulseBeats` + `hrvValidBeats` → финальная обработка в `CoherenceBreathScreen.finalize()`.

2. **Результаты → Communicator.** На кнопке «Обсудить» собирается `BreathPracticeOutcome`, сериализуется через `outcomeToCommunicatorPayload()`, помещается в синглтон `modules/communicator/core/pending-greeting.ts`, и `router.replace("/")` уводит пользователя на экран коммуникатора. Там `<Communicator />` потребляет greeting из синглтона и автоматически отправляет первое сообщение через `autoSendInitialMessage`.

3. **Результаты → Экспорт JSON.** Кнопка «Экспорт JSON (отладка)» (видна только при `DEBUG_ACTIVATION_EXPORT_ENABLED=true`) — пишет файл в `FileSystem.cacheDirectory` и предлагает Share. Эти файлы пользователи присылают разработчику; формат — см. `docs/user-diagnostic-json-reception.md`.
