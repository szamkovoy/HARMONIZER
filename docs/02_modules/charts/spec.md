---
id: 02_modules/charts/spec
title: Charts Spec
version: 1.3
updated: 2026-06-21
depends_on: [02_modules/i18n/spec, 02_modules/ui/theme]
code_refs:
  [
    modules/charts/index.ts,
    modules/charts/DonutChart.tsx,
    modules/charts/calcBalance.ts,
    modules/charts/buildDonutSegments.ts,
    modules/charts/donutGeometry.ts,
    modules/charts/DonutVisibilityContext.tsx,
    modules/charts/useDonutAnimation.ts,
    modules/charts/useDonutVisibilityTrigger.ts,
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
- **`DonutChart`** — props: `segments`, `locale?`, `animationKey?`. Центр: **`{balance}%`** (`sectionTitle`, 22/24 px) + подпись **`balanceLabel`** из i18n; дуга баланса — `theme.colors.textMuted`. Легенда справа; нулевые пункты приглушены.
- **`DonutVisibilityProvider`**, **`useDonutScrollProps`**, **`useDonutVisibilityRefresh`** — viewport-триггер анимации (частичная видимость достаточна): внутренний **`useDonutVisibilityTrigger({ onVisible, enabled, resetKey, getProgress, onReset? })`** — `measureInWindow`, layout с высотой < 8 px игнорируется; после mount / смены `resetKey` — `onReset?`, немедленная проверка, rAF и poll **250 ms** до `getProgress() >= 1`; если видим ≥ **1.8 s** при `progress < 1` — повторный `onVisible`; ultimate fallback **`onVisible`** через **5 s**. **`useDonutScrollProps`** → `{ scrollEventThrottle: 16, onScroll, onMomentumScrollEnd, onScrollEndDrag, onContentSizeChange }` на `ScrollView`; **`useDonutVisibilityRefresh()`** — ручной re-check (например `useFocusEffect` на табе). Прогресс — внутренний **`useDonutAnimation`** → `{ progress, progressRef, start, reset, complete }` (`requestAnimationFrame` + `easeOutCubic`, `DONUT_ANIMATION_MS` = 1400; хуки не экспортируются из `index.ts`). **`DonutChart`**: при `onVisible` — `start()` если `progress ≈ 0`, иначе `complete()`; дополнительный fallback **`complete()`** через **2.4 s** (`REVEAL_FALLBACK_MS`).
- **`getChartStrings(locale)`** — typed i18n (`modules/charts/i18n/charts.ts` + overlays `modules/i18n/typed/catalog/charts/*`): `balanceLabel` (центр `DonutChart`), `strengthLabel` (подпись силы в центре `ChakraFlower` на home).

## 3. Визуальные константы

См. `modules/charts/constants.ts`: толщина кольца, трек баланса 5px, цвета сегментов `CHAKRA_SEGMENT_COLORS`.

## 4. Анимация (фазы)

1. Сегменты бублика — 0→100% суммарного угла по часовой от 12 ч.
2. Дуга баланса — с 60% времени до конца.
3. Текст центра — fade-in с 85% времени.

При смене `animationKey` анимация перезапускается после следующего попадания в viewport. Если viewport-триггер или таймер не довели прогресс до 1 — `complete()` показывает финальное состояние без доигрывания кадров.
