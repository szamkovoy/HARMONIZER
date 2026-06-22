---
id: 02_modules/charts/history
title: Charts History
version: 1.1
updated: 2026-06-21
depends_on: [02_modules/charts/spec]
code_refs: [modules/charts]
---

## Decision Log

- **2026-06-21:** `calcBalance` ужесточён второй итерацией: вместо coverage-first/MAD используется нормализованное евклидово отклонение от идеала `1/7` по всем семи сегментам + степень `1.6`. Причина: предыдущая правка устранила парадокс `2 сегмента < 1 сегмента`, но всё ещё давала слишком “щедрые” `96–97%` у заметно неровных диаграмм.

- **2026-06-21:** Donut UX sync: все отчётные бублики переведены на viewport-reveal; `DonutChart.hideVisualization` очищает сегменты/баланс/центр во время async reload без снятия легенды, а single-segment `360°` donut теперь рисуется как полноценное кольцо и не исчезает на финальном кадре.

- **2026-06-21:** Fix двойной анимации при смене 7/30/90: `setLoading(true)` синхронно в `handlePeriodChange` (до смены `periodDays`); `animationKey` только из значений сегментов и только когда `!loading`; `start()` всегда перезапускает цикл.

- **2026-06-21:** `revealMode`: `immediate` для «Практики по чакрам» и Day (анимация сразу при смене данных/focus); `inViewport` для нижних отчётов Profile. `useDonutAnimation` → `setInterval`; убран fallback `complete()`; layout settle при смене `resetKey` без повторного `onLayout`; стабильный `animationKey` на время loading.

- **2026-06-21:** `getChartStrings` — поле `strengthLabel` (RU/EN inline + overlays de/fr/it/es/pt/nl); потребитель home — `ChakraFlower` (центр: `S_initial` планеты дня + подпись).

- **2026-06-21:** Viewport + focus: `revealSession` (перерисовка при возврате на таб), layout settle 120 ms, min 28 px видимости, сброс reveal при уходе с экрана до старта; стабильный `animationKey` у «Практики по чакрам» во время loading (fix 7д после 30/90).

- **2026-06-21:** Исправлена гонка reveal у «Практики по чакрам»: poll больше не перезапускает `start()` каждые 250 ms (один `onVisible` на `resetKey`, guard в `useDonutAnimation`); убраны stuck/ultimate re-trigger; fallback `complete()` только если chart в viewport. В `ProfileReports` donut не размонтируется при смене периода, пока есть предыдущий `report`.

- **2026-06-21:** Надёжность отрисовки: опрос viewport до завершения анимации, повторный старт при `progress ≈ 0`, fallback `complete()` через 2.4 с; убрана гонка `hasTriggeredRef` + 3 с poll.

- **2026-06-21:** Исправлена отрисовка бубликов: анимация переведена с `useAnimatedReaction` на `requestAnimationFrame` (прогресс не доходил до React), усилена проверка viewport (poll после mount, `onMomentumScrollEnd`, минимальная высота layout).

- **2026-06-20:** Вынесена общая диаграмма-бублик (`modules/charts/`): расчёт баланса MAD, сегменты с зазором 0.04 rad, индикатор баланса, центр `{balance}%` + локализованная подпись «balance», легенда справа, scroll/viewport-анимация через `DonutVisibilityProvider`. Заменила radial chart на Day tab и три donut-отчёта в Profile.
