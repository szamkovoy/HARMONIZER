-- Тот же cron раз в 10 минут. Vercel зовём, только если есть просроченный
-- pending-счёт Lava или кандидат на письмо об отказе.
-- Письмо: кабинетные тариф, 30 дней, вебинар и книга. Виджет и брошенная форма — нет.
create or replace function public.invoke_reconcile_lava_payments()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, extensions
as $function$
declare
  v_secret text;
  v_url constant text := 'https://harmonizer-ten.vercel.app/api/cron/lava-reconcile';
  v_id bigint;
begin
  if not exists (
    select 1
    from public.payment_contracts
    where provider = 'lavatop'
      and status = 'pending'
      and created_at <= now() - interval '10 minutes'
      and created_at >= now() - interval '22 minutes'
  ) and not exists (
    select 1
    from public.payment_contracts
    where status = 'failed'
      and user_id is not null
      and failed_notice_sent_at is null
      and source <> 'widget'
      and updated_at <= now() - interval '30 minutes'
      and updated_at >= now() - interval '24 hours'
      and (
        (tier in ('oracle', 'master') and (product_kind = 'subscription' or product_ref = 'pass_30d'))
        or (tier in ('webinar', 'book') and product_kind = 'one_time')
      )
      and (failure_reason is null or (failure_reason not like 'Cancelled by customer%'
           and failure_reason not like '%expired_on_confirmation'))
  ) then
    return null;
  end if;

  v_secret := public._cron_secret('precompute_global_cron_secret');
  if v_secret is null then
    raise warning 'Vault cron secret missing; skipping lava-reconcile invoke';
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

revoke all on function public.invoke_reconcile_lava_payments() from public, anon, authenticated;
grant execute on function public.invoke_reconcile_lava_payments() to postgres, service_role;
