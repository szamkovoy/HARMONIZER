create extension if not exists pg_cron with schema extensions;

do $do$
declare
  r record;
begin
  for r in
    select j.jobid
    from cron.job j
    where j.jobname in (
      'precompute_global_recommendations_daily',
      'precompute_global_recommendations_hourly'
    )
  loop
    perform cron.unschedule(r.jobid);
  end loop;
end;
$do$;

select cron.schedule(
  'precompute_global_recommendations_hourly',
  '0 * * * *',
  $$select public.invoke_precompute_global_recommendations();$$
);
