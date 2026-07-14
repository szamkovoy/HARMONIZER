-- Notifications i18n (title_i18n / body_i18n) + feed locale fallback preferred→en→ru.
-- Keeps kind/webinar_id from 20260714003000.

alter table public.notifications
  add column if not exists title_i18n jsonb not null default '{}'::jsonb,
  add column if not exists body_i18n jsonb not null default '{}'::jsonb;

comment on column public.notifications.title_i18n is
  'Non-RU titles: locale → text. RU stays in title.';
comment on column public.notifications.body_i18n is
  'Non-RU bodies: locale → text. RU stays in body.';

-- Feed: include post when preferred locale, EN, or RU title exists.
drop function if exists public.get_posts_feed(int, text, timestamptz, uuid);

create function public.get_posts_feed(
  p_limit int default 10,
  p_locale text default null,
  p_before_published_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id              uuid,
  title           text,
  body            text,
  cover_url       text,
  title_i18n      jsonb,
  body_i18n       jsonb,
  cover_url_i18n  jsonb,
  published_at    timestamptz,
  comment_count   bigint,
  kind            text,
  webinar_id      uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
         p.title,
         p.body,
         p.cover_url,
         p.title_i18n,
         p.body_i18n,
         p.cover_url_i18n,
         p.published_at,
         (select count(*) from public.comments c
           where c.target_type = 'post' and c.target_id = p.id and not c.is_hidden) as comment_count,
         p.kind,
         p.webinar_id
    from public.posts p
   where p.is_published
     and p.published_at <= now()
     and (
       p_locale is null
       or nullif(btrim(p.title), '') is not null
       or nullif(btrim(coalesce(p.title_i18n ->> 'en', '')), '') is not null
       or (
         p_locale is distinct from 'ru'
         and nullif(btrim(coalesce(p.title_i18n ->> p_locale, '')), '') is not null
       )
     )
     and (
       p_before_published_at is null
       or p.published_at < p_before_published_at
       or (
         p.published_at = p_before_published_at
         and p_before_id is not null
         and p.id < p_before_id
       )
     )
   order by p.published_at desc, p.id desc
   limit greatest(1, least(coalesce(p_limit, 10), 30));
$$;

grant execute on function public.get_posts_feed(int, text, timestamptz, uuid) to authenticated;
