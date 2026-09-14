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
- `precompute-daily-forecasts` — delta-only precompute M2 для активных paid-пользователей, каждые 10 минут: SQL RPC `precompute_daily_forecast_candidates` отдаёт только тех, у кого нет свежего кэша (`user_daily_forecasts` + утренний `scenario_cache`) за текущую локальную дату, и арендует их на 8 минут (`daily_precompute_claims`); инвокер вызывает Edge только при наличии кандидатов. До 40 пользователей / запуск, параллельность 4, бюджет 100 s — хвост подхватит следующий тик. Ручной прогон: `select public.invoke_precompute_daily_forecasts();` (при полном кэше вернёт `null` — HTTP не делается); полный ответ — `?verbose=true`.
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
*/10 * * * *   precompute_daily_forecasts_every_10m       → invoke_precompute_daily_forecasts (peek RPC → HTTP только при кандидатах)
15 * * * *     cleanup_expired_stories_hourly             → invoke_cleanup_expired_stories
20 * * * *     reconcile_expired_memberships_hourly       → invoke_reconcile_expired_memberships
35 * * * *     cleanup_unconfirmed_auth_users_hourly      → cleanup_unconfirmed_auth_users (OTP ghosts >1h)
37 4 * * 0     cleanup_stale_notification_deliveries_weekly → cleanup_stale_notification_deliveries(30d, 1000, 20)
* * * * *      notify_webinar_start_minutely               → invoke_notify_webinar_start
40 4 * * *     cleanup_cron_job_run_details_daily         → cleanup_cron_job_run_details (7 дней)
*/15 * * * *   ensure_harmonizer_crons_watchdog           → ensure_harmonizer_cron_jobs
```

Опционально (пока не в ensure-реестре; при необходимости — Dashboard / отдельная миграция):

```cron
0 3 * * *      auto-calibrate
0 4 * * 0      cleanup-expired-proposals
```

Для migration-based invoke jobs через `pg_cron` + `pg_net` секрет `CRON_SECRET` нужно также положить в Vault. С `20260914010000_cron_invokers_hardening.sql` все `invoke_*` берут его через `public._cron_secret(preferred)` — цепочка `precompute_global_cron_secret` → `notify_webinar_start_cron_secret` → `cleanup_expired_stories_cron_secret` → `reconcile_expired_memberships_cron_secret`, поэтому достаточно одного `precompute_global_cron_secret` (остальные — опциональные алиасы того же значения). Все инвокеры передают явный `timeout_milliseconds` (30 s Edge / 120 s Vercel); webinar/reconcile/cleanup/precompute сначала проверяют в SQL, есть ли работа, и без неё HTTP не делают. `invoke_run_email_automations` (`20260914130000`) вызывает Vercel безусловно только на тиках :00/:15/:30/:45, а между ними — при наличии due `email_automation_enrollments` (retry/шаги остаются в 5-мин SLA). Служебная таблица `net._http_response` при bloat чистится `VACUUM FULL` вручную (pg_net сам удаляет строки по TTL 6 ч, но не возвращает место).

Server-only SQL-функции (`invoke_*`, ledger/membership, OTP permits, email automations, trigger bodies) должны иметь `revoke all ... from public, anon, authenticated; grant execute ... to postgres, service_role` — Supabase выдаёт `EXECUTE` anon/authenticated по умолчанию, и `revoke from public` одного недостаточно (см. `20260914011000_function_grants_hardening.sql`).

Исторически для cleanup stories использовалось:

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

> **История миграций (2026-09-14):** remote `supabase_migrations.schema_migrations` приведена к локальным файлам через `supabase migration repair` (76 локальных версий → `applied`, 73 MCP-версии с чужими timestamps → `reverted`); `supabase db push --dry-run` → `Remote database is up to date`. Дальше применяем миграции **только** `supabase db push` (файл в `supabase/migrations/` → push). Не применять SQL через MCP `apply_migration` / SQL Editor — это снова создаёт запись с другим timestamp и ломает `db push`.

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
