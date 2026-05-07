---
id: 02_modules/webinars/spec
title: Webinars Spec
version: 1.1
updated: 2026-05-07
depends_on: [02_modules/subscription/spec]
code_refs:
  [
    modules/access/core/features.ts,
    modules/access/ui/UpgradeDialog.tsx,
    supabase/migrations/20260423080000_init.sql,
  ]
---

## 1. Назначение (продукт)

Еженедельные вебинары и групповая обратная связь от автора; в брифах тарифов — уровень **Master** и отдельная зона community (см. `docs/05_archive/old_briefs/access_tiers_navigation_brief.md`).

## 2. Статус в коде

**Модуля нет:** нет экранов, маршрутов и вызовов `canUseFeature("webinar_community")` в приложении.

**Частичный задел:**

- `FeatureKey` **`webinar_community`** только у тарифа `master` и подпись в **`UpgradeDialog`** (`modules/access/core/features.ts`, `modules/access/ui/UpgradeDialog.tsx`).
- В **`public.announcements`** поле **`kind`** допускает значение `'webinar'` вместе с `'video'`, `'note'`, `'custom'`; есть RPC **`get_user_announcement`** (`supabase/migrations/20260423080000_init.sql`). Клиент Expo эти сущности не вызывает.

## 3. Ожидаемые точки входа (когда появится реализация)

Таб в навигации или deep link под Master, сервисы поверх Supabase/Vercel, гейт через `canUseFeature("webinar_community")` и при необходимости отдельные API-маршруты в `_legacy_web/app/api/`.

## Справочные материалы

- `docs/04_reference/product/tier_model.md`; архивный бриф навигации по тарифам — `docs/05_archive/old_briefs/access_tiers_navigation_brief.md`.
