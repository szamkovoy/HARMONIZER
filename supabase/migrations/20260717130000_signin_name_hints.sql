-- Side-channel для приветствия в OTP-письме.
--
-- Проблема: signInWithOtp НЕ обновляет user_metadata для существующего
-- пользователя (только при создании). Поэтому edge-функция send-auth-email
-- видит устаревший raw_user_meta_data.full_name, а не имя, которое пользователь
-- только что ввёл на шаге 1 мастера.
--
-- Решение: клиент перед signInWithOtp пишет свежее имя в эту таблицу (по email);
-- edge-функция читает его по user.email (service-role, обходит RLS) и использует
-- для приветствия, с fallback на user_metadata.full_name. Таблица эфемерная,
-- хранит только последнюю подсказку по email.

create table if not exists public.signin_name_hints (
  email text primary key,
  name text not null,
  updated_at timestamptz not null default now()
);

alter table public.signin_name_hints enable row level security;
-- RLS: нет политик → прямой доступ anon/authenticated запрещён.
-- Запись идёт только через RPC set_signin_name_hint (security definer).

create or replace function public.set_signin_name_hint(
  p_email text,
  p_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(p_email));
  v_name text := btrim(p_name);
begin
  if v_email is null or v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid email';
  end if;
  if v_name is null or v_name = '' then
    raise exception 'name required';
  end if;
  if length(v_name) > 100 then
    raise exception 'name too long';
  end if;

  insert into public.signin_name_hints (email, name, updated_at)
  values (v_email, v_name, now())
  on conflict (email) do update
    set name = excluded.name,
        updated_at = now();
end;
$$;

revoke all on function public.set_signin_name_hint(text, text) from public;
grant execute on function public.set_signin_name_hint(text, text) to anon, authenticated;

comment on table public.signin_name_hints is
  'Ephemeral hint of the name the user just typed on the sign-in screen; consumed by the send-auth-email edge function for the OTP email greeting.';
comment on function public.set_signin_name_hint(text, text) is
  'Upsert the latest sign-in name hint for an email (anon-callable; validated).';
