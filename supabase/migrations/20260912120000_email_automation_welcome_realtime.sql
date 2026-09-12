-- Welcome automations: fire on first onboarded_at (not hourly full-sync),
-- pg_net timeout 120s, catch-up every 5 minutes. Deactivate = pause.

-- ---------------------------------------------------------------------------
-- A) Upsert one marketing contact (no full-table sync)
-- ---------------------------------------------------------------------------
create or replace function public.sync_email_contact_for_user(p_user_id uuid)
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
  where u.id = p_user_id
    and au.email is not null
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
  return jsonb_build_object('upserted', v_upserted, 'user_id', p_user_id, 'ran_at', now());
end;
$$;

revoke all on function public.sync_email_contact_for_user(uuid) from public;
grant execute on function public.sync_email_contact_for_user(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- B) Welcome candidates since activation (optional single user)
-- ---------------------------------------------------------------------------
create or replace function public.email_automation_welcome_candidates(
  p_automation_id uuid,
  p_since timestamptz,
  p_user_id uuid default null
)
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
    and (p_since is null or u.onboarded_at >= p_since)
    and (p_user_id is null or u.id = p_user_id)
    and not exists (
      select 1
      from public.email_contacts c
      join public.email_automation_enrollments e
        on e.contact_id = c.id
       and e.automation_id = p_automation_id
      where c.user_id = u.id
        and (
          e.status = 'active'
          or e.cycle_key = u.onboarded_at::text
        )
    );
$$;

revoke all on function public.email_automation_welcome_candidates(uuid, timestamptz, uuid) from public;
grant execute on function public.email_automation_welcome_candidates(uuid, timestamptz, uuid) to service_role;
grant execute on function public.email_automation_welcome_candidates(uuid, timestamptz, uuid) to postgres;

-- ---------------------------------------------------------------------------
-- C) Invoke Vercel with 120s timeout (welcome one-user + catch-up)
-- ---------------------------------------------------------------------------
create or replace function public.invoke_run_email_automations()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, extensions
as $function$
declare
  v_secret text;
  v_url constant text := 'https://harmonizer-ten.vercel.app/api/cron/email-automations';
  v_id bigint;
begin
  select ds.decrypted_secret
    into v_secret
  from vault.decrypted_secrets ds
  where ds.name in (
    'precompute_global_cron_secret',
    'notify_webinar_start_cron_secret',
    'cleanup_expired_stories_cron_secret'
  )
  order by case ds.name
    when 'precompute_global_cron_secret' then 0
    when 'notify_webinar_start_cron_secret' then 1
    else 2
  end
  limit 1;

  if v_secret is null then
    raise warning 'Vault cron secret missing; skipping email-automations invoke';
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

create or replace function public.invoke_email_welcome_for_user(p_user_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, extensions
as $function$
declare
  v_secret text;
  v_url constant text := 'https://harmonizer-ten.vercel.app/api/cron/email-welcome';
  v_id bigint;
begin
  if p_user_id is null then
    return null;
  end if;

  select ds.decrypted_secret
    into v_secret
  from vault.decrypted_secrets ds
  where ds.name in (
    'precompute_global_cron_secret',
    'notify_webinar_start_cron_secret',
    'cleanup_expired_stories_cron_secret'
  )
  order by case ds.name
    when 'precompute_global_cron_secret' then 0
    when 'notify_webinar_start_cron_secret' then 1
    else 2
  end
  limit 1;

  if v_secret is null then
    raise warning 'Vault cron secret missing; skipping email-welcome invoke';
    return null;
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := jsonb_build_object('user_id', p_user_id),
    timeout_milliseconds := 120000
  )
    into v_id;

  return v_id;
end;
$function$;

revoke all on function public.invoke_email_welcome_for_user(uuid) from public;
grant execute on function public.invoke_email_welcome_for_user(uuid) to postgres;
grant execute on function public.invoke_email_welcome_for_user(uuid) to service_role;

create or replace function public.trg_users_onboarded_email_welcome()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.onboarded_at is null then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' and OLD.onboarded_at is not null then
    return NEW;
  end if;
  perform public.invoke_email_welcome_for_user(NEW.id);
  return NEW;
end;
$$;

drop trigger if exists trg_users_onboarded_email_welcome on public.users;
create trigger trg_users_onboarded_email_welcome
  after insert or update of onboarded_at on public.users
  for each row
  execute function public.trg_users_onboarded_email_welcome();

