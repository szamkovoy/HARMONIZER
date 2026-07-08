-- Редактирование записей леджера платежей из админки.
alter table public.payments
  add column if not exists edited_at timestamptz;

comment on column public.payments.edited_at is
'Когда админ последний раз правил строку вручную (null = не редактировалась после создания).';

-- Активные пользователи за последние N часов (скользящее окно, не календарные сутки).
create or replace function public.admin_active_users_count(p_hours int)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct user_id)
  from public.user_event_log
  where occurred_at > now() - make_interval(hours => greatest(p_hours, 1));
$$;

revoke execute on function public.admin_active_users_count(int) from public;
revoke execute on function public.admin_active_users_count(int) from anon;
revoke execute on function public.admin_active_users_count(int) from authenticated;
