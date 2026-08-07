-- OTP ghosts: delete after 1h (was 24h). Marketing: only confirmed emails in
-- email_contacts; welcome automation enrolls on onboarded_at (Harmonizer
-- registration), not bare OTP confirm.
--
-- Note: single overload cleanup_unconfirmed_auth_users(interval default '1 hour')
-- so cron `select cleanup_unconfirmed_auth_users()` stays unambiguous.

-- ---------------------------------------------------------------------------
-- A) Cleanup TTL → 1 hour (collapse zero-arg wrapper + interval overload)
-- ---------------------------------------------------------------------------
drop function if exists public.cleanup_unconfirmed_auth_users();
drop function if exists public.cleanup_unconfirmed_auth_users(interval);

create function public.cleanup_unconfirmed_auth_users(
  p_older_than interval default interval '1 hour'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_ids uuid[];
  v_deleted int := 0;
begin
  -- Strict candidate set (all must hold):
  --   • email_confirmed_at IS NULL  → never completed OTP
  --   • last_sign_in_at IS NULL     → never obtained a session
  --   • created_at older than window
  --   • not admin
  --   • no payments / payment_contracts
  --   • no onboarded_at / last_seen_at on public.users
  select coalesce(array_agg(x.id), '{}'::uuid[])
  into v_ids
  from (
    select au.id
    from auth.users au
    where au.email_confirmed_at is null
      and au.last_sign_in_at is null
      and au.created_at < now() - p_older_than
      and not exists (
        select 1 from public.user_roles ur
        where ur.user_id = au.id and ur.role = 'admin'
      )
      and not exists (
        select 1 from public.payments p where p.user_id = au.id
      )
      and not exists (
        select 1 from public.payment_contracts pc where pc.user_id = au.id
      )
      and not exists (
        select 1 from public.users u
        where u.id = au.id
          and (u.onboarded_at is not null or u.last_seen_at is not null)
      )
    limit 200
  ) x;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return jsonb_build_object(
      'deleted', 0,
      'ids', '[]'::jsonb,
      'older_than', p_older_than::text,
      'ran_at', now()
    );
  end if;

  delete from auth.users
  where id = any (v_ids)
    and email_confirmed_at is null
    and last_sign_in_at is null;

  get diagnostics v_deleted = row_count;

  return jsonb_build_object(
    'deleted', v_deleted,
    'candidate_ids', to_jsonb(v_ids),
    'older_than', p_older_than::text,
    'ran_at', now()
  );
end;
$$;

revoke all on function public.cleanup_unconfirmed_auth_users(interval) from public;
revoke all on function public.cleanup_unconfirmed_auth_users(interval) from anon;
revoke all on function public.cleanup_unconfirmed_auth_users(interval) from authenticated;
grant execute on function public.cleanup_unconfirmed_auth_users(interval) to postgres;

comment on function public.cleanup_unconfirmed_auth_users(interval) is
  'Cron: delete never-confirmed / never-signed-in auth users older than p_older_than (default 1 hour).';

-- ---------------------------------------------------------------------------
-- B) Sync marketing contacts only after OTP confirm
-- ---------------------------------------------------------------------------
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
    and au.email_confirmed_at is not null
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

-- ---------------------------------------------------------------------------
-- C) Welcome enroll candidates = onboarded (finished Harmonizer wizard)
-- ---------------------------------------------------------------------------
create or replace function public.email_automation_onboarded_users(p_since timestamptz)
returns table (
  user_id uuid,
  onboarded_at timestamptz,
  skip_email_automations boolean,
  display_name text
)
language sql
security definer
set search_path = public, auth
as $$
  select
    u.id,
    u.onboarded_at,
    coalesce(u.skip_email_automations, false),
    u.display_name
  from public.users u
  join auth.users au on au.id = u.id
  where u.onboarded_at is not null
    and au.email_confirmed_at is not null
    and (p_since is null or u.onboarded_at >= p_since);
$$;

revoke all on function public.email_automation_onboarded_users(timestamptz) from public;
grant execute on function public.email_automation_onboarded_users(timestamptz) to service_role;
grant execute on function public.email_automation_onboarded_users(timestamptz) to postgres;

-- ---------------------------------------------------------------------------
-- D) Stop welcome drips for users who never finished onboarding
-- ---------------------------------------------------------------------------
update public.email_automation_enrollments e
set status = 'cancelled',
    updated_at = now()
where e.status = 'active'
  and exists (
    select 1
    from public.email_contacts c
    join public.users u on u.id = c.user_id
    join public.email_automations a on a.id = e.automation_id
    where c.id = e.contact_id
      and a.trigger_type = 'account_registered'
      and u.onboarded_at is null
  );

-- Unconfirmed auth users must not stay in marketing contacts as active app links.
update public.email_contacts c
set user_id = null,
    updated_at = now()
where c.user_id is not null
  and exists (
    select 1
    from auth.users au
    where au.id = c.user_id
      and au.email_confirmed_at is null
  );
