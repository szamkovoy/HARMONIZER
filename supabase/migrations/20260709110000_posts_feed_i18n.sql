-- Extend get_posts_feed so the mobile client can resolve post translations locally.
-- Postgres requires DROP before changing RETURNS TABLE shape.

drop function if exists public.get_posts_feed(int);

create function public.get_posts_feed(p_limit int default 50)
returns table (
  id              uuid,
  title           text,
  body            text,
  cover_url       text,
  title_i18n      jsonb,
  body_i18n       jsonb,
  cover_url_i18n  jsonb,
  published_at    timestamptz,
  comment_count   bigint
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
           where c.target_type = 'post' and c.target_id = p.id and not c.is_hidden) as comment_count
    from public.posts p
   where p.is_published and p.published_at <= now()
   order by p.published_at desc
   limit greatest(1, least(p_limit, 100));
$$;

grant execute on function public.get_posts_feed(int) to authenticated;
