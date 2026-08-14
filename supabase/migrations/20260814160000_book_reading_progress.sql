-- Book reading progress (Phase B). Additive; RLS own rows only.

create table public.book_reading_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id text not null,
  locale text not null
    check (locale in ('ru', 'en', 'de', 'fr', 'it', 'es', 'pt', 'nl')),
  locator text not null check (char_length(trim(locator)) > 0),
  percent numeric(5, 2) null
    check (percent is null or (percent >= 0 and percent <= 100)),
  chapter_label text null,
  snippet text null,
  href text null,
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id, locale)
);

create index book_reading_progress_user_updated_idx
  on public.book_reading_progress (user_id, updated_at desc);

alter table public.book_reading_progress enable row level security;

create policy book_reading_progress_select_own on public.book_reading_progress
  for select to authenticated
  using (user_id = auth.uid());

create policy book_reading_progress_insert_own on public.book_reading_progress
  for insert to authenticated
  with check (user_id = auth.uid());

create policy book_reading_progress_update_own on public.book_reading_progress
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy book_reading_progress_delete_own on public.book_reading_progress
  for delete to authenticated
  using (user_id = auth.uid());
