---
id: 02_modules/chakra/history
title: Chakra History
version: 1.6
updated: 2026-06-26
depends_on: [01_foundation/product_model, 02_modules/i18n/spec]
code_refs: [modules/chakra/i18n.ts, modules/chakra/labels.ts, modules/chakra/labels.test.ts]
---

## Decision Log

- **2026-06-26 (3):** `recommendationText.ts` gained global long-text validators (`hasStructuredGlobalLongExplanation`, `hasLegacyGlobalChakraMentions`, `isCurrentGlobalLongExplanation`) aligned with `global_morning_recommendation` v5; global serve/regen paths drop or refresh legacy unstructured/chakra-heavy `long_explanation` instead of showing stale copy.

- **2026-06-26 (2):** Recommendation post-processing moved to `recommendationText.ts` (tone keys, §6 header, chakra names via `chakraText.ts`). Transport and monologue paths no longer import `chakraText` directly; client display uses `modules/home/sanitizeRecommendationDisplay.ts`.

- **2026-06-26:** Server-side `chakraText.ts` normalizes visible recommendation fields (`slogan`, `short_text`, `long_explanation`) by replacing Sanskrit/transliterated chakra names with locale-native numeric labels across all 8 `AppContentLocale`. Complements morning prompt v4 (numeric-only chakra rule) and client `modules/chakra/i18n.ts` labels; used on global content upsert/serve, monologue `morning_recommendation`, and `fetchGlobalContent` direct fallback.

- **2026-06-16:** **`chakraTagLabel` для de–nl.** Не-RU tag на карточках практик берёт `nom[n]` из typed chakra overlay; при отсутствии — capitalized `chakraLabel`. EN по-прежнему ordinal (`4th chakra`); RU — `` `${n} чакра` ``.

- **2026-06-14:** **Multilingual chakra labels.** Новый `modules/chakra/i18n.ts` — `AppContentLocale`, RU/EN inline + typed overlays (de–nl) через i18n gate; home/planetChakra/practices/profile переведены на `getPlanetChakraMap(locale)` и `chakraLabelGenitive(locale, …)`. `labels.ts` сохранён как RU-only legacy; server `topPetals` / `globalTransitMath` пока на `chakraLabelRu`.

- **2026-06-10:** `modules/home/planetChakra.ts` импортирует `chakraLabelRu` для поля `chakraName` в баннере планеты дня; JSON `planet_chakra_map.json` больше не является runtime-источником нумерованной подписи чакры на home.
- **2026-06-09:** Вынесены русские chakra labels в `modules/chakra/labels.ts`: нумерованные формы (`первая чакра` … `седьмая чакра`) с падежами и обратным резолвом legacy-санскрита. Home (`i18n/home.ts`, `DailyRecommendationCard.tsx`) и server utils (`topPetals.ts`, `globalTransitMath.ts`) перешли на импорт helper-ов вместо захардкоженных строк; `planet_chakra_map.json` на клиенте и сервере синхронизирован по полю `chakra_name_ru`.
- **2026-06-08:** Продуктовое решение о нумерованных подписях вместо санскрита в видимом RU-тексте зафиксировано в `daily_forecast/history.md` до появления отдельного модуля; текущий пакет `chakra` формализует этот контракт как переиспользуемый API.
