-- Personal Affirmation / Sankalpa (additive).
-- One active affirmation per user; optional private voice recording for breath playback.

create table public.user_affirmations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null check (char_length(trim(text)) > 0 and char_length(text) <= 500),
  -- Storage path in bucket affirmation-audio (not a public URL).
  audio_url text null,
  status text not null default 'active'
    check (status in ('active', 'completed', 'archived')),
  current_day int not null default 0
    check (current_day >= 0 and current_day <= 30),
  last_practiced_at timestamptz null,
  cycle_started_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index user_affirmations_one_active_per_user
  on public.user_affirmations (user_id)
  where status = 'active';

create index user_affirmations_user_created_idx
  on public.user_affirmations (user_id, created_at desc);

alter table public.user_affirmations enable row level security;

create policy user_affirmations_select_own on public.user_affirmations
  for select to authenticated
  using (user_id = auth.uid());

create policy user_affirmations_insert_own on public.user_affirmations
  for insert to authenticated
  with check (user_id = auth.uid());

create policy user_affirmations_update_own on public.user_affirmations
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy user_affirmations_delete_own on public.user_affirmations
  for delete to authenticated
  using (user_id = auth.uid());

create or replace function public.user_affirmations_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger user_affirmations_updated_at_trg
  before update on public.user_affirmations
  for each row execute function public.user_affirmations_set_updated_at();

-- Private voice recordings for affirmation playback on exhale.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'affirmation-audio',
  'affirmation-audio',
  false,
  5242880, -- 5 MB
  array['audio/mp4', 'audio/m4a', 'audio/aac', 'audio/mpeg', 'audio/x-m4a', 'audio/webm']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Path layout: {user_id}/{yyyy-mm-dd}/{uuid}.{ext}
create policy affirmation_audio_user_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'affirmation-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy affirmation_audio_user_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'affirmation-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy affirmation_audio_user_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'affirmation-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'affirmation-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy affirmation_audio_user_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'affirmation-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy affirmation_audio_admin_all on storage.objects
  for all to authenticated
  using (bucket_id = 'affirmation-audio' and public.is_admin(auth.uid()))
  with check (bucket_id = 'affirmation-audio' and public.is_admin(auth.uid()));
