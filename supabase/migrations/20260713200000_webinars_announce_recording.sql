-- Webinars announce + recording dual model:
-- • webinars: cover + i18n for announce; keep is_published = announce published
-- • posts.kind / webinar_id: recording lives as a post (kind=webinar_recording)
-- • RLS + get_posts_feed: webinar recordings only for registrants
-- • Legacy recording_url kept for transition (optional migrate into post body)

-- ── webinars announce media / i18n ──────────────────────────────────────────
alter table public.webinars
  add column if not exists cover_url text,
  add column if not exists title_i18n jsonb not null default '{}'::jsonb,
  add column if not exists description_i18n jsonb not null default '{}'::jsonb,
  add column if not exists cover_url_i18n jsonb not null default '{}'::jsonb,
  add column if not exists translations_updated_at timestamptz;

comment on column public.webinars.is_published is
  'Announce published flag (home banner + public read of announce).';
comment on column public.webinars.cover_url is
  'Announce cover (RU / default). Recording cover lives on the linked posts row.';

-- ── posts: distinguish video vs webinar recording ───────────────────────────
alter table public.posts
  add column if not exists kind text not null default 'video',
  add column if not exists webinar_id uuid references public.webinars(id) on delete set null;

alter table public.posts
  drop constraint if exists posts_kind_check;
alter table public.posts
  add constraint posts_kind_check check (kind in ('video', 'webinar_recording'));

create unique index if not exists posts_one_recording_per_webinar
  on public.posts (webinar_id)
  where kind = 'webinar_recording' and webinar_id is not null;

create index if not exists posts_webinar_id_idx on public.posts (webinar_id)
  where webinar_id is not null;

comment on column public.posts.kind is
  'video = ordinary feed post; webinar_recording = post-event recording linked to webinars.';
comment on column public.posts.webinar_id is
  'Set when kind=webinar_recording; registrants-only visibility via RLS / feed RPC.';

-- ── RLS: webinar recordings only for registrants (direct table reads) ───────
drop policy if exists posts_public_read on public.posts;
create policy posts_public_read on public.posts for select
  using (
    is_published
    and (
      kind is distinct from 'webinar_recording'
      or (
        webinar_id is not null
        and exists (
          select 1
            from public.webinar_registrations wr
           where wr.webinar_id = posts.webinar_id
             and wr.user_id = auth.uid()
        )
      )
    )
  );

-- ── Feed RPC: same registrant gate (security definer bypasses RLS) ──────────
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
       p.kind is distinct from 'webinar_recording'
       or (
         p.webinar_id is not null
         and exists (
           select 1
             from public.webinar_registrations wr
            where wr.webinar_id = p.webinar_id
              and wr.user_id = auth.uid()
         )
       )
     )
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
