---
id: 02_modules/chakra/dependencies
title: Chakra Dependencies
version: 1.1
updated: 2026-06-10
depends_on: [01_foundation/product_model]
code_refs: [modules/chakra/labels.ts]
---

## 1. Зависит от

- Нет импортов из других `modules/*`. Утилита самодостаточна.

## 2. От него зависят

- **`daily_forecast` (home UI / i18n)**
  - `modules/home/i18n/home.ts` — `chakraLabelGenitiveRu` в `recommendation.fallback` (RU) и формулировках рекомендации дня.
  - `modules/home/ui/DailyRecommendationCard.tsx` — `chakraLabelGenitiveRu` в клиентском `detailText` fallback.
  - `modules/home/planetChakra.ts` — `chakraLabelRu(chakra_number)` для `chakraName` в баннере; `planet_chakra_map.json` даёт номер/ключ/цвет/`short_label_ru`, поле `chakra_name_ru` в JSON — legacy-дубль для сверки.

- **`assistant` (серверные утилиты)**
  - `_legacy_web/app/api/_utils/topPetals.ts` — `chakraLabelRu` в `PLANET_TO_CHAKRA.label` (утренний монолог `buildTopPetals`).
  - `_legacy_web/app/api/_utils/globalTransitMath.ts` — `chakraLabelRu` в `PLANET_TO_CHAKRA.label` (free-tier global math).

## 3. Контрактные точки риска

- Смена строк в `RU_CHAKRA_FORMS` затрагивает home-рекомендации, `topPetals` / `math_level` и любые тексты, где падежи строятся через `chakraLabelGenitiveRu` / `chakraLabelAccusativeRu`.
- `chakraNumberFromRuLabel` — единственная точка обратной совместимости со старыми санскритскими подписями в данных/истории; удаление legacy-ключей сломает `chakraDisplayLabelRu` для старых строк.
- Параллельные копии labels в JSON (`chakra_name_ru`) и Deno `dailyForecast.ts` не подхватывают изменения автоматически — при правке `labels.ts` нужна ручная сверка дублей.
