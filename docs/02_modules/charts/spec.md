---
id: 02_modules/charts/spec
title: Charts Spec
version: 1.0
updated: 2026-06-20
depends_on: [02_modules/i18n/spec, 02_modules/ui/theme]
code_refs:
  [
    modules/charts/index.ts,
    modules/charts/DonutChart.tsx,
    modules/charts/calcBalance.ts,
    modules/charts/buildDonutSegments.ts,
    modules/charts/donutGeometry.ts,
    modules/charts/DonutVisibilityContext.tsx,
    modules/charts/i18n/charts.ts,
    app/(tabs)/day.tsx,
    modules/profile/ui/ProfileReports.tsx,
  ]
---

## 1. Назначение

Модуль **`charts`** — единая реализация **диаграммы-бублика** с индикатором баланса для клиента Expo. Используется на вкладке «День» (сферы жизни) и в профильных отчётах (сферы, состояния, практики по чакрам).

## 2. Публичный контракт

- **`calcBalance(weights: number[])`** → `{ balance: number; angle: number }` — формула MAD по семи весам (0 допустим); `N = 7`.
- **`segmentsToWeights(segments)`** — маппинг `{ id: 1..7, value }[]` в массив весов.
- **`buildDonutSegments` / `clipDonutSegmentsForProgress`** — геометрия сегментов с зазором `DONUT_GAP_RAD = 0.04`; неактивные (`value = 0`) не рисуются.
- **`DonutChart`** — props: `segments`, `locale?`, `animationKey?`. Центр: **`{balance}%`** + подпись **`balanceLabel`** из i18n. Легенда справа; нулевые пункты приглушены.
- **`DonutVisibilityProvider`**, **`useDonutScrollProps`**, **`useDonutVisibilityRefresh`** — анимация стартует, когда элемент попадает в viewport (частичная видимость достаточна); данные считаются заранее, анимируется только отрисовка (~1400 ms, easeOutCubic).
- **`getChartStrings(locale)`** — typed i18n (`modules/charts/i18n/charts.ts` + overlays `modules/i18n/typed/catalog/charts/*`).

## 3. Визуальные константы

См. `modules/charts/constants.ts`: толщина кольца, трек баланса 5px, цвета сегментов `CHAKRA_SEGMENT_COLORS`.

## 4. Анимация (фазы)

1. Сегменты бублика — 0→100% суммарного угла по часовой от 12 ч.
2. Дуга баланса — с 60% времени до конца.
3. Текст центра — fade-in с 85% времени.

При смене `animationKey` анимация перезапускается после следующего попадания в viewport.
