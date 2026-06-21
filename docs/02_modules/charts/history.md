---
id: 02_modules/charts/history
title: Charts History
version: 1.0
updated: 2026-06-20
depends_on: [02_modules/charts/spec]
code_refs: [modules/charts]
---

## Decision Log

- **2026-06-21:** Исправлена отрисовка бубликов: анимация переведена с `useAnimatedReaction` на `requestAnimationFrame` (прогресс не доходил до React), усилена проверка viewport (poll после mount, `onMomentumScrollEnd`, минимальная высота layout).

- **2026-06-20:** Вынесена общая диаграмма-бублик (`modules/charts/`): расчёт баланса MAD, сегменты с зазором 0.04 rad, индикатор баланса, центр `{balance}%` + локализованная подпись «balance», легенда справа, scroll/viewport-анимация через `DonutVisibilityProvider`. Заменила radial chart на Day tab и три donut-отчёта в Profile.
