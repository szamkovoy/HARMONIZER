-- Фикс i18n: get_target_comments возвращал русский фолбэк 'Гость' на уровне SQL,
-- что утекло бы во все 8 локалей клиента. Имя автора теперь nullable —
-- локализованный фолбэк делает клиент (ключ posts.comments.anonymous).

create or replace function public.get_target_comments(
  p_target_type text,
  p_target_id   uuid,
  p_user_id     uuid
)
returns table (
  id           uuid,
  user_id      uuid,
  display_name text,
  body         text,
  created_at   timestamptz,
  like_count   bigint,
  liked_by_me  boolean,
  is_mine      boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.user_id,
         nullif(trim(u.display_name), '') as display_name,
         c.body, c.created_at,
         (select count(*) from public.comment_likes l where l.comment_id = c.id) as like_count,
         exists(select 1 from public.comment_likes l
                 where l.comment_id = c.id and l.user_id = p_user_id) as liked_by_me,
         c.user_id = p_user_id as is_mine
    from public.comments c
    left join public.users u on u.id = c.user_id
   where c.target_type = p_target_type
     and c.target_id = p_target_id
     and (not c.is_hidden or c.user_id = p_user_id)
   order by c.created_at asc;
$$;
