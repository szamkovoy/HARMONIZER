-- Comment i18n (body_i18n + source_locale) and per-user post view tracking for home card dismiss.

alter table public.comments
  add column if not exists source_locale text,
  add column if not exists body_i18n jsonb not null default '{}'::jsonb;

comment on column public.comments.source_locale is 'Locale the author wrote in (ru/en/de/…).';
comment on column public.comments.body_i18n is 'Per-locale bodies; keys are AppContentLocale codes.';

create table if not exists public.user_post_views (
  user_id   uuid not null references public.users(id) on delete cascade,
  post_id   uuid not null references public.posts(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create index if not exists user_post_views_user_viewed_idx
  on public.user_post_views (user_id, viewed_at desc);

alter table public.user_post_views enable row level security;

drop policy if exists user_post_views_self_all on public.user_post_views;
create policy user_post_views_self_all on public.user_post_views
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Return type change requires drop + recreate.
drop function if exists public.get_target_comments(text, uuid, uuid);

create function public.get_target_comments(
  p_target_type text,
  p_target_id   uuid,
  p_user_id     uuid
)
returns table (
  id             uuid,
  user_id        uuid,
  display_name   text,
  body           text,
  source_locale  text,
  body_i18n      jsonb,
  created_at     timestamptz,
  like_count     bigint,
  liked_by_me    boolean,
  is_mine        boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.user_id,
         nullif(trim(u.display_name), '') as display_name,
         c.body,
         c.source_locale,
         coalesce(c.body_i18n, '{}'::jsonb) as body_i18n,
         c.created_at,
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

grant execute on function public.get_target_comments(text, uuid, uuid) to authenticated;
