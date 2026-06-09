---
id: 02_modules/chakra/spec
title: Chakra Spec
version: 1.0
updated: 2026-06-09
depends_on: [01_foundation/product_model]
code_refs: [modules/chakra/labels.ts, modules/chakra/labels.test.ts]
---

## 1. Назначение

`chakra` — общий клиентско-серверный слой для **русских подписей чакр** в видимом UI и серверных текстах. Модуль не рендерит UI и не владеет маппингом планета→чакра: он даёт единые формы слова «чакра» (именительный / винительный / родительный падеж) и нормализацию legacy-санскритских подписей в нумерованную форму (`первая чакра` … `седьмая чакра`).

## 2. Публичный контракт

Экспорты из `modules/chakra/labels.ts`:

- **`chakraLabelRu(chakraNumber: number): string`** — именительный падеж (`первая чакра` … `седьмая чакра`; fallback — `` `${n} чакра` ``).
- **`chakraLabelAccusativeRu(chakraNumber: number): string`** — винительный (`первую чакру` … `седьмую чакру`).
- **`chakraLabelGenitiveRu(chakraNumber: number): string`** — родительный (`первой чакры` … `седьмой чакры`).
- **`chakraNumberFromRuLabel(label: string): number | null`** — резолв номера чакры из legacy-санскрита (`муладхара`, `сахасрара`, …) или уже нумерованной подписи; нормализация — trim + lower case.
- **`chakraDisplayLabelRu(value: string | number): string`** — видимая подпись: по числу через `chakraLabelRu`, по строке — через `chakraNumberFromRuLabel` с fallback к исходной строке.

Тесты: `modules/chakra/labels.test.ts` (vitest).

## 3. Внутренняя архитектура

- Константа **`RU_CHAKRA_FORMS`** — таблица падежных форм для чакр 1–7.
- Константа **`LEGACY_RU_TO_NUMBER`** — обратный словарь санскритских и нумерованных русских подписей.
- **`normalizeLabel`** — приватная нормализация входной строки перед lookup.

Пакет не имеет barrel `index.ts`: соседние модули импортируют `@/modules/chakra/labels` напрямую.

## 4. Конфигурация и параметры

- Внешних env и runtime-флагов нет.
- Канонические строки зашиты в `labels.ts`; дублирующие копии в `planet_chakra_map.json` и `supabase/functions/_shared/dailyForecast.ts` пока существуют параллельно и должны оставаться согласованными по смыслу с `chakraLabelRu`.

## 5. Известные ограничения

- Только русская локаль; EN home (`modules/home/i18n/home.ts`) по-прежнему формирует `Chakra N` без этого модуля.
- Edge `dailyForecast.ts` и server `planetChakraLegend.ts` **не** импортируют `labels.ts` — там inline-строки или JSON `chakra_name_ru`.
- Расширение на 8+ чакр потребует правки `RU_CHAKRA_FORMS` и всех потребителей, завязанных на диапазон 1–7.
