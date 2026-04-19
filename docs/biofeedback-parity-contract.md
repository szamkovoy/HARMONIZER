# Biofeedback Parity Contract (фаза рефакторинга)

Этот документ фиксирует **математические инварианты**, которые должны сохраниться после разбора `FingerSignalAnalyzer` на engines. Любая правка одной из этих формул должна быть отдельным коммитом, отделённым от структурного рефакторинга, и сопровождаться обновлением `algorithmVersion` соответствующей цепочки.

## Принцип

Новые engines переиспользуют **те же чистые функции** из существующих файлов:

- `modules/biofeedback/core/metrics.ts` — RMSSD, индекс Баевского, тиры HRV, Хампель.
- `modules/biofeedback/core/ppg-bandpass.ts` — Butterworth SOS bandpass.
- `modules/breath/core/coherence-session-analysis.ts` — анализ когерентности.
- `modules/breath/core/tachogram-4hz.ts` — мягкая очистка RR, тахограмма.

Старый код этих файлов **не трогается** в фазах 1–8. Только `finger-analysis.ts` разбирается на engines и удаляется в фазе 9 (после того, как все потребители переведены на новые engines).

## Инварианты по метрикам

### Пульс (LivePulseChannel + PulseBpmEngine)

| Параметр | Источник | Значение |
| --- | --- | --- |
| Дедуп пиков | `BEAT_DUPLICATE_TOLERANCE_MS` | 220 ms |
| История ударов | `BEAT_HISTORY_WINDOW_MS` | 45 минут |
| Окно для среднего BPM | `PULSE_WINDOW_MS` | 10 s |
| Жёсткие границы RR пульса | `PULSE_RR_MIN_MS` / `PULSE_RR_MAX_MS` | 450 / 1400 ms |
| Sequential filter (% отклонения) | `PULSE_RR_DEVIATION_RATIO` | 0.16 |
| Stale-таймаут удара | `BEAT_STALE_TIMEOUT_MS` | 4200 ms |
| Refractory period для пиков | `60_000 / maxPulseBpm` | ≥ 280 ms (по умолчанию ~333 ms) |
| Hold lock (после tracking) | `PULSE_LOCK_HOLD_MS` | 6000 ms (новое: 2000 ms для LivePulseChannel) |

**Новое поведение в LivePulseChannel** (явно не parity): экстраполяция тиков по последнему стабильному периоду до 2 с в `holding`, затем событие `heartbeatLost`.

### RMSSD и стресс (HrvEngine, StressEngine)

| Параметр | Источник | Значение |
| --- | --- | --- |
| Жёсткие границы RR HRV | `HRV_RR_HARD_MIN_MS` / `HRV_RR_HARD_MAX_MS` | 300 / 2000 ms |
| Минимум валидных ударов | `HRV_MIN_VALID_BEATS_FOR_METRICS` | 30 |
| Префикс «начального» сегмента | `HRV_PREFIX_BEATS_FOR_SEGMENT` | 90 |
| Хвост 120–179 | `HRV_TAIL_BEATS_FINAL_MID` | 60 |
| Хвост 180+ | `HRV_TAIL_BEATS_FINAL_LONG` | 90 |
| Латч начала | `HRV_LATCH_INITIAL_AFTER_BEATS` | 90 |
| Тиров max | `HRV_TIER_MAX_BEATS` | 180 |
| Хампель окно / nσ | `HRV_HAMPEL_WINDOW_SIZE` / `HRV_HAMPEL_NSIGMA` | 13 / 3 |
| Trim ratio для RMSSD | `HRV_PRACTICE_RMSSD_TRIM` | 0.12 |
| Потолок RMSSD сегмента | `HRV_PRACTICE_RMSSD_ABS_MAX_MS` | 160 ms |
| Divisor для % Баевского | `BAEVSKY_STRESS_PERCENT_DIVISOR` | 220 |
| EMA τ для дисплея RMSSD | `HRV_RMSSD_DISPLAY_TAU_MS` | 12 s |
| EMA τ для дисплея стресса | `HRV_STRESS_DISPLAY_TAU_MS` | 12 s |
| Hold для RMSSD | `HRV_HOLD_MS` | 9 s |
| Hold для стресса | `STRESS_HOLD_MS` | 12 s |

**Поведение**:

- RMSSD на сегменте: `hampelOutlierFlags` (флаги, не подмена) → исключение пар с выбросами → trimmed RMSSD по блокам → медиана по блокам → потолок.
- Баевский на сегменте: `hampelFilterRrIntervals` (импутация медианой) → `calculateBaevskyStressIndexRaw` → медиана по блокам → `mapBaevskyStressToPercent`.
- EMA-сглаживание для дисплея — **в UI-адаптерах**, не в engine.

### Когерентность (CoherenceEngine)

