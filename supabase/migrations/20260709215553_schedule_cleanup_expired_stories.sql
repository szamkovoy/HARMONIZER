-- Hourly pg_cron job: invoke Edge Function `cleanup-expired-stories` at minute 15.
--
-- Requires (one-time, via SQL or script — do NOT commit secrets into git).
-- vault.create_secret(value, name, description):
--   select vault.create_secret(
--     '<same value as CRON_SECRET for the Edge Function>',
--     'cleanup_expired_stories_cron_secret',
--     'x-cron-secret header for cleanup-expired-stories'
--   );
--
-- The function URL matches this Supabase project (same ref as in EXPO_PUBLIC_SUPABASE_URL).
-- If you fork the repo to another Supabase project, update the URL constant below.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

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
  select ds.decrypted_secret
    into v_secret
  from vault.decrypted_secrets ds
  where ds.name = 'cleanup_expired_stories_cron_secret'
  limit 1;

  if v_secret is null then
    raise warning 'Vault secret "cleanup_expired_stories_cron_secret" is missing; skipping cleanup-expired-stories invoke';
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

revoke all on function public.invoke_cleanup_expired_stories() from public;
grant execute on function public.invoke_cleanup_expired_stories() to postgres;

do $do$
declare
  r record;
begin
  for r in
    select j.jobid
    from cron.job j
    where j.jobname = 'cleanup_expired_stories_hourly'
  loop
    perform cron.unschedule(r.jobid);
  end loop;
end;
$do$;

select cron.schedule(
  'cleanup_expired_stories_hourly',
  '15 * * * *',
  $$select public.invoke_cleanup_expired_stories();$$
);
