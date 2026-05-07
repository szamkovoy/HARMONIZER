---
id: 02_modules/author_presence/spec
title: Author Presence Spec
version: 1.1
updated: 2026-05-07
depends_on: [02_modules/subscription/spec, 02_modules/infra/spec]
code_refs:
  [
    supabase/migrations/20260423080000_init.sql,
    services/supabase-types.ts,
    services/communicator-client.ts,
  ]
---

## 1. Назначение (продукт)

Присутствие автора в продукте: персональные обращения, баннеры, сторис, возможно видео. Тарифные границы в брифах требуют сверки с актуальной матрицей (`docs/05_archive/old_briefs/access_tiers_navigation_brief.md` и копия в `docs/05_archive/migrated/practices/`).

## 2. Статус в коде

**Отдельного модуля и `FeatureKey` нет:** в `modules/access/core/features.ts` нет ключа уровня «author / stories / announcements».

**Инфраструктура БД (без клиента):** в `20260423080000_init.sql` — таблицы **`stories`**, **`announcements`**, **`health_daily`**, представления просмотров, RPC **`get_user_stories`**, **`get_user_announcement`**. Типы отражены в **`services/supabase-types.ts`**. В Expo-приложении вызовов этих RPC не найдено.

**Смежное, не модуль:** значение **`"stories"`** в типе **`DialogueEntrySource`** (`services/communicator-client.ts`, серверные greeting/dialog) — контекст входа в диалог, не UI сторис.

## 3. Ожидаемые точки входа (когда появится реализация)

Главный экран / отдельный раздел, подписка на `stories` и баннеры, при необходимости отдельный `FeatureKey` в `subscription`.

## Справочные материалы

- `docs/04_reference/product/tier_model.md`; `docs/05_archive/old_briefs/access_tiers_navigation_brief.md`.
