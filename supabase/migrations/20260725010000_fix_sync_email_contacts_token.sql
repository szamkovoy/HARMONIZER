-- Fix sync_email_contacts_from_users: gen_random_bytes needs pgcrypto.
create extension if not exists pgcrypto with schema extensions;

create or replace function public.sync_email_contacts_from_users()
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_upserted int := 0;
begin
  insert into public.email_contacts (
    email, email_normalized, user_id, source, locale, country_code,
    marketing_status, unsubscribe_token, updated_at
  )
  select
    trim(au.email),
    lower(trim(au.email)),
    u.id,
    'app',
    coalesce(nullif(trim(u.locale), ''), 'ru'),
    u.country_code,
    'active',
    encode(extensions.gen_random_bytes(24), 'hex'),
    now()
  from auth.users au
  join public.users u on u.id = au.id
  where au.email is not null
    and trim(au.email) <> ''
  on conflict (email_normalized) do update
    set
      email = excluded.email,
      user_id = coalesce(email_contacts.user_id, excluded.user_id),
      locale = case
        when email_contacts.user_id is not null or excluded.user_id is not null
          then coalesce(nullif(trim(excluded.locale), ''), email_contacts.locale)
        else email_contacts.locale
      end,
      country_code = coalesce(excluded.country_code, email_contacts.country_code),
      source = case
        when email_contacts.source = 'imported' and excluded.user_id is not null then 'app'
        else email_contacts.source
      end,
      updated_at = now();

  get diagnostics v_upserted = row_count;
  return jsonb_build_object('upserted', v_upserted, 'ran_at', now());
end;
$$;

revoke all on function public.sync_email_contacts_from_users() from public;
grant execute on function public.sync_email_contacts_from_users() to service_role;
