-- QA journal for daily dialog (assistant/admin). Isolated from lean storage:
-- messages.content stays empty; Communicator GET/POST/SSE unchanged.
-- Retention: 7 days by server now(); hourly pg_cron prune.

create table public.daily_dialog_archives (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  entry_source text,
  day_tab_mode text,
  locale text,
  algo_version text,
  outcome text not null default 'open'
    check (outcome in (
      'open',
      'completed',
      'practice_handoff',
      'superseded',
      'interrupted',
      'error'
    )),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  turns jsonb not null default '[]'::jsonb,
  last_branch text,
  last_turn_mode text,
  last_should_close boolean,
  review_status text not null default 'unreviewed'
    check (review_status in ('unreviewed', 'reviewed_ok', 'issue', 'fixed')),
  reviewed_at timestamptz,
  review_note text,
  unique (conversation_id)
);

create index daily_dialog_archives_user_started_idx
  on public.daily_dialog_archives (user_id, started_at desc);
create index daily_dialog_archives_started_idx
  on public.daily_dialog_archives (started_at);
create index daily_dialog_archives_review_idx
  on public.daily_dialog_archives (review_status, started_at desc);

comment on table public.daily_dialog_archives is
  '7-day daily-dialog QA journal for admin + algorithm review. Not consumed by the mobile client.';

alter table public.daily_dialog_archives enable row level security;

revoke all on table public.daily_dialog_archives from public;
revoke all on table public.daily_dialog_archives from anon;
revoke all on table public.daily_dialog_archives from authenticated;
grant all on table public.daily_dialog_archives to service_role;

-- Atomic header upsert + turn append. Service role only.
create or replace function public.append_daily_dialog_archive(
  p_user_id uuid,
  p_conversation_id uuid,
  p_entry_source text,
  p_day_tab_mode text,
  p_locale text,
  p_algo_version text,
  p_turns jsonb,
  p_outcome text,
  p_last_branch text,
  p_last_turn_mode text,
  p_last_should_close boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_turns jsonb := coalesce(p_turns, '[]'::jsonb);
  v_outcome text := coalesce(nullif(btrim(p_outcome), ''), 'open');
begin
  if v_turns is not null and jsonb_typeof(v_turns) <> 'array' then
    v_turns := '[]'::jsonb;
  end if;
  if v_outcome not in ('open', 'completed', 'practice_handoff', 'superseded', 'interrupted', 'error') then
    v_outcome := 'open';
  end if;

  insert into public.daily_dialog_archives (
    user_id,
    conversation_id,
    entry_source,
    day_tab_mode,
    locale,
    algo_version,
    outcome,
    turns,
    last_branch,
    last_turn_mode,
    last_should_close,
    closed_at
  )
  values (
    p_user_id,
    p_conversation_id,
    nullif(btrim(p_entry_source), ''),
    nullif(btrim(p_day_tab_mode), ''),
    nullif(btrim(p_locale), ''),
    nullif(btrim(p_algo_version), ''),
    v_outcome,
    v_turns,
    nullif(btrim(p_last_branch), ''),
    nullif(btrim(p_last_turn_mode), ''),
    p_last_should_close,
    case
      when v_outcome in ('completed', 'practice_handoff', 'superseded', 'error') then now()
      else null
    end
  )
  on conflict (conversation_id) do update set
    entry_source = coalesce(excluded.entry_source, public.daily_dialog_archives.entry_source),
    day_tab_mode = coalesce(excluded.day_tab_mode, public.daily_dialog_archives.day_tab_mode),
    locale = coalesce(excluded.locale, public.daily_dialog_archives.locale),
    algo_version = coalesce(excluded.algo_version, public.daily_dialog_archives.algo_version),
    turns = coalesce(public.daily_dialog_archives.turns, '[]'::jsonb) || coalesce(excluded.turns, '[]'::jsonb),
    last_branch = coalesce(excluded.last_branch, public.daily_dialog_archives.last_branch),
    last_turn_mode = coalesce(excluded.last_turn_mode, public.daily_dialog_archives.last_turn_mode),
    last_should_close = coalesce(excluded.last_should_close, public.daily_dialog_archives.last_should_close),
    outcome = case
      when public.daily_dialog_archives.outcome in ('completed', 'practice_handoff')
        then public.daily_dialog_archives.outcome
      else excluded.outcome
    end,
    closed_at = case
      when public.daily_dialog_archives.outcome in ('completed', 'practice_handoff')
        then public.daily_dialog_archives.closed_at
      when excluded.outcome in ('completed', 'practice_handoff', 'superseded', 'error')
        then coalesce(public.daily_dialog_archives.closed_at, now())
      else public.daily_dialog_archives.closed_at
    end,
    updated_at = now();
end;
$$;

revoke all on function public.append_daily_dialog_archive(
  uuid, uuid, text, text, text, text, jsonb, text, text, text, boolean
) from public;
revoke all on function public.append_daily_dialog_archive(
  uuid, uuid, text, text, text, text, jsonb, text, text, text, boolean
) from anon;
revoke all on function public.append_daily_dialog_archive(
  uuid, uuid, text, text, text, text, jsonb, text, text, text, boolean
) from authenticated;
grant execute on function public.append_daily_dialog_archive(
  uuid, uuid, text, text, text, text, jsonb, text, text, text, boolean
) to service_role;

create or replace function public.cleanup_daily_dialog_archives()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  delete from public.daily_dialog_archives
  where started_at < now() - interval '7 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.cleanup_daily_dialog_archives() from public;
revoke all on function public.cleanup_daily_dialog_archives() from anon;
revoke all on function public.cleanup_daily_dialog_archives() from authenticated;
grant execute on function public.cleanup_daily_dialog_archives() to postgres;
grant execute on function public.cleanup_daily_dialog_archives() to service_role;

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
          'run_email_automations_hourly',
          '40 * * * *',
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
