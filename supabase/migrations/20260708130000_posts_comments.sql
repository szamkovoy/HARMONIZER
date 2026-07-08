-- Admin panel, этап 2 (Публикации + комментарии).
--
-- • posts — лента публикаций автора (существующая announcements остаётся
--   нетронутой: это баннерная модель, для ленты статей не подходит,
--   см. open_questions «announcements — кандидат на депрекацию»).
-- • comments — ЕДИНАЯ полиморфная таблица для комментариев к публикациям
--   и будущих вопросов к вебинарам (target_type='webinar', этап 3);
--   FK на target нет — целостность обеспечивают серверные роуты админки.
-- • comment_likes — лайки комментариев (на вебинарах работают как
--   голосование за вопросы).
-- • Storage-бакет post-covers — обложки публикаций (public read).
-- • RPC get_posts_feed / get_target_comments — security definer выдачи
--   для клиента: имена авторов комментариев нельзя прочитать под RLS users
--   (self-select-only), а счётчики удобнее считать на сервере БД.

-- -----------------------------------------------------------------------------
-- 1. Таблицы
-- -----------------------------------------------------------------------------

create table public.posts (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  body          text not null default '',   -- plain text: переносы строк + URL; клиент линкует URL
  cover_url     text,
  is_published  boolean not null default false,
  published_at  timestamptz,
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index posts_published_idx on public.posts (published_at desc) where is_published;
create trigger posts_set_updated_at
  before update on public.posts
  for each row execute function public.set_updated_at();

create table public.comments (
  id           uuid primary key default gen_random_uuid(),
  target_type  text not null check (target_type in ('post', 'webinar')),
  target_id    uuid not null,
  user_id      uuid not null references public.users(id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 2000),
  is_hidden    boolean not null default false,
  created_at   timestamptz not null default now()
);
create index comments_target_idx on public.comments (target_type, target_id, created_at);

create table public.comment_likes (
  comment_id  uuid not null references public.comments(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (comment_id, user_id)
);

-- -----------------------------------------------------------------------------
-- 2. RLS
-- -----------------------------------------------------------------------------

alter table public.posts         enable row level security;
alter table public.comments      enable row level security;
alter table public.comment_likes enable row level security;

create policy posts_public_read on public.posts for select
  using (is_published and published_at <= now());
create policy posts_admin_write on public.posts
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- Скрытые комментарии видит только их автор (и админ через service role).
create policy comments_read on public.comments for select
  using (auth.uid() is not null and (not is_hidden or user_id = auth.uid()));
create policy comments_insert_own on public.comments for insert
  with check (user_id = auth.uid());
create policy comments_delete_own on public.comments for delete
  using (user_id = auth.uid());
create policy comments_admin_all on public.comments
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy comment_likes_read on public.comment_likes for select
  using (auth.uid() is not null);
create policy comment_likes_insert_own on public.comment_likes for insert
  with check (user_id = auth.uid());
create policy comment_likes_delete_own on public.comment_likes for delete
  using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 3. Storage: обложки публикаций
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post-covers',
  'post-covers',
  true,
  20971520, -- 20 MB
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict (id) do nothing;

create policy "post_covers_public_read" on storage.objects
  for select using (bucket_id = 'post-covers');

create policy "post_covers_admin_write" on storage.objects
  for all
  using (bucket_id = 'post-covers' and public.is_admin(auth.uid()))
  with check (bucket_id = 'post-covers' and public.is_admin(auth.uid()));

-- -----------------------------------------------------------------------------
-- 4. RPC для клиента
-- -----------------------------------------------------------------------------

-- Лента опубликованных публикаций со счётчиком видимых комментариев.
create or replace function public.get_posts_feed(p_limit int default 50)
returns table (
  id            uuid,
  title         text,
  body          text,
  cover_url     text,
  published_at  timestamptz,
  comment_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.title, p.body, p.cover_url, p.published_at,
         (select count(*) from public.comments c
           where c.target_type = 'post' and c.target_id = p.id and not c.is_hidden) as comment_count
    from public.posts p
   where p.is_published and p.published_at <= now()
   order by p.published_at desc
   limit greatest(1, least(p_limit, 100));
$$;

-- Комментарии/вопросы к цели с именами авторов, лайками и флагами текущего юзера.
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
         coalesce(nullif(trim(u.display_name), ''), 'Гость') as display_name,
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

grant execute on function public.get_posts_feed(int)                    to authenticated;
grant execute on function public.get_target_comments(text, uuid, uuid)  to authenticated;
