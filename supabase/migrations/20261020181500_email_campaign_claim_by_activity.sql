-- Claim the next batch in "most alive first" order. The worker may also
-- stamp created_at in that order; this ORDER BY is what the live send uses
-- even before that worker is deployed.

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
  v_plan jsonb;
  v_cap int := 40;
  v_gap int := 240;
  v_limit int;
begin
  select p.batch_limit, p.claim_interval_seconds
    into v_cap, v_gap
  from public.email_send_pace p
  where p.id = 1;

  select c.warmup_plan into v_plan
  from public.email_campaigns c
  where c.id = p_campaign_id;

  if v_plan ? 'batch_limit' then
    v_cap := (v_plan->>'batch_limit')::int;
  end if;
  if v_plan ? 'claim_interval_seconds' then
    v_gap := (v_plan->>'claim_interval_seconds')::int;
  end if;

  v_cap := greatest(1, least(coalesce(v_cap, 40), 100));
  v_gap := greatest(60, least(coalesce(v_gap, 240), 900));
  v_limit := greatest(1, least(coalesce(p_limit, v_cap), v_cap));

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
      and s.claimed_at > now() - make_interval(secs => v_gap)
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
      join public.email_contacts c on c.id = q.contact_id
      left join public.users u on u.id = c.user_id
      where q.campaign_id = p_campaign_id
        and q.status = 'queued'
      order by greatest(
        u.last_seen_at,
        u.getcourse_last_activity_at,
        c.last_open_at,
        c.last_click_at
      ) desc nulls last,
      q.created_at,
      q.id
      limit v_limit
      for update of q skip locked
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
  order by greatest(
    u.last_seen_at,
    u.getcourse_last_activity_at,
    c.last_open_at,
    c.last_click_at
  ) desc nulls last,
  s.created_at,
  s.id;
end;
$$;

revoke all on function public.claim_email_campaign_batch(uuid, int, int) from public, anon, authenticated;
grant execute on function public.claim_email_campaign_batch(uuid, int, int) to service_role;
