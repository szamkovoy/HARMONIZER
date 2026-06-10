---
id: 02_modules/chakra/history
title: Chakra History
version: 1.1
updated: 2026-06-10
depends_on: [01_foundation/product_model]
code_refs: [modules/chakra/labels.ts, modules/chakra/labels.test.ts]
---

## Decision Log

- **2026-06-10:** `modules/home/planetChakra.ts` импортирует `chakraLabelRu` для поля `chakraName` в баннере планеты дня; JSON `planet_chakra_map.json` больше не является runtime-источником нумерованной подписи чакры на home.
- **2026-06-09:** Вынесены русские chakra labels в `modules/chakra/labels.ts`: нумерованные формы (`первая чакра` … `седьмая чакра`) с падежами и обратным резолвом legacy-санскрита. Home (`i18n/home.ts`, `DailyRecommendationCard.tsx`) и server utils (`topPetals.ts`, `globalTransitMath.ts`) перешли на импорт helper-ов вместо захардкоженных строк; `planet_chakra_map.json` на клиенте и сервере синхронизирован по полю `chakra_name_ru`.
- **2026-06-08:** Продуктовое решение о нумерованных подписях вместо санскрита в видимом RU-тексте зафиксировано в `daily_forecast/history.md` до появления отдельного модуля; текущий пакет `chakra` формализует этот контракт как переиспользуемый API.
