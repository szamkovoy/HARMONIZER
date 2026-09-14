-- Ops hardening for pg_cron → pg_net invokers (2026-09-14 health audit).
--
-- 1) notify-webinar-start ran every minute against PostgREST even when no webinar
--    was due (1440 HTTP round-trips/day, ~40% of them failing on gateway 504).
--    The SQL invoker now checks `webinars` itself and only calls the Edge Function
--    when there is something to notify (same window as the function: -15m..+30s).
-- 2) pg_net default timeout is 5000 ms — shorter than an Edge Function cold start,
--    so `net._http_response` was full of `timed_out=true` rows. Every invoker now
--    passes an explicit `timeout_milliseconds` (30 s edge, 120 s Vercel crons).
-- 3) invoke_reconcile_expired_memberships looked up a Vault secret that was never
--    created and silently returned null every hour; the SQL functions
--    `reconcile_expired_memberships` / `recompute_user_membership` from
--    20260710023000 were not present on the remote either. Recreate the batch
--    function on top of the canonical `restore_membership_from_ledger` (payments +
--    payment_contracts), use the shared secret fallback chain, and mirror the
--    existing CRON_SECRET into the expected Vault name if it is missing.

-- ---------------------------------------------------------------------------
-- A) Shared secret resolution (same chain as invoke_run_email_automations)
-- ---------------------------------------------------------------------------
create or replace function public._cron_secret(p_preferred text default null)
returns text
language sql
stable
security definer
set search_path = public, vault
as $$
  select ds.decrypted_secret
  from vault.decrypted_secrets ds
  where ds.name in (
    coalesce(p_preferred, 'precompute_global_cron_secret'),
    'precompute_global_cron_secret',
    'notify_webinar_start_cron_secret',
    'cleanup_expired_stories_cron_secret',
    'reconcile_expired_memberships_cron_secret'
  )
  order by case
    when ds.name = coalesce(p_preferred, 'precompute_global_cron_secret') then 0
    when ds.name = 'precompute_global_cron_secret' then 1
    else 2
  end
  limit 1;
$$;

revoke all on function public._cron_secret(text) from public, anon, authenticated;
grant execute on function public._cron_secret(text) to postgres, service_role;

-- Mirror the shared CRON_SECRET into the Vault name documented in supabase/README.md.
do $$
declare
  v_value text;
begin
  if not exists (select 1 from vault.secrets where name = 'reconcile_expired_memberships_cron_secret') then
    select decrypted_secret into v_value
    from vault.decrypted_secrets
    where name = 'precompute_global_cron_secret'
    limit 1;
    if v_value is not null then
      perform vault.create_secret(
        v_value,
        'reconcile_expired_memberships_cron_secret',
        'x-cron-secret header for reconcile-expired-memberships'
      );
    end if;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- B) reconcile_expired_memberships(p_limit) on top of restore_membership_from_ledger
