-- Unified inbox: admin + opportunity + webinar_start.
-- • notification_deliveries gets surrogate id, nullable notification_id, kind, text snapshot
-- • record_inbox_notification() for client opportunity rows
-- • webinars.start_notified_at + minutely Edge invoke for start push

-- ---------------------------------------------------------------------------
-- A) notification_deliveries reshape
-- ---------------------------------------------------------------------------
alter table public.notification_deliveries
  add column if not exists id uuid;

update public.notification_deliveries
set id = gen_random_uuid()
where id is null;

alter table public.notification_deliveries
  alter column id set default gen_random_uuid(),
  alter column id set not null;

alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_pkey;

alter table public.notification_deliveries
  add primary key (id);

alter table public.notification_deliveries
  alter column notification_id drop not null;

alter table public.notification_deliveries
  add column if not exists kind text not null default 'admin',
  add column if not exists title text,
  add column if not exists body text,
  add column if not exists link_url text,
  add column if not exists source_key text;

alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_kind_check;

alter table public.notification_deliveries
  add constraint notification_deliveries_kind_check
  check (kind in ('admin', 'opportunity', 'webinar_start'));

alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_admin_notification_required;

alter table public.notification_deliveries
  add constraint notification_deliveries_admin_notification_required
  check (
    (kind = 'admin' and notification_id is not null)
    or (kind <> 'admin')
  );

create unique index if not exists notification_deliveries_admin_user_uidx
  on public.notification_deliveries (notification_id, user_id)
  where notification_id is not null;

create unique index if not exists notification_deliveries_source_uidx
  on public.notification_deliveries (user_id, kind, source_key)
  where source_key is not null;

-- Backfill snapshot text for existing admin rows (best-effort RU column).
update public.notification_deliveries d
set
  title = coalesce(d.title, n.title),
  body = coalesce(d.body, n.body),
  link_url = coalesce(d.link_url, n.link_url)
from public.notifications n
where d.notification_id = n.id
  and d.kind = 'admin'
  and (d.title is null or d.body is null or d.link_url is null);

-- Recipient may read parent notification only when linked.
drop policy if exists notifications_recipient_read on public.notifications;
create policy notifications_recipient_read on public.notifications for select
  using (
    exists (
      select 1 from public.notification_deliveries d
      where d.notification_id = notifications.id
        and d.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- B) Client RPC: record personal inbox row (opportunity)
-- ---------------------------------------------------------------------------
create or replace function public.record_inbox_notification(
  p_kind text,
  p_title text,
  p_body text default '',
  p_link_url text default null,
  p_source_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_body text := trim(coalesce(p_body, ''));
  v_link text := nullif(trim(coalesce(p_link_url, '')), '');
  v_key text := nullif(trim(coalesce(p_source_key, '')), '');
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_kind is distinct from 'opportunity' then
    raise exception 'kind not allowed';
  end if;
  if v_title is null then
    raise exception 'title required';
  end if;

  if v_key is not null then
    select d.id into v_id
    from public.notification_deliveries d
    where d.user_id = v_uid
      and d.kind = p_kind
      and d.source_key = v_key
    limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  insert into public.notification_deliveries (
    notification_id, user_id, kind, title, body, link_url, source_key
  )
  values (null, v_uid, p_kind, v_title, v_body, v_link, v_key)
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    select d.id into v_id
    from public.notification_deliveries d
    where d.user_id = v_uid
      and d.kind = p_kind
      and d.source_key = v_key
    limit 1;
    return v_id;
end;
$$;

revoke all on function public.record_inbox_notification(text, text, text, text, text) from public;
grant execute on function public.record_inbox_notification(text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- C) Webinar start notify flag + minutely cron invoke
-- ---------------------------------------------------------------------------
alter table public.webinars
  add column if not exists start_notified_at timestamptz;

create index if not exists webinars_start_notify_idx
  on public.webinars (starts_at)
  where is_published and start_notified_at is null and join_url is not null;

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
  select ds.decrypted_secret
    into v_secret
  from vault.decrypted_secrets ds
  where ds.name in (
    'notify_webinar_start_cron_secret',
    'precompute_global_cron_secret',
    'cleanup_expired_stories_cron_secret'
  )
  order by case ds.name
    when 'notify_webinar_start_cron_secret' then 0
    when 'precompute_global_cron_secret' then 1
    else 2
  end
  limit 1;

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
    body := '{}'::jsonb
  )
    into v_id;

  return v_id;
end;
$function$;

revoke all on function public.invoke_notify_webinar_start() from public;
grant execute on function public.invoke_notify_webinar_start() to postgres;

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
          -- Every minute; Edge claims webinars whose starts_at just passed.
          'notify_webinar_start_minutely',
          '* * * * *',
          'select public.invoke_notify_webinar_start();',
          'invoke_notify_webinar_start'
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
