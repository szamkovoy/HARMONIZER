---
id: 02_modules/chakra/spec
title: Chakra Spec
version: 1.6
updated: 2026-06-26
depends_on: [01_foundation/product_model, 02_modules/i18n/spec]
code_refs:
  [modules/chakra/i18n.ts, modules/chakra/labels.ts, modules/chakra/labels.test.ts, modules/chakra/i18n/chakraTypedSource.json, _legacy_web/app/api/_utils/chakraText.ts]
---

## 1. Назначение

`chakra` — общий слой **локализованных подписей чакр** в видимом UI (клиент) и части серверных текстов. Модуль не рендерит UI и не владеет маппингом планета→чакра. Канон для UI — **`modules/chakra/i18n.ts`** (`AppContentLocale`, RU/EN inline + gate-managed overlays de–nl через `applyFlatChakraOverlay`). **`modules/chakra/labels.ts`** остаётся RU-only legacy для старых импортов и обратной совместимости.

## 2. Публичный контракт

### 2.1 `modules/chakra/i18n.ts` (основной API)

- **`ChakraLocale`** = `AppContentLocale` (`ru` … `nl`); **`coerceChakraLocale(value)`**.
- **`chakraShortLabel` / `chakraShortLabelDisplay`** — короткие state-labels для легенд (sentence case в display).
- **`chakraLabel`**, **`chakraLabelGenitive`**, **`chakraNumericDisplayLabel`**, **`formatChakraList`** — видимые формы по номеру чакры 1–7.
- **`chakraTagLabel(locale, chakraNumber)`** — короткий tag на карточках практик: RU — `` `${n} чакра` ``; EN — ordinal (`4th chakra`); de–nl — overlay `nom[n]` (capitalized), иначе capitalized **`chakraLabel`**; EN ordinal сохраняется, если overlay `nom` пуст.
- **`capitalizeChakraLabel`** — первая буква заглавная для UI.
- de/fr/it/es/pt/nl: overlay JSON (`modules/i18n/typed/catalog/chakra/*.json`, источник `chakraTypedSource.json`) через `mergeTypedLocale`; до fill — fallback на EN inline.

### 2.2 `modules/chakra/labels.ts` (legacy RU)

Экспорты из `modules/chakra/labels.ts`:

- **`chakraLabelRu(chakraNumber: number): string`** — именительный падеж (`первая чакра` … `седьмая чакра`; fallback — `` `${n} чакра` ``).
- **`chakraLabelAccusativeRu(chakraNumber: number): string`** — винительный (`первую чакру` … `седьмую чакру`).
- **`chakraLabelGenitiveRu(chakraNumber: number): string`** — родительный (`первой чакры` … `седьмой чакры`).
- **`chakraNumberFromRuLabel(label: string): number | null`** — резолв номера чакры из legacy-санскрита (`муладхара`, `сахасрара`, …) или уже нумерованной подписи; нормализация — trim + lower case.
- **`chakraDisplayLabelRu(value: string | number): string`** — видимая подпись: по числу через `chakraLabelRu`, по строке — через `chakraNumberFromRuLabel` с fallback к исходной строке.

Тесты: `modules/chakra/labels.test.ts` (vitest).

### 2.3 `_legacy_web/app/api/_utils/chakraText.ts` (server post-processing)

- **`normalizeChakraNamesInText(text, locale)`** — заменяет санскритские/transliterated имена чакр (RU/EN regex patterns) на locale-native numeric labels из inline map для всех 8 `AppContentLocale`; сохраняет начальную капитализацию совпадения.
- **`normalizeChakraNamesInFields(payload, locale, fields?)`** — применяет нормализацию к строковым полям объекта (default: `slogan`, `short_text`, `long_explanation`).
- Потребители recommendation pipeline теперь идут через **`recommendationText.ts`** (§2.4), который вызывает `normalizeChakraNamesInText` как первый шаг; прямой импорт `chakraText` из transport-слоя снят.

### 2.4 `_legacy_web/app/api/_utils/recommendationText.ts` (server recommendation post-processing)

- **`normalizeRecommendationText(text, locale)`** — chakra names + English tone keys → locale labels + §6 header без bridge wording.
- **`normalizeRecommendationFields(payload, locale, fields?)`** — применяет к строковым полям и `math_level.markdown`.
- Потребители: `ensureGlobalDailyContent`, `globalContentLocale`, `morningRecommendation.ts`, `ai/monologue/route.ts`, `services/globalContentClient.ts`, client `modules/home/sanitizeRecommendationDisplay.ts`.

## 3. Внутренняя архитектура

- Константа **`RU_CHAKRA_FORMS`** — таблица падежных форм для чакр 1–7.
- Константа **`LEGACY_RU_TO_NUMBER`** — обратный словарь санскритских и нумерованных русских подписей.
- **`normalizeLabel`** — приватная нормализация входной строки перед lookup.

Пакет не имеет barrel `index.ts`: новый код импортирует `@/modules/chakra/i18n`; `@/modules/chakra/labels` — только для legacy RU.

## 4. Конфигурация и параметры

- Внешних env и runtime-флагов нет.
- RU/EN inline в `i18n.ts`; остальные 6 локалей — typed overlay gate (`scripts/i18n-sync.mjs fill --all`).
- Клиентский `getPlanetChakraMap(locale)` (`modules/home/planetChakra.ts`) строит `shortLabel`/`chakraName` через `i18n.ts`, не из JSON. Поле `chakra_name_ru` в `planet_chakra_map.json` и inline-строки в Deno `dailyForecast.ts` / server `planetChakraLegend.ts` — legacy-дубли для сверки.

## 5. Известные ограничения

- Серверные утилиты `topPetals.ts` / `globalTransitMath.ts` по-прежнему используют `chakraLabelRu` (RU-only layer B math labels); math markdown для de–nl — нативные строки в `mathLevelI18nTargets.ts` (`getMathLevelStrings`). Visible recommendation copy additionally passes through `chakraText.ts` so Sanskrit names do not leak after LLM generation or cache serve.
- Edge `dailyForecast.ts` и server `planetChakraLegend.ts` **не** импортируют `i18n.ts` — там inline-строки или JSON `chakra_name_ru`.
- Расширение на 8+ чакр потребует правки inline maps в `i18n.ts` / `RU_CHAKRA_FORMS` и всех потребителей, завязанных на диапазон 1–7.
