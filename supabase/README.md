# Supabase (схема и миграции)

Папка хранит SQL-описания БД проекта HARMONIZER в Supabase.

## Структура

- `config.toml` — локальная конфигурация Supabase CLI (не коммитить чувствительные поля).
- `migrations/` — версионируемые миграции схемы. Каждая — timestamped `.sql` файл.
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

# прогнать seed (идемпотентно)
supabase db execute --file supabase/seed.sql
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
