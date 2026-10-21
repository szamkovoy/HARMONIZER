-- invoke_run_email_campaigns refreshes counters only when a wave or an access
-- revert is due, and that path posts to Vercel. Idle days never recount, so
-- the card stays on the number from the send hour. This job calls the rollup
-- in Postgres. It does not use net.http_post. At 65 connections it skips the
-- hour, same guard as the campaign invoker (Small allows 90).

create extension if not exists pg_cron with schema extensions;

do $do$
declare
  r record;
begin
  for r in
    select j.jobid
    from cron.job j
    where j.jobname = 'refresh_email_campaign_counters_hourly'
  loop
    perform cron.unschedule(r.jobid);
  end loop;
end;
$do$;

select cron.schedule(
  'refresh_email_campaign_counters_hourly',
  '7 * * * *',
  $cmd$
do $body$
begin
  if (
    select count(*)
    from pg_stat_activity
    where datname = current_database()
  ) >= 65 then
    return;
  end if;
  perform public.refresh_email_campaign_counters();
end
$body$;
$cmd$
);
