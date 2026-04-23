# Приём диагностических JSON от пользователей

Когда пользователи в бета-режиме столкнутся с проблемами активации пульсометра, странными метриками или торможением — они смогут прислать нам JSON-файл прямо из приложения. Этот документ — «карта», куда смотреть, как расшифровывать и как быстро локализовать проблему.

## Что пользователь нам присылает

На устройстве создаётся два типа файлов, оба кладутся в `FileSystem.cacheDirectory` и шарятся через стандартное меню iOS Share (Android — через `FileProvider`):

### 1. `breath-coherence-export-<ts>.json`

Полный экспорт завершённой практики. Формируется кнопкой **«Экспорт JSON (отладка)»** на экране результатов (видна, когда `DEBUG_ACTIVATION_EXPORT_ENABLED=true`, см. [`testing-mode.md`](./testing-mode.md)).

Содержит:

- `schemaVersion`, `algorithmVersion`, `exportedAtMs` — метаданные.
- `debug.rrSeriesMs` — все RR-интервалы, валидные для HRV-пайплайна.
- `debug.hybridWindowStats` — границы и число ударов в окнах `realStart` / `realEnd`.
- `debug.baselineBpmSeries` — трендовая EMA пульса за всю практику.
- `debug.rsaCyclesSummary` — пер-цикловая сводка RSA.
- `debug.runtimeDiagnostics[]` — **главное для отладки торможения**: покадровые сэмплы UI FPS, JS-lag, heap, thermal, cameraFrameInterval, hybridPhase.
- `debug.phaseDurationsHistory[]` — история планируемых длительностей фаз дыхания (для отладки несинхронности индикатора и пульса).
- `pulseLog[]` — лог живого канала `pulseBpm` (BPM по секундам для дебага сбоев датчика).
- И стандартные результирующие метрики (когерентность, RSA, RMSSD, стресс).

### 2. `breath-activation-diagnostic-<ts>.json`

Узкий срез — только сигнальный путь во время активации/QC. Формируется из диалога **«Пульс не распознан» → «Отправить отчёт разработчику»**.

Содержит:

- `pipeline.opticalSamples` — последние сэмплы оптики (decimated).
- `pipeline.mergedBeats` — уже выведенные удары.
- `pipeline.peakDetectorDiagnostics` — внутренняя диагностика детектора пиков: пороги, SNR, lockState, adaptive window.
- `qcPulseSamples[]` — точки отображения пульса в окне QC.

## Какого размера файлы

- `breath-coherence-export-*` для 20-мин сессии — ≈ 200–700 КБ (основная масса — `rrSeriesMs` и `baselineBpmSeries`).
- `breath-activation-diagnostic-*` — обычно 50–150 КБ.

## Как работать с присланным файлом

### Быстрый чек: «что сломалось?»

Положи файл рядом и запусти:

```bash
python3 - <<'EOF'
import json, sys
d = json.load(open("breath-coherence-export-XXXX.json"))
dbg = d['debug']
rd = dbg.get('runtimeDiagnostics') or []
print("schemaVersion:", d.get('schemaVersion'))
print("algorithmVersion:", d.get('algorithmVersion'))
print("practice totalMs:", dbg.get('practiceTotalMs'))
print("beats in session:", dbg.get('hybridWindowStats', {}).get('allBeatsCount'))
print("startWindow:", dbg.get('hybridWindowStats', {}).get('startWindowBeatsCount'), "beats over",
      dbg.get('hybridWindowStats', {}).get('startWindowMs', 0)/1000, "s")
print("endWindow:", dbg.get('hybridWindowStats', {}).get('endWindowBeatsCount'), "beats over",
      dbg.get('hybridWindowStats', {}).get('endWindowMs', 0)/1000, "s")
if rd:
    first, last = rd[0], rd[-1]
    print("UI fps median start→end:", first.get('uiFpsMedian'), "→", last.get('uiFpsMedian'))
    print("native mem MB start→end:", first.get('nativeMemoryMb'), "→", last.get('nativeMemoryMb'))
    print("thermal last:", last.get('thermalState'))
    print("camera interval last:", last.get('cameraFrameIntervalMsAvg'), "ms")
EOF
```

### Что искать для типовых жалоб

| Жалоба | Поля в JSON |
|--------|-------------|
| «Подтормаживает к концу» | `runtimeDiagnostics[].uiFpsMedian/P5` — падение с 60 → 15. Одновременно `nativeMemoryMb` обычно растёт на +100..200 МБ за 20 мин. `thermalState` → `serious/critical`. |
| «Телефон греется ещё 30 мин после практики» | Смотри последние сэмплы `runtimeDiagnostics` — должен быть `phase === "results"` и ничего активного (camera off), но память/thermal могут не отпустить сразу, если пайплайн не сбросил буфер. Отсюда `AppState→background` cleanup в `CoherenceBreathScreen` (см. useEffect в результатах). |
| «Пульс не распознаётся» | Проси `breath-activation-diagnostic-*.json`. Смотри `pipeline.peakDetectorDiagnostics` — `lockState`, пороги, SNR. |
| «Пульс прыгает / неверный BPM» | `debug.rrSeriesMs` (сырые RR) + `debug.baselineBpmSeries` (EMA). Аномальные RR > 2000 мс или < 300 мс = пропуски/артефакты. |
| «Не посчитались финальные метрики» | `debug.hybridWindowStats.startWindowBeatsCount` / `endWindowBeatsCount` — если < `HRV_MIN_VALID_BEATS_FOR_METRICS`, метрики подавляются (поле `metricsWithheldDueToInsufficientData`). |

### Куда смотреть в коде для детального разбора

- **Когерентность/RSA/entryTime:** `modules/breath/core/coherence-session-analysis.ts`. Возьми `debug.hybridWindowStats` → прогони `runCoherenceSessionAnalysis({beats, cycleMs, mode, inhaleMs, exhaleMs})` локально, сравни результат с JSON.
- **RMSSD/Stress:** `modules/biofeedback/core/metrics.ts` → `computePracticeHrvMetricsFullSession(rrSeriesMs-derived-beats)`.
- **Hybrid split:** `modules/breath/core/coherence-hybrid-merge.ts`.

## Как принимать файлы от пользователей (процесс)

1. Пользователь нажимает кнопку «Экспорт JSON (отладка)» или «Отправить отчёт разработчику» → откроется системный Share-sheet.
2. Предлагаемые каналы: Telegram / Email / AirDrop / Files. Файл весит < 1 МБ, любой канал подойдёт.
3. Мы кладём полученный файл в `/Users/sergey/Desktop/HARMONIZER/incoming-diagnostics/<date>/<device>/<name>.json` (директория временная, в git не коммитится).
4. Запускаем quick-check выше.
5. При необходимости — пишем мини-скрипт в `scripts/` или тестовый unit, прогоняющий именно этот файл через ядра метрик.

## Важно: приватность

- Файлы **не содержат** персональных данных (ID, имя, координаты) — только `attemptID` (UUID), модель устройства и серии чисел.
- Пульс и беспривязочный биосигнал — техническая информация, не медицинский документ. Не храним дольше, чем нужно для диагностики.
- Для публичных репозиториев/багтрекера пересылаем только содержимое `debug.runtimeDiagnostics` / `debug.hybridWindowStats` (usually) — этого хватает. RR-ряды и beats прикладываем только если проблема именно в алгоритме пульса.
