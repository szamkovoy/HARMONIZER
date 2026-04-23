-- Fix: в get_user_stories имя OUT-колонки `publish_at` пересекается со столбцом
-- stories.publish_at → PL/pgSQL не может разрешить ссылку. Квалифицируем
-- таблицу во внутренних выборках.

create or replace function public.get_user_stories(p_user_id uuid)
returns table (
  id             uuid,
  kind           text,
  image_url      text,
  cover_url      text,
  video_provider text,
  video_url      text,
  caption        jsonb,
  publish_at     timestamptz,
  expires_at     timestamptz,
  is_fresh       boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_now          timestamptz := now();
  v_last_publish timestamptz;
begin
  return query
    select s.id, s.kind, s.image_url, s.cover_url,
           s.video_provider, s.video_url, s.caption,
           s.publish_at, s.expires_at, true as is_fresh
      from public.stories s
      left join public.user_story_views v
        on v.story_id = s.id and v.user_id = p_user_id
     where s.is_published
       and v.story_id is null
       and (s.is_evergreen or s.expires_at > v_now)
       and s.publish_at <= v_now
     order by s.order_hint asc, s.publish_at asc;

  if found then
    return;
  end if;

  select max(s.publish_at) into v_last_publish
    from public.stories s
   where s.is_published and s.publish_at <= v_now;

  if v_last_publish is null or v_last_publish < v_now - interval '3 days' then
    return query
      select s.id, s.kind, s.image_url, s.cover_url,
             s.video_provider, s.video_url, s.caption,
             s.publish_at, s.expires_at, false as is_fresh
        from public.stories s
        left join public.user_story_views v
          on v.story_id = s.id and v.user_id = p_user_id
       where s.is_published
         and v.story_id is null
         and s.publish_at <= v_now
       order by s.publish_at desc
       limit 3;
  end if;
end;
$$;

grant execute on function public.get_user_stories(uuid) to anon, authenticated;
