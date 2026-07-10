---
id: 02_modules/subscription/history
title: Subscription History
version: 1.5
updated: 2026-07-08
depends_on: [01_foundation/product_model, 04_reference/product/tier_model]
code_refs: [supabase/migrations/20260501193000_free_tier_global_content.sql, modules/access/core/access.tsx, modules/home/useDayContent.ts]
---

## Decision Log

- **2026-07-10:** Каталог тарифов расширен явными `PAID_PRODUCT_TIERS` / `TIER_LABELS_RU` / `isPaidProductTier` в `modules/access/core/tiers.ts` (админка и серверные сегменты больше не держат локальные копии имён). Пересчёт `users.membership_*` из леджера `payments` при add/edit и hourly cron: среди ещё действующих платежей побеждает максимальный `TIER_ORDER` (см. admin_panel / infra). Автооплата store отложена.

- **2026-07-08:** Полная 4-тировая модель дошла до БД (этап 0 admin_panel): миграция `20260708010000_admin_panel_tier_foundation.sql` расширила constraint `users.membership_tier` до `free/oracle/practitioner/master`, нормализовала `premium`→`oracle` и добавила `membership_expires_at` (истечение ручного гранта; истёкший грант = free). Дубли условия «premium ИЛИ trial» (5 мест: `access.tsx`, `useDayContent`, `globalContentClient`, `Communicator`, `userModelTier`/`global-content`) заменены единым `modules/access/core/paidAccess.ts` (+ vendored-копия для Vercel, + зеркало в Edge `precompute-daily-forecasts`). Закрыты оба open questions по subscription.

- **2026-06-16:** `UpgradeDialog` переведён на JSON-каталог i18n (`tier.*`, `upgrade.*` через `useTranslate()`); убраны хардкод RU и `TIER_LABELS` в UI модалки.

- **2026-06-07:** Добавлен feature gate `day_planning`: вкладка «День» видна на тарифах `practitioner` и `master`, скрыта для `free`/`oracle`. Это не меняет текущий SQL constraint `users.membership_tier` (`free`/`premium`) и работает через существующий effective access/dev override.
- **2026-05-16:** Feature gate `stats` стал единым входом не только для старой клиентской статистики практик, но и для новых HARMONIZER v2 reports на профиле (`life matrix`, `range trend`, `practice-by-chakra`). Изменений в матрице тарифов не потребовалось: доступ остался на текущем effective tier без расширения SQL-схемы `membership_tier`.
- **2026-05:** Введены поля `users.membership_tier` (`free`/`premium`) и `trial_expires_at` с индексами; зафиксирована семантика трёхдневного trial для free и общего контента для free tier — см. миграцию `supabase/migrations/20260501193000_free_tier_global_content.sql` и реализацию клиентского/серверного разветвления в `modules/home/useDayContent.ts`, `_legacy_web/app/api/ai/global-content/route.ts`.

- **2026-05:** Клиентский слой `modules/access` введён как единая точка для четырёх продуктовых тарифов (`ProductTier`), матрицы `TIER_FEATURES` и API `useAccess` / `canUseFeature`; `premium` из БД маппится в эффективный `oracle`, активный trial поднимает эффективный уровень до `master` для матрицы фич. Это опережает полную смену схемы БД (см. `docs/04_reference/product/tier_model.md`).

- **Не датировано (источник PATCH 14):** Рабочий документ `docs/tmp_docs/29042026/PATCH_14_free_tier.md` проектировал поле `tier` с значениями `free`/`trial`/`paid` и отдельный cron/global pipeline; фактическая схема ушла в пару `membership_tier` + `trial_expires_at` и глобальный контент без отдельного столбца `tier` в том виде, как в патче. Архивный текст: `docs/05_archive/migrated/subscription/PATCH_14_free_tier.md`.

- **2026-05-03 (бриф):** Документ `docs/planning/access_tiers_navigation_brief.md` зафиксировал навигацию, dev-переключатель и поверхности upgrade; идеи перенесены в код (`modules/access`, таб layout, профиль, главный экран). Исходник брифа архивирован: `docs/05_archive/old_briefs/access_tiers_navigation_brief.md` (копия также в `docs/tmp_docs/02052026/access_tiers_navigation_brief.md`).
