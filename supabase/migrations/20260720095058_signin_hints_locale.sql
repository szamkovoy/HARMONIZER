-- Side-channel locale для OTP-письма (тот же баг, что и с именем).
--
-- signInWithOtp НЕ обновляет user_metadata для существующего пользователя,
-- поэтому send-auth-email видел устаревший raw_user_meta_data.locale
-- (язык первой регистрации), а не язык текущего шага 1 мастера.
--
-- Добавляем locale в signin_name_hints; клиент пишет getResponseLocale()
-- вместе с именем; edge-функция предпочитает hint.locale.

alter table public.signin_name_hints
  add column if not exists locale text;

comment on column public.signin_name_hints.locale is
  'UI locale of the sign-in wizard at OTP request time (ru|en|de|fr|it|es|pt|nl).';

-- Заменяем 2-arg RPC на 3-arg (имя + locale).
drop function if exists public.set_signin_name_hint(text, text);

create or replace function public.set_signin_name_hint(
  p_email text,
  p_name text,
  p_locale text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(p_email));
  v_name text := btrim(p_name);
  v_locale text := lower(btrim(coalesce(p_locale, '')));
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
  if v_locale is null or v_locale = '' or v_locale !~ '^(ru|en|de|fr|it|es|pt|nl)$' then
    raise exception 'invalid locale';
  end if;

  insert into public.signin_name_hints (email, name, locale, updated_at)
  values (v_email, v_name, v_locale, now())
  on conflict (email) do update
    set name = excluded.name,
        locale = excluded.locale,
        updated_at = now();
end;
$$;

revoke all on function public.set_signin_name_hint(text, text, text) from public;
grant execute on function public.set_signin_name_hint(text, text, text) to anon, authenticated;

comment on function public.set_signin_name_hint(text, text, text) is
  'Upsert latest sign-in name + UI locale hint for OTP email (anon-callable; validated).';