-- ---------------------------------------------------------------------------
create or replace function public.reconcile_expired_memberships(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select u.id
    from public.users u
    where u.membership_tier in ('oracle', 'practitioner', 'master')
      and u.membership_expires_at is not null
      and u.membership_expires_at <= now()
    order by u.membership_expires_at asc
    limit greatest(coalesce(p_limit, 100), 1)
  loop
    perform public.restore_membership_from_ledger(r.id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

comment on function public.reconcile_expired_memberships(integer) is
  'Batch-recomputes users.membership_* (via restore_membership_from_ledger) for users whose membership_expires_at has passed.';

revoke all on function public.reconcile_expired_memberships(integer) from public, anon, authenticated;
grant execute on function public.reconcile_expired_memberships(integer) to postgres, service_role;

-- ---------------------------------------------------------------------------
-- C) Invokers: explicit pg_net timeouts, shared secret chain, webinar pre-check
-- ---------------------------------------------------------------------------
create or replace function public.invoke_notify_webinar_start()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, extensions
as $function$
declare
  v_secret text;
  v_url constant text := 'https://vsdmphhczmcgfrvbwodp.supabase.co/functions/v1/notify-webinar-start';
  v_id bigint;
begin
  -- Same due-window as supabase/functions/notify-webinar-start (CATCH_UP 15m, LOOKAHEAD 30s).
  if not exists (
    select 1
    from public.webinars w
    where w.is_published
      and w.start_notified_at is null
      and w.join_url is not null
      and btrim(w.join_url) <> ''
      and w.starts_at >= now() - interval '15 minutes'
      and w.starts_at <= now() + interval '30 seconds'
  ) then
    return null;
  end if;

  v_secret := public._cron_secret('notify_webinar_start_cron_secret');
  if v_secret is null then
    raise warning 'Vault cron secret missing; skipping notify-webinar-start invoke';
    return null;
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
    into v_id;

  return v_id;
end;
$function$;

create or replace function public.invoke_reconcile_expired_memberships()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, extensions
as $function$
declare
  v_secret text;
  v_url constant text := 'https://vsdmphhczmcgfrvbwodp.supabase.co/functions/v1/reconcile-expired-memberships';
  v_id bigint;
begin
  -- Nothing expired → no HTTP round-trip.
  if not exists (
    select 1
    from public.users u
    where u.membership_tier in ('oracle', 'practitioner', 'master')
      and u.membership_expires_at is not null
      and u.membership_expires_at <= now()
  ) then
    return null;
  end if;

  v_secret := public._cron_secret('reconcile_expired_memberships_cron_secret');
  if v_secret is null then
    raise warning 'Vault cron secret missing; skipping reconcile-expired-memberships invoke';
    return null;
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
    into v_id;

  return v_id;
end;
$function$;

create or replace function public.invoke_cleanup_expired_stories()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, extensions
as $function$
declare
  v_secret text;
  v_url constant text := 'https://vsdmphhczmcgfrvbwodp.supabase.co/functions/v1/cleanup-expired-stories';
  v_id bigint;
begin
  if not exists (
    select 1
    from public.stories s
    where s.is_published
      and not s.is_evergreen
      and s.expires_at < now()
  ) then
    return null;
  end if;

  v_secret := public._cron_secret('cleanup_expired_stories_cron_secret');
  if v_secret is null then
    raise warning 'Vault cron secret missing; skipping cleanup-expired-stories invoke';
    return null;
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
    into v_id;

  return v_id;
end;
$function$;

create or replace function public.invoke_precompute_daily_forecasts()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, extensions
as $function$
declare
  v_secret text;
  v_url constant text := 'https://vsdmphhczmcgfrvbwodp.supabase.co/functions/v1/precompute-daily-forecasts';
  v_id bigint;
begin
  v_secret := public._cron_secret('precompute_global_cron_secret');
  if v_secret is null then
    raise warning 'Vault cron secret missing; skipping precompute-daily-forecasts invoke';
    return null;
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
    into v_id;

  return v_id;
end;
$function$;

create or replace function public.invoke_precompute_global_recommendations()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, extensions
as $function$
declare
  v_secret text;
  v_url constant text := 'https://vsdmphhczmcgfrvbwodp.supabase.co/functions/v1/precompute-global-recommendations';
  v_id bigint;
begin
  v_secret := public._cron_secret('precompute_global_cron_secret');
  if v_secret is null then
    raise warning 'Vault cron secret missing; skipping precompute-global-recommendations invoke';
    return null;
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
    into v_id;

  return v_id;
end;
$function$;

create or replace function public.invoke_run_yookassa_renewals()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, extensions
as $function$
declare
  v_secret text;
  v_url constant text := 'https://harmonizer-ten.vercel.app/api/cron/yookassa-renewals';
  v_id bigint;
begin
  v_secret := public._cron_secret('precompute_global_cron_secret');
  if v_secret is null then
    raise warning 'Vault cron secret missing; skipping yookassa-renewals invoke';
    return null;
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  )
    into v_id;

  return v_id;
end;
$function$;

create or replace function public.invoke_sync_email_suppressions()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, extensions
as $function$
declare
  v_secret text;
  v_url constant text := 'https://harmonizer-ten.vercel.app/api/cron/email-suppressions-sync';
  v_id bigint;
begin
  v_secret := public._cron_secret('precompute_global_cron_secret');
  if v_secret is null then
    raise warning 'Vault cron secret missing; skipping email-suppressions-sync invoke';
    return null;
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  )
    into v_id;

  return v_id;
end;
$function$;

-- Grants for every pg_net invoker: cron (postgres) + service_role only.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'invoke_notify_webinar_start',
    'invoke_reconcile_expired_memberships',
    'invoke_cleanup_expired_stories',
    'invoke_precompute_daily_forecasts',
    'invoke_precompute_global_recommendations',
    'invoke_run_email_automations',
    'invoke_run_yookassa_renewals',
    'invoke_sync_email_suppressions'
  ]
  loop
    execute format('revoke all on function public.%I() from public, anon, authenticated', fn);
    execute format('grant execute on function public.%I() to postgres, service_role', fn);
  end loop;
end
$$;

revoke all on function public.invoke_email_welcome_for_user(uuid) from public, anon, authenticated;
grant execute on function public.invoke_email_welcome_for_user(uuid) to postgres, service_role;

select public.ensure_harmonizer_cron_jobs();
