-- Admin panel, этап 3 (Вебинары).
--
-- • webinars — анонсы вебинаров: дата/время, ссылка на трансляцию,
--   после проведения — ссылка на запись (просмотр записи гейтится
--   клиентом по тарифу «Мастер», webinar_community).
-- • webinar_registrations — «Пойду»: по ним админ видит список записавшихся,
--   этап 4 использует их как сегмент рассылки уведомлений.
-- • Вопросы к вебинару — существующая полиморфная таблица comments
--   (target_type='webinar'), лайк comment_likes = голос за вопрос.

create table public.webinars (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  description    text not null default '',
  starts_at      timestamptz not null,
  join_url       text,           -- ссылка на трансляцию (Zoom/YouTube/…)
  recording_url  text,           -- появляется после вебинара; клиент гейтит по тарифу
  is_published   boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index webinars_starts_idx on public.webinars (starts_at desc) where is_published;
create trigger webinars_set_updated_at
  before update on public.webinars
  for each row execute function public.set_updated_at();

create table public.webinar_registrations (
  webinar_id  uuid not null references public.webinars(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (webinar_id, user_id)
);

alter table public.webinars              enable row level security;
alter table public.webinar_registrations enable row level security;

create policy webinars_public_read on public.webinars for select
  using (is_published);
create policy webinars_admin_write on public.webinars
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy webinar_registrations_read_own on public.webinar_registrations for select
  using (user_id = auth.uid());
create policy webinar_registrations_insert_own on public.webinar_registrations for insert
  with check (user_id = auth.uid());
create policy webinar_registrations_delete_own on public.webinar_registrations for delete
  using (user_id = auth.uid());
create policy webinar_registrations_admin_all on public.webinar_registrations
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