-- ---------------------------------------------------------------------------
-- D) Catch-up every 5 minutes (rename hourly job)
-- ---------------------------------------------------------------------------
do $$
declare
  stale record;
begin
  for stale in
    select jobid
    from cron.job
    where jobname in ('run_email_automations_hourly', 'run_email_automations_every_5m')
  loop
    perform cron.unschedule(stale.jobid);
  end loop;
end
$$;

create or replace function public.ensure_harmonizer_cron_jobs()
returns jsonb
language plpgsql
security definer
set search_path = public, cron, extensions
as $function$
declare
  repaired text[] := '{}';
  missing_invokers text[] := '{}';
  req record;
  stale record;
  invoker_name text;
  schedule_ok boolean;
begin
  for req in
    select *
    from (
      values
        (
          'precompute_global_recommendations_hourly',
          '0 * * * *',
          'select public.invoke_precompute_global_recommendations();',
          'invoke_precompute_global_recommendations'
        ),
        (
          'precompute_daily_forecasts_hourly',
          '0 * * * *',
          'select public.invoke_precompute_daily_forecasts();',
          'invoke_precompute_daily_forecasts'
        ),
        (
          'cleanup_expired_stories_hourly',
          '15 * * * *',
          'select public.invoke_cleanup_expired_stories();',
          'invoke_cleanup_expired_stories'
        ),
        (
          'reconcile_expired_memberships_hourly',
          '20 * * * *',
          'select public.invoke_reconcile_expired_memberships();',
          'invoke_reconcile_expired_memberships'
        ),
        (
          'cleanup_unconfirmed_auth_users_hourly',
          '35 * * * *',
          'select public.cleanup_unconfirmed_auth_users();',
          'cleanup_unconfirmed_auth_users'
        ),
        (
          'cleanup_stale_notification_deliveries_weekly',
          '37 4 * * 0',
          $cmd$select public.cleanup_stale_notification_deliveries(interval '30 days', 1000, 20);$cmd$,
          'cleanup_stale_notification_deliveries'
        ),
        (
          'notify_webinar_start_minutely',
          '* * * * *',
          'select public.invoke_notify_webinar_start();',
          'invoke_notify_webinar_start'
        ),
        (
          'run_email_automations_every_5m',
          '*/5 * * * *',
          'select public.invoke_run_email_automations();',
          'invoke_run_email_automations'
        ),
        (
          'sync_email_suppressions_daily',
          '20 5 * * *',
          'select public.invoke_sync_email_suppressions();',
          'invoke_sync_email_suppressions'
        ),
        (
          'run_yookassa_renewals_daily',
          '15 3 * * *',
          'select public.invoke_run_yookassa_renewals();',
          'invoke_run_yookassa_renewals'
        ),
        (
          'cleanup_daily_dialog_archives_hourly',
          '50 * * * *',
          'select public.cleanup_daily_dialog_archives();',
          'cleanup_daily_dialog_archives'
        ),
        (
          'ensure_harmonizer_crons_watchdog',
          '*/15 * * * *',
          'select public.ensure_harmonizer_cron_jobs();',
          'ensure_harmonizer_cron_jobs'
        )
    ) as t(jobname, schedule, command, invoker)
  loop
    invoker_name := req.invoker;

    if not exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = invoker_name
    ) then
      missing_invokers := array_append(missing_invokers, req.jobname);
      raise warning '[ensure_harmonizer_cron_jobs] invoker missing for % (%)',
        req.jobname, invoker_name;
      continue;
    end if;

    select exists (
      select 1
      from cron.job cj
      where cj.jobname = req.jobname
        and cj.schedule = req.schedule
        and btrim(cj.command) = btrim(req.command)
        and cj.active
    )
      into schedule_ok;

    if schedule_ok then
      continue;
    end if;

    for stale in
      select cj.jobid
      from cron.job cj
      where cj.jobname = req.jobname
    loop
      perform cron.unschedule(stale.jobid);
    end loop;

    perform cron.schedule(req.jobname, req.schedule, req.command);
    repaired := array_append(repaired, req.jobname);
    raise warning '[ensure_harmonizer_cron_jobs] repaired schedule % (%)',
      req.jobname, req.schedule;
  end loop;

  return jsonb_build_object(
    'ok', coalesce(array_length(missing_invokers, 1), 0) = 0,
    'repaired', to_jsonb(coalesce(repaired, '{}'::text[])),
    'missing_invokers', to_jsonb(coalesce(missing_invokers, '{}'::text[])),
    'checked_at', now()
  );
end;
$function$;

select public.ensure_harmonizer_cron_jobs();
