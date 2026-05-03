-- ============================================================================
-- Remote Play: TV pairing sessions
-- ============================================================================

create table if not exists public.tv_sessions (
  id           uuid primary key default gen_random_uuid(),
  pairing_code text not null unique check (pairing_code ~ '^[A-Z0-9]{4}$'),
  vimeo_id     text,
  status       text not null default 'waiting'
    check (status in ('waiting', 'playing', 'paused', 'stopped', 'closed')),
  user_id      uuid references auth.users(id) on delete set null,
  expires_at   timestamptz not null default (now() + interval '2 hours'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (expires_at > created_at)
);

create index if not exists tv_sessions_pairing_active_idx
  on public.tv_sessions (pairing_code, expires_at desc)
  where status <> 'closed';

create index if not exists tv_sessions_user_active_idx
  on public.tv_sessions (user_id, expires_at desc)
  where user_id is not null and status <> 'closed';

drop trigger if exists tv_sessions_set_updated_at on public.tv_sessions;
create trigger tv_sessions_set_updated_at
  before update on public.tv_sessions
  for each row execute function public.set_updated_at();

create or replace function public.protect_tv_session_anon_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- WordPress TV page is anonymous. It may only close its session on tab close;
  -- playback state changes come from the authenticated mobile user.
  if auth.role() = 'anon' then
    if new.status <> 'closed'
       or new.id is distinct from old.id
       or new.pairing_code is distinct from old.pairing_code
       or new.vimeo_id is distinct from old.vimeo_id
       or new.user_id is distinct from old.user_id
       or new.expires_at is distinct from old.expires_at
       or new.created_at is distinct from old.created_at then
      raise exception 'Anonymous TV clients may only close tv_sessions';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tv_sessions_protect_anon_update on public.tv_sessions;
create trigger tv_sessions_protect_anon_update
  before update on public.tv_sessions
  for each row execute function public.protect_tv_session_anon_update();

alter table public.tv_sessions enable row level security;

drop policy if exists tv_sessions_select_public on public.tv_sessions;
create policy tv_sessions_select_public on public.tv_sessions
  for select
  using (true);

drop policy if exists tv_sessions_insert_public_waiting on public.tv_sessions;
create policy tv_sessions_insert_public_waiting on public.tv_sessions
  for insert
  with check (
    user_id is null
    and vimeo_id is null
    and status = 'waiting'
    and expires_at <= now() + interval '2 hours' + interval '5 minutes'
  );

drop policy if exists tv_sessions_update_authenticated_owner on public.tv_sessions;
create policy tv_sessions_update_authenticated_owner on public.tv_sessions
  for update
  using (
    auth.role() = 'authenticated'
    and expires_at > now()
    and status <> 'closed'
    and (user_id is null or user_id = auth.uid())
  )
  with check (
    auth.role() = 'authenticated'
    and expires_at > now()
    and user_id = auth.uid()
    and status in ('waiting', 'playing', 'paused', 'stopped')
  );

drop policy if exists tv_sessions_close_anon on public.tv_sessions;
create policy tv_sessions_close_anon on public.tv_sessions
  for update
  using (
    auth.role() = 'anon'
    and expires_at > now()
    and status <> 'closed'
  )
  with check (
    auth.role() = 'anon'
    and status = 'closed'
  );

drop policy if exists tv_sessions_delete_unclaimed_public on public.tv_sessions;
create policy tv_sessions_delete_unclaimed_public on public.tv_sessions
  for delete
  using (user_id is null);

alter table public.tv_sessions replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tv_sessions'
  ) then
    alter publication supabase_realtime add table public.tv_sessions;
  end if;
end;
$$;

comment on table public.tv_sessions is
  'Remote Play pairing sessions for WordPress TV page and Expo controller. Realtime must also be enabled in Supabase Dashboard if publication changes are not reflected automatically.';
