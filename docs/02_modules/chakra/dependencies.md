---
id: 02_modules/chakra/dependencies
title: Chakra Dependencies
version: 1.7
updated: 2026-06-26
depends_on: [01_foundation/product_model, 02_modules/i18n/spec]
code_refs: [modules/chakra/i18n.ts, modules/chakra/labels.ts, _legacy_web/app/api/_utils/chakraText.ts]
---

## 1. Зависит от

- **`i18n`** — `AppContentLocale` / `asContentLocale` из `modules/i18n/localeCodes.ts`; typed overlays через `applyFlatChakraOverlay` (`modules/i18n/typed/merge.ts`, gate `chakraTypedSource.json`).

## 2. От него зависят

- **`daily_forecast` (home UI / i18n)**
  - `modules/home/i18n/home.ts`, `DailyRecommendationCard.tsx` — `chakraLabelGenitive(locale, …)` в fallback-рекомендациях.
  - `modules/home/planetChakra.ts` — **`getPlanetChakraMap(locale)`** для `shortLabel`/`chakraName`; JSON даёт номер/ключ/цвет.
  - `ChakraFlower`, `PlanetOfDayBanner`, `ModalMathLevel` — locale-aware map/labels; у `ChakraFlower` легенда и подпись в центре — **`planetLabels`** из home i18n (не `chakraShortLabelDisplay`); цвет лепестков — `CHAKRA_SEGMENT_COLORS` из `charts` (не `meta.color` из JSON).

- **`practices`** — `PracticeCard` / catalog: `chakraTagLabel`, `chakraShortLabelDisplay`.

- **`profile`** — легенды отчётов (client-side labels где применимо).

- **`assistant` (серверные утилиты, legacy RU)**
  - `_legacy_web/app/api/_utils/topPetals.ts` — `chakraLabelRu` в `PLANET_TO_CHAKRA.label` (утренний монолог `buildTopPetals`).
  - `_legacy_web/app/api/_utils/globalTransitMath.ts` — `chakraLabelRu` в `PLANET_TO_CHAKRA.label` (free-tier global math).
  - `_legacy_web/app/api/_utils/chakraText.ts` — chakra-only normalization; consumed internally by `recommendationText.ts`.
  - `_legacy_web/app/api/_utils/recommendationText.ts` — visible recommendation post-processing (chakra names, tone keys, §6 headers) plus `isCurrentGlobalLongExplanation` validation for global long text; used by global content upsert/serve/regen and `services/globalContentClient.ts` direct fallback.

- **`daily_forecast` (client transport)**
  - `services/globalContentClient.ts` — imports `normalizeRecommendationText`, `isCurrentGlobalLongExplanation`, and `getMathLevelStrings` for locale-correct free-path direct DB fallback (drops legacy unstructured/chakra-heavy `long_explanation`).
  - `modules/home/sanitizeRecommendationDisplay.ts` — client display wrapper over `normalizeRecommendationText` (`useDayContent`, `DailyRecommendationCard`).

## 3. Контрактные точки риска

- Смена строк в `i18n.ts` inline maps / typed overlays затрагивает home-рекомендации, легенды и practice cards; legacy `labels.ts` — только RU-потребители и server math.
- `chakraNumberFromRuLabel` — единственная точка обратной совместимости со старыми санскритскими подписями в данных/истории; удаление legacy-ключей сломает `chakraDisplayLabelRu` для старых строк.
- Параллельные копии labels в JSON (`chakra_name_ru`) и Deno `dailyForecast.ts` не подхватывают изменения автоматически — при правке `labels.ts` нужна ручная сверка дублей.
