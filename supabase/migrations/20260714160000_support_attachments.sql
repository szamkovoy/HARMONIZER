-- Support screenshots: private bucket + attachment rows (max 3 per message).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'support-attachments',
  'support-attachments',
  false,
  3145728, -- 3 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Path layout: {user_id}/{yyyy-mm-dd}/{uuid}.{ext}
create policy support_attachments_user_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'support-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy support_attachments_user_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'support-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy support_attachments_admin_all on storage.objects
  for all to authenticated
  using (bucket_id = 'support-attachments' and public.is_admin(auth.uid()))
  with check (bucket_id = 'support-attachments' and public.is_admin(auth.uid()));

create table public.support_message_attachments (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references public.support_messages(id) on delete cascade,
  storage_path text not null,
  mime_type    text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes   int not null check (size_bytes > 0 and size_bytes <= 3145728),
  sort_order   smallint not null default 0 check (sort_order between 0 and 2),
  created_at   timestamptz not null default now(),
  unique (message_id, sort_order),
  unique (storage_path)
);

create index support_message_attachments_message_idx
  on public.support_message_attachments (message_id);

alter table public.support_message_attachments enable row level security;

create policy support_message_attachments_read_own on public.support_message_attachments
  for select using (
    exists (
      select 1 from public.support_messages m
      where m.id = message_id and m.user_id = auth.uid()
    )
  );

create policy support_message_attachments_insert_own on public.support_message_attachments
  for insert with check (
    exists (
      select 1 from public.support_messages m
      where m.id = message_id and m.user_id = auth.uid()
    )
  );

create policy support_message_attachments_admin_all on public.support_message_attachments
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- Cap at 3 attachments per message (defense in depth vs client).
create or replace function public.support_attachments_enforce_max()
returns trigger
language plpgsql
as $$
declare
  n int;
begin
  select count(*) into n
  from public.support_message_attachments
  where message_id = new.message_id;
  if n >= 3 then
    raise exception 'support message already has 3 attachments';
  end if;
  return new;
end;
$$;

create trigger support_attachments_max_trg
  before insert on public.support_message_attachments
  for each row execute function public.support_attachments_enforce_max();
