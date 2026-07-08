-- Admin panel, этап 5 (Поддержка / обратная связь).

create table public.support_messages (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  body          text not null check (char_length(body) between 1 and 4000),
  created_at    timestamptz not null default now(),
  processed_at  timestamptz                -- null = не обработано владельцем
);
create index support_messages_inbox_idx on public.support_messages (created_at desc);

alter table public.support_messages enable row level security;

create policy support_messages_insert_own on public.support_messages for insert
  with check (user_id = auth.uid());
create policy support_messages_read_own on public.support_messages for select
  using (user_id = auth.uid());
create policy support_messages_admin_all on public.support_messages
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
