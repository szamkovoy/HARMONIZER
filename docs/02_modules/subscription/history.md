---
id: 02_modules/subscription/history
title: Subscription History
version: 1.1
updated: 2026-05-07
depends_on: [01_foundation/product_model, 04_reference/product/tier_model]
code_refs: [supabase/migrations/20260501193000_free_tier_global_content.sql, modules/access/core/access.tsx, modules/home/useDayContent.ts]
---

## Decision Log

- **2026-05:** Введены поля `users.membership_tier` (`free`/`premium`) и `trial_expires_at` с индексами; зафиксирована семантика трёхдневного trial для free и общего контента для free tier — см. миграцию `supabase/migrations/20260501193000_free_tier_global_content.sql` и реализацию клиентского/серверного разветвления в `modules/home/useDayContent.ts`, `_legacy_web/app/api/ai/global-content/route.ts`.

- **2026-05:** Клиентский слой `modules/access` введён как единая точка для четырёх продуктовых тарифов (`ProductTier`), матрицы `TIER_FEATURES` и API `useAccess` / `canUseFeature`; `premium` из БД маппится в эффективный `oracle`, активный trial поднимает эффективный уровень до `master` для матрицы фич. Это опережает полную смену схемы БД (см. `docs/04_reference/product/tier_model.md`).

- **Не датировано (источник PATCH 14):** Рабочий документ `docs/tmp_docs/29042026/PATCH_14_free_tier.md` проектировал поле `tier` с значениями `free`/`trial`/`paid` и отдельный cron/global pipeline; фактическая схема ушла в пару `membership_tier` + `trial_expires_at` и глобальный контент без отдельного столбца `tier` в том виде, как в патче. Архивный текст: `docs/05_archive/migrated/subscription/PATCH_14_free_tier.md`.

- **2026-05-03 (бриф):** Документ `docs/planning/access_tiers_navigation_brief.md` зафиксировал навигацию, dev-переключатель и поверхности upgrade; идеи перенесены в код (`modules/access`, таб layout, профиль, главный экран). Исходник брифа архивирован: `docs/05_archive/old_briefs/access_tiers_navigation_brief.md` (копия также в `docs/tmp_docs/02052026/access_tiers_navigation_brief.md`).
