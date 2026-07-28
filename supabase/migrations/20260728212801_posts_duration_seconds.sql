-- Shared video duration (seconds) for posts; shown on cover like YouTube.

alter table public.posts
  add column if not exists duration_seconds integer
  check (duration_seconds is null or duration_seconds >= 0);

comment on column public.posts.duration_seconds is
  'Video length in seconds (locale-agnostic); null = unknown / not set.';

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
  webinar_id      uuid,
  duration_seconds integer
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
         p.webinar_id,
         p.duration_seconds
    from public.posts p
   where p.is_published
     and p.published_at <= now()
     and (
       p_locale is null
       or (
         p_locale = 'ru'
         and nullif(btrim(p.title), '') is not null
       )
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
