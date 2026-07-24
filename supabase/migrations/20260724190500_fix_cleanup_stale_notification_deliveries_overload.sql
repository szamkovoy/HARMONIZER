-- Fix: zero-arg + defaulted 3-arg overloads made
-- `select cleanup_stale_notification_deliveries()` ambiguous for pg_cron.
-- Keep a single function; cron passes explicit args.

drop function if exists public.cleanup_stale_notification_deliveries();

create or replace function public.cleanup_stale_notification_deliveries(
  p_older_than interval default interval '30 days',
  p_batch_limit int default 1000,
  p_max_batches int default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_limit int := greatest(1, least(coalesce(p_batch_limit, 1000), 5000));
  v_max_batches int := greatest(1, least(coalesce(p_max_batches, 20), 100));
  v_batch int := 0;
  v_deleted_batch int;
  v_deleted_total int := 0;
begin
  perform set_config('lock_timeout', '2s', true);
  perform set_config('statement_timeout', '45s', true);

  loop
    exit when v_batch >= v_max_batches;

    with doomed as (
      select d.notification_id, d.user_id
      from public.notification_deliveries d
      where d.created_at < now() - p_older_than
      order by d.created_at asc
      limit v_batch_limit
      for update skip locked
    )
    delete from public.notification_deliveries d
    using doomed
    where d.notification_id = doomed.notification_id
      and d.user_id = doomed.user_id;

    get diagnostics v_deleted_batch = row_count;
    v_deleted_total := v_deleted_total + v_deleted_batch;
    v_batch := v_batch + 1;

    exit when v_deleted_batch = 0;
    exit when v_deleted_batch < v_batch_limit;

    perform pg_sleep(0.25);
  end loop;

  return jsonb_build_object(
    'deleted', v_deleted_total,
    'batches', v_batch,
    'older_than', p_older_than::text,
    'batch_limit', v_batch_limit,
    'max_batches', v_max_batches,
    'ran_at', now()
  );
end;
$$;

revoke all on function public.cleanup_stale_notification_deliveries(interval, int, int) from public;
revoke all on function public.cleanup_stale_notification_deliveries(interval, int, int) from anon;
revoke all on function public.cleanup_stale_notification_deliveries(interval, int, int) from authenticated;
grant execute on function public.cleanup_stale_notification_deliveries(interval, int, int) to postgres;

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
