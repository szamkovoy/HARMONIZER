---
id: 02_modules/charts/spec
title: Charts Spec
version: 1.5
updated: 2026-06-23
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

- **`calcBalance(weights: number[])`** → `{ balance: number; angle: number }` — строгая evenness-метрика по семи весам (`N = 7`, 0 допустим): веса нормализуются в 7 долей, затем считается **евклидово отклонение от идеального равномерного распределения `1/7`**, нормализованное относительно worst-case `100/0/0/0/0/0/0`; итоговая кривая дополнительно усиливает штраф степенью `1.6`. Практический смысл: один активный сегмент ≈ **1%**, семь равных сегментов = **100%**, а заметные визуальные перекосы остаются существенно ниже `90–100%`.
- **`segmentsToWeights(segments)`** — маппинг `{ id: 1..7, value }[]` в массив весов.
- **`buildDonutSegments` / `clipDonutSegmentsForProgress`** — геометрия сегментов с зазором `DONUT_GAP_RAD = 0.04`; неактивные (`value = 0`) не рисуются.
- **`DonutChart`** — props: `segments`, `locale?`, `animationKey?`, **`revealMode?`** (`immediate` | `inViewport`, default `inViewport`), **`hideVisualization?`**. Центр: **`{balance}%`** (`sectionTitle`, 22/24 px) + **`balanceLabel`**; дуга баланса — `theme.colors.textMuted`. Легенда справа; нулевые пункты приглушены. `hideVisualization` скрывает цветные сегменты, дугу баланса и центральный текст, но оставляет трек/легенду на время async reload. Полный одинарный сегмент (`360°`) рисуется как полноценное кольцо, а не исчезает на финальном кадре. В текущем UI все четыре отчётных donut-карточки (`Profile` + `Day`) используют **`revealMode="inViewport"`**.
- **`DonutVisibilityProvider({ children, scrollRef? })`**, **`useDonutScrollProps`**, **`useDonutVisibilityRefresh`** — для **`revealMode="inViewport"`**: `useDonutVisibilityTrigger` — `measureInWindow`, min **28 px** видимости, layout settle **80 ms** (в т.ч. при смене `resetKey`, без ожидания повторного `onLayout`); **`onVisible` один раз на `resetKey`**; при уходе с экрана до старта (`progress = 0`) reveal сбрасывается. **`resetKey` в `DonutChart`** = `{revealSession}|{animationKey}`; смена `animationKey` может сразу очистить визуализацию (`hideVisualization`) и затем заново запустить reveal, когда блок видим. **`useDonutVisibilityRefresh()`** на focus таба инкрементирует **`revealSession`**; callback зависит только от стабильных `bumpRevealSession` / `notifyVisibilityCheck` (не от всего context), чтобы смена `revealSession` не пересоздавала `useFocusEffect` и не крутила бесконечный refresh. **`useDonutScrollProps`** → `{ scrollEventThrottle: 16, onScroll (+ scrollY), onMomentumScrollEnd, onScrollEndDrag, onContentSizeChange }` — тоже на стабильных refs/notify. Прогресс — **`useDonutAnimation`** (`setInterval` 16 ms, `DONUT_ANIMATION_MS` = 1400; `start()` всегда перезапускает цикл).
- **`getChartStrings(locale)`** — typed i18n (`modules/charts/i18n/charts.ts` + overlays `modules/i18n/typed/catalog/charts/*`): `balanceLabel` (центр `DonutChart`). Поле `strengthLabel` остаётся в typed-модуле, но после снятия импорта из home `ChakraFlower` активных потребителей нет.

## 3. Визуальные константы

См. `modules/charts/constants.ts`: толщина кольца, трек баланса 5px, цвета сегментов `CHAKRA_SEGMENT_COLORS`.

## 4. Анимация (фазы)

1. Сегменты бублика — 0→100% суммарного угла по часовой от 12 ч.
2. Дуга баланса — с 60% времени до конца.
3. Текст центра — fade-in с 85% времени.

При смене `animationKey` (или `revealSession` на focus таба) анимация перезапускается: **`immediate`** — сразу; **`inViewport`** — после попадания в viewport. Для async reload допускается промежуточное скрытие визуализации через `hideVisualization`, чтобы старый donut не залипал на экране до прихода новых данных.
