---
id: 02_modules/subscription/history
title: Subscription History
version: 1.7
updated: 2026-07-15
depends_on: [01_foundation/product_model, 04_reference/product/tier_model]
code_refs: [supabase/migrations/20260501193000_free_tier_global_content.sql, modules/access/core/access.tsx, modules/home/useDayContent.ts]
---

## Decision Log

- **2026-07-15 (payments):** Подключён Lava.top (MONTHLY-подписки «Наставник»/«Мастер»). Тариф теперь назначается вебхуком (`payment_contracts` + `users.membership_*`, 30 дней + 48ч грейс на ретраи списания). Политика апгрейда A3: новый уровень немедленно, старая подписка отменяется сервером без пересчёта остатка; даунгрейд = отмена (доступ до конца периода) + новая подписка. Валюта цен по геолокации приложения: RU→RUB, US→USD, иначе EUR (осознанный региональный прайсинг: «Мастер» 99 USD/EUR против 4950 ₽). Детали — `account_web/*`.

- **2026-07-15:** Follow-up по Consumption-Only. Каталог практик (медитации/дыхание/асаны) теперь **browsable для всех уровней** — гейт срабатывает только на «Начать практику»/«Открыть на ТВ»/«Открыть на телефоне», по kind: `meditations`/`breath_practices`/`asana_practices` (раньше гейт срабатывал уже при переключении группы). Панель `AccountUpsellPanel` и баннер `UpcomingWebinarBanner` приведены к кеглю `sectionTitle` (18px) regular; chevron панели — тот же `›` что у баннера, повёрнут на 90° (вниз закрыто / вверх открыто). На экран «Профиль» в карточку доступа добавлена кнопка «Личный кабинет» (kill-switch `account_links_enabled`). В «Окнах возможностей» точный аспект теперь показывает подписи `(транзит)`/`(натал)` за каждой планетой (8 локалей, включая help-попап; исправлен источник transit-планеты в help — берётся `exactAspect.transitPlanet`, а не graph-планета).

- **2026-07-14:** Переход на Consumption-Only (внешние платежи на zamkovoi.yoga). Новая продуктовая модель из трёх видимых уровней: `free`→«Навигатор», `oracle`→«Наставник» (+`assistant_dialog`, `day_planning`, `stats` — переехали с practitioner), `master`→«Мастер» (все практики + вебинары); `practitioner` — скрытый legacy-алиас oracle (`VISIBLE_PRODUCT_TIERS`, DB не меняли). Trial сокращён до **1 суток** уровня «Мастер» (`20260714210000_trial_one_day.sql`, триггер также пишет `locale`). `UpgradeDialog` заменён комплаенс-компонентами `AccountGateDialog` / `AccountUpsellPanel` (тексты `gate.*`, кнопка «Личный кабинет» с kill-switch `app_config.account_links_enabled`); `FreeTierBanner` и ключи `upgrade.*` удалены. Таб «Практики» виден всем — гейт на «Начать практику». Подхват смены уровня — модуль `account_web`.

- **2026-07-10:** Каталог тарифов расширен явными `PAID_PRODUCT_TIERS` / `TIER_LABELS_RU` / `isPaidProductTier` в `modules/access/core/tiers.ts` (админка и серверные сегменты больше не держат локальные копии имён). Пересчёт `users.membership_*` из леджера `payments` при add/edit и hourly cron: среди ещё действующих платежей побеждает максимальный `TIER_ORDER` (см. admin_panel / infra). Автооплата store отложена.

- **2026-07-08:** Полная 4-тировая модель дошла до БД (этап 0 admin_panel): миграция `20260708010000_admin_panel_tier_foundation.sql` расширила constraint `users.membership_tier` до `free/oracle/practitioner/master`, нормализовала `premium`→`oracle` и добавила `membership_expires_at` (истечение ручного гранта; истёкший грант = free). Дубли условия «premium ИЛИ trial» (5 мест: `access.tsx`, `useDayContent`, `globalContentClient`, `Communicator`, `userModelTier`/`global-content`) заменены единым `modules/access/core/paidAccess.ts` (+ vendored-копия для Vercel, + зеркало в Edge `precompute-daily-forecasts`). Закрыты оба open questions по subscription.

- **2026-06-16:** `UpgradeDialog` переведён на JSON-каталог i18n (`tier.*`, `upgrade.*` через `useTranslate()`); убраны хардкод RU и `TIER_LABELS` в UI модалки.

- **2026-06-07:** Добавлен feature gate `day_planning`: вкладка «День» видна на тарифах `practitioner` и `master`, скрыта для `free`/`oracle`. Это не меняет текущий SQL constraint `users.membership_tier` (`free`/`premium`) и работает через существующий effective access/dev override.
- **2026-05-16:** Feature gate `stats` стал единым входом не только для старой клиентской статистики практик, но и для новых HARMONIZER v2 reports на профиле (`life matrix`, `range trend`, `practice-by-chakra`). Изменений в матрице тарифов не потребовалось: доступ остался на текущем effective tier без расширения SQL-схемы `membership_tier`.
- **2026-05:** Введены поля `users.membership_tier` (`free`/`premium`) и `trial_expires_at` с индексами; зафиксирована семантика трёхдневного trial для free и общего контента для free tier — см. миграцию `supabase/migrations/20260501193000_free_tier_global_content.sql` и реализацию клиентского/серверного разветвления в `modules/home/useDayContent.ts`, `_legacy_web/app/api/ai/global-content/route.ts`.

- **2026-05:** Клиентский слой `modules/access` введён как единая точка для четырёх продуктовых тарифов (`ProductTier`), матрицы `TIER_FEATURES` и API `useAccess` / `canUseFeature`; `premium` из БД маппится в эффективный `oracle`, активный trial поднимает эффективный уровень до `master` для матрицы фич. Это опережает полную смену схемы БД (см. `docs/04_reference/product/tier_model.md`).

- **Не датировано (источник PATCH 14):** Рабочий документ `docs/tmp_docs/29042026/PATCH_14_free_tier.md` проектировал поле `tier` с значениями `free`/`trial`/`paid` и отдельный cron/global pipeline; фактическая схема ушла в пару `membership_tier` + `trial_expires_at` и глобальный контент без отдельного столбца `tier` в том виде, как в патче. Архивный текст: `docs/05_archive/migrated/subscription/PATCH_14_free_tier.md`.

- **2026-05-03 (бриф):** Документ `docs/planning/access_tiers_navigation_brief.md` зафиксировал навигацию, dev-переключатель и поверхности upgrade; идеи перенесены в код (`modules/access`, таб layout, профиль, главный экран). Исходник брифа архивирован: `docs/05_archive/old_briefs/access_tiers_navigation_brief.md` (копия также в `docs/tmp_docs/02052026/access_tiers_navigation_brief.md`).