| Параметр | Источник | Значение |
| --- | --- | --- |
| Тахограмма частота | `TACHO_SAMPLE_RATE_HZ` | 4 Hz |
| Coherence master ratio | `COHERENCE_MASTER_RATIO` | 0.75 |
| Stretch exponent | `COHERENCE_STRETCH_EXPONENT` | 1.25 |
| Порог вхождения | `COHERENCE_ENTRY_THRESHOLD_PERCENT` | 40 |
| Длительность вхождения | `ENTRY_STABILITY_SECONDS` | 15 s |
| Медианный фильтр окно | `SMOOTH_WINDOW_SECONDS` | 3 s |
| Pwin поиск пика | `PWIN_SEARCH_MIN_HZ` / `PWIN_SEARCH_MAX_HZ` | 0.04 / 0.2 Hz |
| Pwin полуширина | `PWIN_HALF_WIDTH_HZ` | 0.015 Hz |
| Ptotal окно | `PTOTAL_MIN_HZ` / `PTOTAL_MAX_HZ` | 0.04 / 0.4 Hz |
| Window FFT (test120s) | `TEST120_WINDOW_SECONDS` | 60 s |
| Skip aggregate (test120s) | `TEST120_WINDOW_SKIP_SECONDS` | 0 |
| RR artifact deviation | `RR_ARTIFACT_DEVIATION` | 0.30 |
| RR warn fraction | `RR_COHERENCE_WARN_FRACTION` | 0.15 |
| Min valid seconds | `COHERENCE_MIN_VALID_SECONDS_FOR_METRICS` | 60 |

`CoherenceEngine` остаётся stateful-обёрткой над **`runCoherenceSessionAnalysis`** — ни одна формула из этого файла не меняется.

### RSA (RsaEngine)

| Параметр | Значение |
| --- | --- |
| Цикл неактивен если `rsaBpm < ` | `RSA_CYCLE_MIN_BPM` = 2 |
| Амплитуда | медиана `hrMax - hrMin` по активным циклам |
| Нормировка | `amplitudeBpm / mean(fullTacho.bpm) × 100` |

### Калибровка (CalibrationStateMachine)

| Параметр | Источник | Значение |
| --- | --- | --- |
| Прогрев | `WARMING_PHASE_MS` | 10 s |
| Settle window | `PULSE_SETTLE_MS` | 10 s |
| Good fraction | `PULSE_SETTLE_GOOD_FRAC` | 0.82 |
| Hard reset (палец отсутствует) | `WARMING_HARD_RESET_MS` | 10 s |
| Quality порог стабильного lock | `STABLE_LOCK_QUALITY_THRESHOLD` | 0.54 |
| Quality порог hold release | `HOLD_LOCK_RELEASE_QUALITY` | 0.06 |
| Quality порог HRV | `HRV_QUALITY_THRESHOLD` | 0.52 |
| Гистерезис качества | `QUALITY_HYSTERESIS_DROP` | 0.44 |
| Finger presence track | `FINGER_PRESENCE_TRACK_THRESHOLD` | 0.58 |
| Finger presence hold | `FINGER_PRESENCE_HOLD_THRESHOLD` | 0.28 |

CoherenceBreath QC (5 s по времени камеры, `tracking + quality > 0.7 + ≥3 удара`) остаётся **поверх** общей калибровки — это политика конкретной практики, не общая инфраструктура.

## Что меняется намеренно

1. **LivePulseChannel** — новый канал событий ударов с экстраполяцией в `holding` (≤ 2 s). Предыдущей реализации не было.
2. **EMA-сглаживание перенесено в UI-адаптеры** — engines выдают сырые значения. В экспорте JSON v3 эти сырые значения становятся доступны для отладки.
3. **`FINGER_SESSION_RECORDING_START_MS = 20 s`** удаляется как параллельный протокол. UI-сессия записи начинается по событию `session: ready` от `CalibrationStateMachine`.
4. **Накопители ударов в Breath UI** (`allSessionBeatsRef`, `preflightBeatsRef`) удаляются. Bus сам ведёт активную сессию.

## Стратегия проверки parity

- **Структурная**: новые engines вызывают **существующие функции из `metrics.ts` и `coherence-session-analysis.ts`** напрямую. Ни одна формула не дублируется.
- **Манульная**: после phase-5 на iPhone проводится 120-с практика когерентного дыхания; сравниваются `entryTimeSec`, `coherenceAveragePercent`, `rsaAmplitudeBpm` с эталоном до рефакторинга.
- **Архивная**: при необходимости можно прогнать `samples[]` из `docs/last_session2.json` через `FingerSignalAnalyzer` (старый) и через цепочку новых engines, сравнить результирующий список ударов и метрик. Скрипт можно добавить как `scripts/replay-finger-session.mts` (Node 24 native TS).

