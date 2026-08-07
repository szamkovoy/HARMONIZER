# Supabase (схема и миграции)

Папка хранит SQL-описания БД проекта HARMONIZER в Supabase.

## Структура

- `config.toml` — локальная конфигурация Supabase CLI (не коммитить чувствительные поля).
- `migrations/` — версионируемые миграции схемы. Каждая — timestamped `.sql` файл.
- `functions/` — Edge Functions для cron-автоматизации.
- `seed.sql` — справочники и идемпотентный стартовый контент (чакры, каталог практик).

## Что в схеме

`20260423080000_init.sql` — базовая модель приложения:

| Домен | Таблицы |
| --- | --- |
| Профиль | `users`, `user_settings`, `user_roles` |
| Каталог | `chakras`, `practices`, `practice_chakras` |
| История практик | `practice_sessions`, `user_daily_stats` (триггер) |
| LLM-контекст | `conversations`, `messages`, `conversation_summaries`, `user_profile_memory` |
| Астрология | `astro_events_global`, `daily_forecasts` |
| Геомагнитка | `kp_forecast` |
| Окна возможностей | `event_reminders`, `push_tokens` |
| Stories | `stories`, `user_story_views` + RPC `get_user_stories` |
| Баннер-объявления | `announcements`, `user_announcement_views` + RPC `get_user_announcement` |
| Активность | `health_daily` |
| Event log | `user_event_log` |

RLS включена на всех таблицах. User-scoped таблицы доступны только владельцу
(`user_id = auth.uid()`). Каталоги и глобальные прогнозы — публичный select,
запись только для `service_role` / `admin` (через `user_roles`).

## Накат изменений

Требования: Supabase CLI v2+, `.env.local` в корне проекта с
`SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY`.

```bash
# один раз — привязка локального репо к облачному проекту
supabase link --project-ref "$SUPABASE_PROJECT_REF" -p "$SUPABASE_DB_PASSWORD"

# накатить все новые миграции
supabase db push

# синхронизировать Storage config (на Free tier global limit остаётся 50 MiB — это нормально)
supabase config push --yes

# прогнать seed (идемпотентно)
supabase db execute --file supabase/seed.sql
```

## Edge Functions / Cron

Фаза 7 Orchestrator architecture:

- `auto-calibrate` — ежедневный анализ диалогов и мягкое предложение обновить калибровку.
- `precompute-daily-forecasts` — ежечасный precompute M2 для активных пользователей в их локальную полночь.
- `precompute-global-recommendations` — precompute глобального free-прогноза с rolling window `yesterday/today/tomorrow`.
- `cleanup-expired-proposals` — еженедельная очистка `ai_state_proposals`.
- `cleanup-expired-stories` — регулярная очистка истёкших stories + их файлов в `story-media`.
- `reconcile-expired-memberships` — hourly пересчёт `users.membership_*` из леджера `payments`, когда срок оплаты истёк (без автооплаты store).
- `notify-webinar-start` — minutely: авто-пуш + inbox для записавшихся в момент `starts_at`.

Секреты: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, опционально `CRON_SECRET`, для LLM-анализа `GEMINI_API_KEY`.

**Bundling:** Edge Functions деплоятся только с кодом под `supabase/functions/` (включая `_shared/`). Импорты из `modules/` или `_legacy_web/` на remote bundler не резолвятся — дублируйте нужные контракты в `_shared/` (см. `contentLengths.ts`, `mathLevelI18n*.ts`, `dailyForecast.ts`).

Канон расписаний — SQL/`pg_cron`, не Dashboard Scheduled Functions. Реестр и self-heal: `public.ensure_harmonizer_cron_jobs()` (миграция `20260721010000_ensure_harmonizer_cron_watchdog.sql`). Watchdog `ensure_harmonizer_crons_watchdog` (`*/15 * * * *`) пересоздаёт missing/inactive jobs; free/paid invokers тоже вызывают ensure перед HTTP POST. Проверка: `select public.ensure_harmonizer_cron_jobs();` → `ok: true`, `repaired: []`.

```cron
0 * * * *      precompute_global_recommendations_hourly   → invoke_precompute_global_recommendations
0 * * * *      precompute_daily_forecasts_hourly          → invoke_precompute_daily_forecasts
15 * * * *     cleanup_expired_stories_hourly             → invoke_cleanup_expired_stories
20 * * * *     reconcile_expired_memberships_hourly       → invoke_reconcile_expired_memberships
35 * * * *     cleanup_unconfirmed_auth_users_hourly      → cleanup_unconfirmed_auth_users (OTP ghosts >1h)
37 4 * * 0     cleanup_stale_notification_deliveries_weekly → cleanup_stale_notification_deliveries(30d, 1000, 20)
* * * * *      notify_webinar_start_minutely               → invoke_notify_webinar_start
*/15 * * * *   ensure_harmonizer_crons_watchdog           → ensure_harmonizer_cron_jobs
```

Опционально (пока не в ensure-реестре; при необходимости — Dashboard / отдельная миграция):

```cron
0 3 * * *      auto-calibrate
0 4 * * 0      cleanup-expired-proposals
```

Для migration-based invoke jobs через `pg_cron` + `pg_net` секрет `CRON_SECRET` нужно также положить в Vault под ожидаемым именем. Free/paid precompute используют Vault `precompute_global_cron_secret`. Для cleanup stories это:

```sql
select vault.create_secret(
  '<same value as CRON_SECRET for the Edge Function>',
  'cleanup_expired_stories_cron_secret',
  'x-cron-secret header for cleanup-expired-stories'
);
```

Для reconcile memberships:

```sql
select vault.create_secret(
  '<same value as CRON_SECRET for the Edge Function>',
  'reconcile_expired_memberships_cron_secret',
  'x-cron-secret header for reconcile-expired-memberships'
);
```

## Как добавлять новые миграции

Никогда не правим существующие файлы — создаём новую миграцию:

```bash
supabase migration new add_something
# отредактировать созданный файл в migrations/
supabase db push
```

## Как назначить себе роль admin

Зарегистрируйтесь в приложении, затем в Supabase Studio → SQL Editor:

```sql
insert into public.user_roles (user_id, role)
values ('<your-uuid-from-auth.users>', 'admin')
on conflict do nothing;
```

После этого вам станут доступны write-политики на `practices`, `stories`,
`announcements`.
