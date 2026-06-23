---
id: 02_modules/charts/dependencies
title: Charts Dependencies
version: 1.4
updated: 2026-06-23
depends_on: [02_modules/charts/spec]
code_refs: [modules/charts/DonutChart.tsx, modules/home/ui/ChakraFlower.tsx, app/(tabs)/day.tsx, modules/profile/ui/ProfileReports.tsx]
---

## 1. Зависит от

| Модуль | Контракт |
| --- | --- |
| `i18n` | `AppContentLocale`, `mergeTypedLocale`, overlays `charts/*` |
| `ui/theme` | `AppText`, `useTheme`, `theme.colors.textMuted` для дуги баланса |
| `react-native-svg` | `Svg`, `Path`, `Circle` |

## 2. От него зависят

| Потребитель | Использование |
| --- | --- |
| `daily_forecast` (home) | `ChakraFlower` — только **`CHAKRA_SEGMENT_COLORS`**; центр — сила + **`planetLabels`** из home i18n (не `getChartStrings`) |
| `daily_forecast` (Day tab) | `DonutChart` для блока «Сферы жизни» в `app/(tabs)/day.tsx` |
| `profile` | `DonutChart` в `ProfileReports.tsx` (сферы, состояния, практики по чakрам) |

## 3. Данные

Модуль **не** загружает данные сам. Потребители передают готовые `segments` (`id`, `value`, `color`, `label`, опционально `legendSuffix`).
