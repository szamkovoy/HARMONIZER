---
id: 03_rules/change_protocol
title: Change Protocol Rules
version: 1.0
updated: 2026-05-07
depends_on: [00_index/MAP, 02_modules/subscription/spec]
code_refs: [docs/_proposal.md]
---

## Черновик `03_rules/change_protocol.md`

Ниже не идея, а рабочий черновик будущего файла.

### 1. Починка бага в конкретном экране

Чек-лист:

1. Найти экран и сопоставить его с модулем в `00_index/MAP.md`.
2. Открыть `02_modules/<module>/dependencies.md` и проверить:
   - от каких модулей экран получает данные;
   - какие gates/feature flags на него влияют;
   - есть ли серверные зависимости.
3. Исправить код в минимальном домене, не разнося логику по соседним модулям.
4. Проверить смежные entry points того же модуля.
5. Если изменился контракт данных или переходов:
   - обновить `spec.md`;
   - обновить `dependencies.md`;
   - добавить запись в `history.md`.
6. Если это bugfix подписки, AI или кэширования:
   - дополнительно проверить `subscription/`, `assistant/` или `astro/`.
7. Перед завершением обновить `00_index/CHANGELOG.md`.

### 2. Добавление новой дыхательной практики

Чек-лист:

1. Начать с `02_modules/practices/spec.md` (дыхательный подсценарий, §3–4): описать новый паттерн, цель, входные параметры, ограничения.
2. Проверить `02_modules/biofeedback/dependencies.md`: нужна ли синхронизация по пульсу, какие метрики обязательны.
3. Проверить `02_modules/audio/dependencies.md`: нужен ли новый звуковой слой или новая схема микса.
4. Проверить `02_modules/bindu/dependencies.md`: нужен ли отдельный визуальный preset или достаточно существующего.
5. Обновить каталог и launch-логику в `practices`.
6. Если практика доступна не всем тарифам, обновить `subscription/spec.md` и `subscription/dependencies.md`.
7. Если практика меняет итоговый отчёт или метрики завершения, обновить `practices/spec.md` и при необходимости `practices/history.md`.
8. Если это экспериментальная практика, зафиксировать это в `practices/history.md` и `04_workspace/research.md`.

### 3. Изменение логики access control / тарифов

Чек-лист:

1. Начать только с `02_modules/subscription/spec.md`.
2. Обновить источник истины по кодовым правилам доступа.
3. Открыть `02_modules/subscription/dependencies.md` и пройти по всем перечисленным точкам проверки.
4. Проверить минимум:
   - `app/(tabs)/_layout.tsx`;
   - `app/(tabs)/index.tsx`;
   - `app/(tabs)/profile.tsx`;
   - `modules/practices/ui/PracticeCatalogScreen.tsx`;
   - `app/asana-practice.tsx`.
5. Если меняется продуктовый смысл тарифа, обновить `01_foundation/product_model.md`.
6. Если меняются upgrade surfaces, обновить `profile/spec.md`, `daily_forecast/spec.md` или `practices/spec.md`.
7. Добавить запись в `subscription/history.md` с причиной изменения и affected modules.

### 4. Добавление нового движка визуализации

Чек-лист:

1. Сначала решить: это расширение `bindu` или отдельная исследовательская линия.
2. Если движок должен войти в runtime:
   - документировать его в `02_modules/bindu/spec.md`;
   - детали эксперимента класть в `02_modules/bindu/evolution_lab.md`;
   - зависимости описывать в `02_modules/bindu/dependencies.md`.
3. Если движок пока исследовательский:
   - гипотезу сначала писать в `04_workspace/research.md`;
   - после решения о внедрении переносить в `bindu/`.
4. Проверить интеграцию с медитацией и дыханием в `02_modules/practices/spec.md` (и связанными экранами в `modules/mandala`, `modules/breath`).
5. Если движок требует нового sound/biofeedback coupling, обновить `audio/` и `biofeedback/`.
6. Если движок происходит из Lotus/CA-ветки, архивную связь отметить в `bindu/history.md`, но не возвращать Lotus в активную архитектуру.

### 5. Изменение логики astro

Чек-лист:

1. Начать с `02_modules/astro/spec.md`.
2. Сразу определить, что меняется:
   - расчёт;
   - кэширование;
   - интерпретационные слои;
   - контракты выдачи.
3. Если меняется кэширование, обновить `astro/caching_strategy.md` и проверить все forecast consumers.
4. Если меняются уровни объяснения, обновить `astro/interpretation_layers.md` и `daily_forecast/spec.md`.
5. Проверить серверные входы:
   - `_legacy_web/app/api/astro/*`;
   - `supabase/functions/daily-forecast/index.ts`.
6. Проверить клиентские входы:
   - `modules/home/useDayContent.ts`;
   - `app/(tabs)/index.tsx`;
   - assistant, если он опирается на дневной прогноз.
7. Добавить запись в `astro/history.md` с указанием affected cache semantics и downstream modules.
