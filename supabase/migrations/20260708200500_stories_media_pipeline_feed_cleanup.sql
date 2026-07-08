alter table public.stories
  add column if not exists thumbnail_url text;

comment on column public.stories.thumbnail_url is
'Tiny square thumbnail for the home avatar ring center; generated server-side for both image and video stories.';

create or replace function public.get_story_feed(p_user_id uuid)
returns table (
  id             uuid,
  kind           text,
  image_url      text,
  cover_url      text,
  thumbnail_url  text,
  video_provider text,
  video_url      text,
  caption        jsonb,
  publish_at     timestamptz,
  expires_at     timestamptz,
  is_viewed      boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.kind,
    s.image_url,
    s.cover_url,
    s.thumbnail_url,
    s.video_provider,
    s.video_url,
    s.caption,
    s.publish_at,
    s.expires_at,
    (v.story_id is not null) as is_viewed
  from public.stories s
  left join public.user_story_views v
    on v.story_id = s.id
   and v.user_id = p_user_id
  where s.is_published
    and s.publish_at <= now()
    and (s.is_evergreen or s.expires_at > now())
  order by
    s.order_hint asc,
    s.publish_at asc,
    s.created_at asc,
    s.id asc;
$$;

grant execute on function public.get_story_feed(uuid) to anon, authenticated;
