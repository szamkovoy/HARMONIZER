-- Admin panel, этап 4 (Уведомления).
--
-- • push_tokens НЕ создаём — таблица есть с init-миграции (id pk, token unique,
--   is_active, expo_token, last_seen_at; RLS push_tokens_self). Клиент начинает
--   писать в неё именно с этого этапа.
-- • notifications — рассылки админа: текст + опциональная ссылка + сегмент.
-- • notification_deliveries — факт доставки конкретному пользователю;
--   это же — источник списка «Мои уведомления» в Профиле (гарантированная
--   доставка даже при выключенных push-разрешениях) и флаг read_at.

create table public.notifications (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  body              text not null default '',
  link_url          text,
  segment           text not null,        -- 'all' | 'tier:<tier>' | 'webinar:<uuid>'
  segment_label     text not null,        -- человекочитаемо для истории в админке
  recipient_count   int not null default 0,
  push_sent_count   int not null default 0,
  push_error_count  int not null default 0,
  created_at        timestamptz not null default now(),
  sent_at           timestamptz
);

create table public.notification_deliveries (
  notification_id  uuid not null references public.notifications(id) on delete cascade,
  user_id          uuid not null references public.users(id) on delete cascade,
  read_at          timestamptz,
  created_at       timestamptz not null default now(),
  primary key (notification_id, user_id)
);
create index notification_deliveries_user_idx on public.notification_deliveries (user_id, created_at desc);

alter table public.notifications            enable row level security;
alter table public.notification_deliveries  enable row level security;

-- Пользователь видит уведомление, только если оно ему доставлено.
create policy notifications_recipient_read on public.notifications for select
  using (
    exists (
      select 1 from public.notification_deliveries d
       where d.notification_id = id and d.user_id = auth.uid()
    )
  );
create policy notifications_admin_all on public.notifications
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy notification_deliveries_read_own on public.notification_deliveries for select
  using (user_id = auth.uid());
-- Отметка «прочитано» — единственное, что пользователь меняет в своей строке.
create policy notification_deliveries_update_own on public.notification_deliveries for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy notification_deliveries_admin_all on public.notification_deliveries
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
