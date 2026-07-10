-- Recompute users.membership_* from the payments ledger (highest active tier wins)
-- and schedule hourly Edge invoke for users whose membership_expires_at has passed.
--
-- Requires (one-time, via SQL or script — do NOT commit secrets into git).
-- vault.create_secret(value, name, description):
--   select vault.create_secret(
--     '<same value as CRON_SECRET for the Edge Function>',
--     'reconcile_expired_memberships_cron_secret',
--     'x-cron-secret header for reconcile-expired-memberships'
--   );
--
-- The function URL matches this Supabase project (same ref as in EXPO_PUBLIC_SUPABASE_URL).
-- If you fork the repo to another Supabase project, update the URL constant below.

create or replace function public.recompute_user_membership(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_tier text;
  v_paid_until timestamptz;
begin
  select p.tier, p.paid_until
    into v_tier, v_paid_until
  from public.payments p
  where p.user_id = p_user_id
    and p.tier in ('oracle', 'practitioner', 'master')
    and (p.paid_until is null or p.paid_until > now())
  order by
    case p.tier
      when 'master' then 3
      when 'practitioner' then 2
      when 'oracle' then 1
      else 0
    end desc,
    p.paid_until desc nulls first,
    p.created_at desc
  limit 1;

  if v_tier is null then
    update public.users
    set membership_tier = 'free',
        membership_expires_at = null
    where id = p_user_id;
  else
    update public.users
    set membership_tier = v_tier,
        membership_expires_at = v_paid_until
    where id = p_user_id;
  end if;
end;
$function$;

revoke all on function public.recompute_user_membership(uuid) from public;
grant execute on function public.recompute_user_membership(uuid) to service_role;

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
    perform public.recompute_user_membership(r.id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

revoke all on function public.reconcile_expired_memberships(integer) from public;
grant execute on function public.reconcile_expired_memberships(integer) to service_role;

comment on function public.recompute_user_membership(uuid) is
  'Sets users.membership_tier/expires_at from the highest still-active payment (TIER_ORDER), or free.';

comment on function public.reconcile_expired_memberships(integer) is
  'Batch-recomputes membership for users whose membership_expires_at has passed.';

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

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
  select ds.decrypted_secret
    into v_secret
  from vault.decrypted_secrets ds
  where ds.name = 'reconcile_expired_memberships_cron_secret'
  limit 1;

  if v_secret is null then
    raise warning 'Vault secret "reconcile_expired_memberships_cron_secret" is missing; skipping reconcile-expired-memberships invoke';
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

revoke all on function public.invoke_reconcile_expired_memberships() from public;
grant execute on function public.invoke_reconcile_expired_memberships() to postgres;

do $do$
declare
  r record;
begin
  for r in
    select j.jobid
    from cron.job j
    where j.jobname = 'reconcile_expired_memberships_hourly'
  loop
    perform cron.unschedule(r.jobid);
  end loop;
end;
$do$;

select cron.schedule(
  'reconcile_expired_memberships_hourly',
  '20 * * * *',
  $$select public.invoke_reconcile_expired_memberships();$$
);
