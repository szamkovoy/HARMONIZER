# BREATH

Модуль дыхательных практик: оболочка экрана (`BreathPracticeShell`), первая сценарная практика — **когерентное дыхание** (120 с, ритм 5+5 с). Метки ударов для анализа накапливаются в `allSessionBeatsRef` (дедуп 220 мс), т.к. в одном снимке — только скользящий merged-буфер.

## Зависимости

- **MANDALA** — визуализация (`MandalaCanvas`, пресет чакры 3 в `visuals/chakra3-mandala-keyframe.ts`).
- **BIOFEEDBACK** — ППГ с пальца (`FingerSignalAnalyzer`, поле `beatTimestampsMs` в снимке для RR).

## Маршрут

- `app/breath-coherence.tsx` — экран практики.

## UX

- Перед текстом «вдох/выдох» в **dev build** с frame plugin: фаза **калибровки** до `pulseCalibrationComplete` и устойчивого пульса (как в probe). В Expo Go / без плагина — сразу практика, метрики по смоделированному RR.
- Визуал: **Bindu succession** (`BreathBinduMandala` → `BinduSuccessionLabCanvas`), пресет 3-й чакры.
- Полоска фазы: прогресс в `useFrameCallback` (Reanimated), таймер UI ~500 ms — без лишних перерисовок Skia.

## Анализ когерентности

Логика в `core/coherence-session-analysis.ts` (интерполяция 4 Гц, FFT, Pwin/Ptotal, RSA по циклам, нормированная RSA, время вхождения). Старт: 10 с прогрева без `pulseLog`, затем цикл проверки 5 с (tracking, quality > 0.7, ≥3 ударов), после успеха — 120 с практики с буфером QC для тахограммы. Режим анализа `test120s`.

## Экспорт

Кнопка на экране результатов пишет JSON в cache и открывает системный Share (AirDrop и т.д.). Схема `schemaVersion: 2`: в `beats` разделены метки до/после дедупликации; полный разбор пайплайна и соответствие PDF — **`docs/breath-coherence-pipeline.md`**.
