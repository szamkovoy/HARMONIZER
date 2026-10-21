-- Campaign KPI counters (delivered/opened/clicked/bounced/complained) are no
-- longer incremented once per webhook. Each event still updates its own send
-- row. The shared campaign row is rewritten in one pass every 5 minutes.

create or replace function public.apply_email_campaign_delivery(
  p_resend_id text,
  p_event_type text,
  p_send_status text default null,
  p_counter text default null,
  p_record_event boolean default true,
  p_detail jsonb default null,
  p_suppress_status text default null,
  p_touch text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_send public.email_campaign_sends%rowtype;
  v_rank_current int;
  v_rank_next int;
  v_duplicate boolean := false;
  v_inserted int := 0;
begin
  if coalesce(p_resend_id, '') = '' then
    return null;
  end if;

  select * into v_send
  from public.email_campaign_sends
  where resend_id = p_resend_id
  limit 1;
  if not found then
    return null;
  end if;

  if p_record_event then
    insert into public.email_events (send_id, contact_id, campaign_id, resend_id, event_type, payload)
    values (
      v_send.id, v_send.contact_id, v_send.campaign_id, p_resend_id, p_event_type,
      coalesce(p_detail, '{}'::jsonb)
    )
    on conflict (resend_id, event_type) where resend_id is not null do nothing;
    get diagnostics v_inserted = row_count;
    v_duplicate := v_inserted = 0;
  end if;

  if not v_duplicate and p_send_status is not null then
    v_rank_current := case v_send.status
      when 'queued' then 0 when 'sending' then 0 when 'skipped' then 0
      when 'sent' then 1 when 'delivered' then 2 when 'opened' then 3
      when 'clicked' then 4 else 5 end;
    v_rank_next := case p_send_status
      when 'sent' then 1 when 'delivered' then 2 when 'opened' then 3
      when 'clicked' then 4 when 'bounced' then 5 when 'complained' then 5
      when 'failed' then 5 else 0 end;

    if not p_record_event and v_rank_next <= v_rank_current then
      v_duplicate := true;
    end if;

    if not v_duplicate and v_rank_next >= v_rank_current then
      update public.email_campaign_sends
      set status = p_send_status
      where id = v_send.id;
    end if;
  end if;

  -- p_counter is ignored. Campaign totals are refresh_email_campaign_counters().

  if not v_duplicate and p_suppress_status is not null then
    if p_suppress_status = 'active' then
      update public.email_contacts
      set marketing_status = 'active', updated_at = now()
      where id = v_send.contact_id and marketing_status = 'suppressed';
    elsif p_suppress_status in ('suppressed', 'complained') then
      update public.email_contacts
      set marketing_status = p_suppress_status, updated_at = now()
      where id = v_send.contact_id and marketing_status = 'active';
    end if;
  end if;

  if not v_duplicate and p_touch = 'open' then
    update public.email_contacts set last_open_at = now(), updated_at = now()
    where id = v_send.contact_id;
  elsif not v_duplicate and p_touch = 'click' then
    update public.email_contacts set last_click_at = now(), updated_at = now()
    where id = v_send.contact_id;
  end if;

  return jsonb_build_object(
    'send_id', v_send.id,
    'contact_id', v_send.contact_id,
    'campaign_id', v_send.campaign_id,
    'duplicate', v_duplicate
  );
end;
$$;

create or replace function public.refresh_email_campaign_counters()
returns void
language sql
security definer
set search_path = public
as $$
  update public.email_campaigns c
  set
    delivered_count = x.delivered,
    opened_count = x.opened,
    clicked_count = x.clicked,
    bounced_count = x.bounced,
    complained_count = x.complained
  from (
    select
      s.campaign_id,
      count(*) filter (where s.status in ('delivered', 'opened', 'clicked'))::int as delivered,
      count(*) filter (where s.status in ('opened', 'clicked'))::int as opened,
      count(*) filter (where s.status = 'clicked')::int as clicked,
      count(*) filter (where s.status = 'bounced')::int as bounced,
      count(*) filter (where s.status = 'complained')::int as complained
    from public.email_campaign_sends s
    join public.email_campaigns c2 on c2.id = s.campaign_id
    where c2.status in ('sending', 'paused')
       or (c2.status = 'sent' and c2.sent_at > now() - interval '6 hours')
    group by s.campaign_id
  ) x
  where c.id = x.campaign_id
    and (
      c.delivered_count is distinct from x.delivered
      or c.opened_count is distinct from x.opened
      or c.clicked_count is distinct from x.clicked
      or c.bounced_count is distinct from x.bounced
      or c.complained_count is distinct from x.complained
    );
$$;

revoke all on function public.refresh_email_campaign_counters() from public, anon, authenticated;
grant execute on function public.refresh_email_campaign_counters() to postgres, service_role;

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
begin
  perform public.refresh_email_campaign_counters();

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
