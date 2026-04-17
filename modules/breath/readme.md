# BREATH

Модуль дыхательных практик. Первая реализованная техника — **когерентное дыхание** (120 с,
ритм 5+5 с). Дальнейшие техники (канальное, квадрат, треугольники, ритмичное в темпе пульса
и т.д.) добавляются как новые экраны на той же шине `BiofeedbackBus`.

## Зависимости

- **BIOFEEDBACK** — единый источник биометрии. См. **[`docs/biofeedback-architecture.md`](../../docs/biofeedback-architecture.md)**.
  Экран Breath — это просто потребитель каналов Bus (`pulseBpm`, `beat`, `coherence`, `contact`,
  `session`) и временный «контроллер» жизненного цикла `CoherenceEngine` (start/finalize).
- **MANDALA** — визуализация (`MandalaCanvas`, пресет 3-й чакры).

## Маршрут

- `app/breath-coherence.tsx` — экран «Когерентное дыхание».

## Архитектура (после рефакторинга 2026)

`CoherenceBreathScreen` оборачивается в `BiofeedbackProvider` и:

1. Монтирует источник: `FingerPpgCameraSource` (если есть native plugin) или
   `SimulatedSensorSource` (Expo Go / fallback).
2. Управляет фазами UI: `idle → warmup → qualityCheck → running → results`.
3. На переходе `qualityCheck → running` вызывает `pipeline.getCoherenceEngine().startSession({...})`.
4. По окончании 120 с вызывает `finalize()` и показывает результаты.
5. Подписывается на каналы Bus для отображения текущего пульса/качества/когерентности.
6. Удары (`beat` channel) можно использовать для синхронизации дыхания с пульсом — для
   когерентного дыхания этого пока не нужно (фиксированный ритм 5+5), но это
   готовый канал для будущих практик.

## Что удалено

- `core/simulated-beats.ts` → перенесено в `modules/biofeedback/sensors/simulated-sensor.ts`.
- `ui/BreathFingerCapture.tsx` → заменён на `modules/biofeedback/sensors/FingerPpgCameraSource.tsx`.
- Накопители ударов (`allSessionBeatsRef`, `preflightBeatsRef`) в screen — теперь живут
  внутри `CoherenceEngine` (`pipeline.getCoherenceEngine()`).

## Анализ когерентности

Чистая функция в `core/coherence-session-analysis.ts` (интерполяция 4 Гц, FFT, Pwin/Ptotal,
RSA по циклам, нормированная RSA, время вхождения). Используется через `CoherenceEngine`
(в `modules/biofeedback/engines/coherence-engine.ts`), который оборачивает её в stateful API
для накопления ударов и периодических снимков.

## Экспорт

Экран `CoherenceBreathScreen` пока пишет legacy-формат `schemaVersion: 2` через
`buildCoherenceExportJson`. Параллельно доступен унифицированный
`buildSessionExportV3` (см. `modules/biofeedback/export/SessionExporter.ts`) — его использует
`BiofeedbackProbeScreen`. Финальное переключение Breath на v3 — следующий шаг продуктовой
итерации.

## Добавить новую дыхательную технику

1. Создать константы практики (inhaleMs, exhaleMs, holdMs, циклы) в `core/`.
2. Создать UI-экран по образцу `CoherenceBreathScreen`. Использовать `BiofeedbackProvider`.
3. Если техника опирается на пульс — подписаться на `beat` (live channel) для синка.
4. Если нужна метрика когерентности/RSA — переиспользовать `CoherenceEngine`.
5. Добавить маршрут в `app/`.
