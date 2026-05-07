---
id: 02_modules/author_presence/dependencies
title: Author Presence Dependencies
version: 1.1
updated: 2026-05-07
depends_on: [02_modules/subscription/spec, 02_modules/infra/spec]
code_refs: [supabase/migrations/20260423080000_init.sql]
---

## 1. Зависит от (план)

- **`subscription`** — будущие флаги доступа к контенту автора (сейчас не выделены в `FeatureKey`).
- **`infra`** — Supabase RLS и RPC для `stories` / `announcements`; при появлении контента — Vercel API при необходимости.

## 2. От него зависят

Пока **нет** потребителей в коде. В `MAP.md` у `subscription` и `infra` указаны как плановые.

## 3. Контрактные точки риска

Изменение схемы **`stories`** / **`announcements`** без миграции клиента; путаница между **`DialogueEntrySource: "stories"`** и продуктовым модулем сторис.
