---
id: 02_modules/chakra/dependencies
title: Chakra Dependencies
version: 1.2
updated: 2026-06-14
depends_on: [01_foundation/product_model, 02_modules/i18n/spec]
code_refs: [modules/chakra/i18n.ts, modules/chakra/labels.ts]
---

## 1. Зависит от

- **`i18n`** — `AppContentLocale` / `asContentLocale` из `modules/i18n/localeCodes.ts`; typed overlays через `applyFlatChakraOverlay` (`modules/i18n/typed/merge.ts`, gate `chakraTypedSource.json`).

## 2. От него зависят

- **`daily_forecast` (home UI / i18n)**
  - `modules/home/i18n/home.ts`, `DailyRecommendationCard.tsx` — `chakraLabelGenitive(locale, …)` в fallback-рекомендациях.
  - `modules/home/planetChakra.ts` — **`getPlanetChakraMap(locale)`** для `shortLabel`/`chakraName`; JSON даёт номер/ключ/цвет.
  - `ChakraFlower`, `PlanetOfDayBanner`, `ModalMathLevel` — locale-aware map/labels.

- **`practices`** — `PracticeCard` / catalog: `chakraTagLabel`, `chakraShortLabelDisplay`.

- **`profile`** — легенды отчётов (client-side labels где применимо).

- **`assistant` (серверные утилиты, legacy RU)**
  - `_legacy_web/app/api/_utils/topPetals.ts` — `chakraLabelRu` в `PLANET_TO_CHAKRA.label` (утренний монолог `buildTopPetals`).
  - `_legacy_web/app/api/_utils/globalTransitMath.ts` — `chakraLabelRu` в `PLANET_TO_CHAKRA.label` (free-tier global math).

## 3. Контрактные точки риска

- Смена строк в `i18n.ts` inline maps / typed overlays затрагивает home-рекомендации, легенды и practice cards; legacy `labels.ts` — только RU-потребители и server math.
- `chakraNumberFromRuLabel` — единственная точка обратной совместимости со старыми санскритскими подписями в данных/истории; удаление legacy-ключей сломает `chakraDisplayLabelRu` для старых строк.
- Параллельные копии labels в JSON (`chakra_name_ru`) и Deno `dailyForecast.ts` не подхватывают изменения автоматически — при правке `labels.ts` нужна ручная сверка дублей.
