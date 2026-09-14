-- 2026-09-14: run_email_automations — SQL pre-check before the Vercel HTTP call.
--
-- Every 5-minute tick did ~10 PostgREST round trips from Vercel (288 runs/day) and was the
-- single largest source of gateway 504s on the Nano instance. Semantics kept:
--   * due steps (incl. send retries, which are expressed as `next_step_at`) are still
--     picked up within 5 minutes — the tick fires whenever an active enrollment is due;
--   * the enrollers (welcome safety net, subscription_expired, inactive) have day-scale
--     delays; they run on the :00/:15/:30/:45 ticks. Welcome itself is instant via
--     trigger `trg_users_onboarded_email_welcome` → /api/cron/email-welcome.
-- Cost of a skipped tick: one indexed SELECT on email_automation_enrollments.

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
  v_enroller_tick boolean := (extract(minute from now())::int % 15) = 0;
  v_due boolean;
begin
  if not v_enroller_tick then
    select exists (
      select 1
      from public.email_automation_enrollments e
      join public.email_automations a on a.id = e.automation_id
      where e.status = 'active'
        and e.next_step_at <= now()
        and a.is_active
        and a.paused_at is null
    ) into v_due;
    if not v_due then
      return null;
    end if;
  end if;

  v_secret := public._cron_secret('precompute_global_cron_secret');
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

revoke all on function public.invoke_run_email_automations() from public, anon, authenticated;
grant execute on function public.invoke_run_email_automations() to postgres, service_role;

create index if not exists idx_email_automation_enrollments_due
  on public.email_automation_enrollments (next_step_at)
  where status = 'active';
