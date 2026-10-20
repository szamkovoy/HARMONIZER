-- Nano has about 60 connections. A 100-letter batch makes Resend call
-- the delivery webhook once per letter at the same moment, and that alone
-- filled the pool. Claim at most 40 rows, and not again for 4 minutes,
-- so one cron tick sends one batch. A stale batch is still reclaimed.

create or replace function public.claim_email_campaign_batch(
  p_campaign_id uuid,
  p_limit int default 100,
  p_stale_minutes int default 15
)
returns table (
  send_id uuid,
  contact_id uuid,
  send_locale text,
  batch_key uuid,
  email text,
  contact_locale text,
  unsubscribe_token text,
  marketing_status text,
  display_name text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key uuid;
  v_limit int := greatest(1, least(coalesce(p_limit, 100), 40));
begin
  select s.batch_key into v_key
  from public.email_campaign_sends s
  where s.campaign_id = p_campaign_id
    and s.status = 'sending'
    and s.claimed_at < now() - make_interval(mins => greatest(1, p_stale_minutes))
  order by s.claimed_at
  limit 1;

  if v_key is null and exists (
    select 1
    from public.email_campaign_sends s
    where s.campaign_id = p_campaign_id
      and s.claimed_at > now() - interval '4 minutes'
  ) then
    return;
  end if;

  if v_key is not null then
    update public.email_campaign_sends s
    set claimed_at = now()
    where s.campaign_id = p_campaign_id
      and s.batch_key = v_key
      and s.status = 'sending';
  else
    v_key := gen_random_uuid();
    update public.email_campaign_sends s
    set status = 'sending', batch_key = v_key, claimed_at = now()
    where s.id in (
      select q.id
      from public.email_campaign_sends q
      where q.campaign_id = p_campaign_id
        and q.status = 'queued'
      order by q.created_at
      limit v_limit
      for update skip locked
    );
  end if;

  update public.email_contacts c
  set unsubscribe_token = encode(extensions.gen_random_bytes(24), 'hex')
  where c.unsubscribe_token is null
    and c.id in (
      select s.contact_id from public.email_campaign_sends s
      where s.campaign_id = p_campaign_id and s.batch_key = v_key and s.status = 'sending'
    );

  return query
  select
    s.id,
    s.contact_id,
    s.locale,
    s.batch_key,
    c.email,
    c.locale,
    c.unsubscribe_token,
    c.marketing_status,
    u.display_name
  from public.email_campaign_sends s
  join public.email_contacts c on c.id = s.contact_id
  left join public.users u on u.id = c.user_id
  where s.campaign_id = p_campaign_id
    and s.batch_key = v_key
    and s.status = 'sending'
  order by s.created_at, s.id;
end;
$$;

revoke all on function public.claim_email_campaign_batch(uuid, int, int) from public, anon, authenticated;
grant execute on function public.claim_email_campaign_batch(uuid, int, int) to service_role;

create or replace function public.invoke_run_email_campaigns()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, extensions
as $function$
declare
  v_secret text;
  v_url constant text := 'https://harmonizer-ten.vercel.app/api/cron/email-campaigns';
  v_id bigint;
  v_due boolean;
  v_busy int;
begin
  select exists (
    select 1
    from public.email_campaigns c
    where c.send_halted_at is null
      and (c.send_lease_until is null or c.send_lease_until < now())
      and (
        c.status = 'sending'
        or (
          c.status = 'paused'
          and c.next_wave_at is not null
          and c.next_wave_at <= now()
        )
      )
  ) or exists (
    select 1
    from public.email_campaign_access_grants g
    where g.kind = 'master'
      and g.reverted_at is null
      and g.revert_at <= now()
  ) into v_due;
  if not v_due then
    return null;
  end if;

  select count(*) into v_busy
  from pg_stat_activity
  where datname = current_database();
  if v_busy >= 45 then
    return null;
  end if;

  perform public.refresh_email_campaign_counters();

  v_secret := public._cron_secret('precompute_global_cron_secret');
  if v_secret is null then
    raise warning 'Vault cron secret missing; skipping email-campaigns invoke';
    return null;
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  )
    into v_id;

  return v_id;
end;
$function$;
