# Тестовый режим модуля BREATH

Если нужно собрать **полную диагностику** одной практики — для отладки замедления, перегрева, нестабильного пульса или любой другой аномалии — включается через один выключатель.

## Как включить

Файл: `modules/breath/config/debug-flags.ts`

```ts
export const BREATH_TESTING_MODE = true;  // <— мастер
```

Это сразу включает:

1. **Perf-сэмплинг** (`PERF_DIAGNOSTICS_ENABLED`) — FPS, JS-loop lag, heap, thermal, frame-processor latency, per-second снимок по всей сессии. Один сэмпл каждые 10 с, до 450 точек — хватает на практику до 75 мин.
2. **Экспорт JSON из UI** (`DEBUG_ACTIVATION_EXPORT_ENABLED`):
   - на экране «Активация пульсометра» появляется строчка «Отправить отчёт разработчику» в диалоге неудачного QC → экспорт `breath-activation-diagnostic-*.json`;
   - на экране результатов появляется кнопка «Экспорт JSON (отладка)» → экспорт `breath-coherence-export-*.json` со всей runtime-телеметрией;
   - под таблицей результатов видны debug-строки (time base, счётчик ударов в окне, после дедупликации).
3. **JankDetector** — честный сбор UI FPS и JS-таймер лага; иначе поле в JSON пишется как `null`.

## Как выключить

Там же, в `debug-flags.ts`:

```ts
export const BREATH_TESTING_MODE = false;
```

`PerfDiag.push` превращается в no-op, native-heap-probe не опрашивается, UI-кнопки экспорта скрываются, debug-строки убираются.

Никакие другие файлы трогать не нужно.

## Что где лежит

- Сэмплинг + накопитель: `modules/breath/debug/session-runtime-diagnostics.ts`.
- Jank-детектор: `modules/breath/debug/jank-detector.ts`.
- Формат экспорта: `CoherenceSessionResult.buildExportJson` + `exportJson()` в `CoherenceBreathScreen.tsx`.
- Формат activation-диагностики: `exportActivationDiagnostic` в `CoherenceBreathScreen.tsx` + `pipeline.getActivationDiagnostic()`.

## Когда пригодится

- Пользователь присылает скриншот «последние минуты практики подтормаживают» — включаем `BREATH_TESTING_MODE`, просим повторить, забираем JSON, смотрим в `runtimeDiagnostics[].uiFpsMedian/uiFpsP5/nativeMemoryMb/thermalState`.
- «Пульс не распознался на активации» — включаем, ловим кнопку «Отправить отчёт разработчику» при QC-failed → анализируем `peakDetectorDiagnostics`, `opticalSamples`, `mergedBeats`.
- Правим алгоритм когерентности / RMSSD / Stress — берём сохранённый экспорт, скармливаем чистой функции-ядру (`runCoherenceSessionAnalysis` / `computePracticeHrvMetricsFullSession`), сравниваем результат.

## Частичная конфигурация

Если вдруг нужен экспорт JSON **без** тяжёлого perf-сэмплинга (экономия памяти, но пользователь всё равно может прислать файл):

```ts
// modules/breath/config/debug-flags.ts
export const BREATH_TESTING_MODE = false;
export const PERF_DIAGNOSTICS_ENABLED = false;        // тяжёлый сэмплинг выкл
export const DEBUG_ACTIVATION_EXPORT_ENABLED = true;  // UI-кнопки вкл
```

Флаги декларированы как `const`, поэтому для ручной рассинхронизации просто замени `= BREATH_TESTING_MODE` на явный `true`/`false`.
