-- При удалении аккаунта платежные записи должны оставаться для отчётов
-- (суммы, даты, продукты). Сейчас user_id → users ON DELETE CASCADE
-- уничтожал payment_contracts и payments вместе с пользователем.
--
-- Меняем FK на ON DELETE SET NULL + nullable user_id.
-- Перед deleteUser сервер дополнительно пишет buyer_email (снимок email),
-- чтобы отчёты не теряли покупателя после удаления auth.users.

-- 1) payment_contracts
alter table public.payment_contracts
  add column if not exists buyer_email text;

alter table public.payment_contracts
  alter column user_id drop not null;

alter table public.payment_contracts
  drop constraint if exists payment_contracts_user_id_fkey;

alter table public.payment_contracts
  add constraint payment_contracts_user_id_fkey
  foreign key (user_id) references public.users(id) on delete set null;

comment on column public.payment_contracts.buyer_email is
'Snapshot of buyer email at checkout or account-delete time; survives user wipe for payment reports.';

-- 2) payments (admin ledger)
alter table public.payments
  add column if not exists buyer_email text;

alter table public.payments
  alter column user_id drop not null;

alter table public.payments
  drop constraint if exists payments_user_id_fkey;

alter table public.payments
  add constraint payments_user_id_fkey
  foreign key (user_id) references public.users(id) on delete set null;

comment on column public.payments.buyer_email is
'Snapshot of buyer email; survives user wipe for payment reports.';
