-- Campaign sending in batches of 100 with three round trips per batch instead
-- of ~9 per letter; webhooks apply a delivery event in one RPC; raw provider
-- payloads for sent/delivered are no longer stored (they were 64 MB of the
-- 114 MB email_events table and said nothing the send row did not).
--
-- Context: on Nano compute the per-letter loop (~17 PostgREST calls per
-- letter incl. webhooks, three rewrites of the same email_campaigns row per
-- letter) stalled the whole project after ~4 h of continuous sending
-- (2026-09-25 and 2026-10-05).

-- ---------------------------------------------------------------------------
-- 1. Send rows: 'sending' state + batch key for idempotent provider retries
-- ---------------------------------------------------------------------------
alter table public.email_campaign_sends
  drop constraint if exists email_campaign_sends_status_check;

alter table public.email_campaign_sends
  add constraint email_campaign_sends_status_check
  check (status in (
    'queued', 'sending', 'sent', 'delivered', 'opened', 'clicked',
    'bounced', 'complained', 'failed', 'skipped'
  ));

alter table public.email_campaign_sends
  add column if not exists batch_key uuid,
  add column if not exists claimed_at timestamptz;

comment on column public.email_campaign_sends.batch_key is
  'Batch the row was claimed into. Reused as the provider Idempotency-Key when a stale ''sending'' batch is retried, so a crash between provider call and finalize cannot double-send.';

-- (campaign_id) alone is a prefix of the unique (campaign_id, contact_id);
-- replace with (campaign_id, status) which serves claim + progress counts.
drop index if exists public.email_campaign_sends_campaign_idx;
create index if not exists email_campaign_sends_campaign_status_idx
  on public.email_campaign_sends (campaign_id, status);

-- ---------------------------------------------------------------------------
-- 2. Campaign row: health brake state
-- ---------------------------------------------------------------------------
alter table public.email_campaigns
  add column if not exists send_slow_strikes int not null default 0,
  add column if not exists send_halt_reason text;

comment on column public.email_campaigns.send_slow_strikes is
  'Consecutive cron ticks skipped because the database answered slowly. 3 strikes → send_halted_at is set and send_halt_reason explains why.';

-- Hot rows: campaigns are rewritten per batch and per delivery webhook,
-- contacts per send/open. Let autovacuum keep up on a small table.
alter table public.email_campaigns set (
  autovacuum_vacuum_scale_factor = 0.0,
  autovacuum_vacuum_threshold = 50,
  autovacuum_analyze_scale_factor = 0.0,
  autovacuum_analyze_threshold = 50,
  fillfactor = 70
);
alter table public.email_contacts set (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_threshold = 200
);
alter table public.email_campaign_sends set (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_threshold = 500
);

-- ---------------------------------------------------------------------------
-- 3. Claim a batch (one round trip: rows + contact + display name)
-- ---------------------------------------------------------------------------
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
set search_path = public
as $$
declare
  v_key uuid;
  v_limit int := greatest(1, least(coalesce(p_limit, 100), 100));
begin
  -- A batch left in 'sending' longer than p_stale_minutes belongs to a worker
  -- that died between the provider call and finalize. Hand it back with the
  -- same batch_key so the provider dedupes.
  select s.batch_key into v_key
  from public.email_campaign_sends s
  where s.campaign_id = p_campaign_id
    and s.status = 'sending'
    and s.claimed_at < now() - make_interval(mins => greatest(1, p_stale_minutes))
  order by s.claimed_at
  limit 1;

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

  -- Contacts in this batch without an unsubscribe token get one now.
  update public.email_contacts c
  set unsubscribe_token = encode(gen_random_bytes(24), 'hex')
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

-- ---------------------------------------------------------------------------
-- 4. Finalize a batch (one round trip: statuses, track keys, contacts, counters)
--    p_results: [{send_id, status, resend_id, locale, error_detail, track_id}]
-- ---------------------------------------------------------------------------
create or replace function public.finalize_email_campaign_batch(
  p_campaign_id uuid,
  p_results jsonb
)
returns table (sent int, failed int, skipped int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sent int := 0;
  v_failed int := 0;
  v_skipped int := 0;
begin
  create temp table if not exists _batch_results (
    send_id uuid,
    status text,
    resend_id text,
    locale text,
    error_detail text,
    track_id uuid
  ) on commit drop;
  delete from _batch_results where true;

  insert into _batch_results
  select
    (r->>'send_id')::uuid,
    coalesce(r->>'status', 'failed'),
    nullif(r->>'resend_id', ''),
    nullif(r->>'locale', ''),
    left(r->>'error_detail', 500),
    nullif(r->>'track_id', '')::uuid
  from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r;

  update public.email_campaign_sends s
  set status = case
        when b.status in ('sent', 'failed', 'skipped', 'queued') then b.status
        else 'failed'
      end,
      resend_id = coalesce(b.resend_id, s.resend_id),
      locale = coalesce(b.locale, s.locale),
      error_detail = b.error_detail,
      claimed_at = case when b.status = 'queued' then null else s.claimed_at end,
      batch_key = case when b.status = 'queued' then null else s.batch_key end
  from _batch_results b
  where s.id = b.send_id
    and s.campaign_id = p_campaign_id
    and s.status = 'sending';

  insert into public.email_tracking_keys (id, resend_id, contact_id, campaign_id, send_id)
  select b.track_id, b.resend_id, s.contact_id, p_campaign_id, s.id
  from _batch_results b
  join public.email_campaign_sends s on s.id = b.send_id
  where b.status = 'sent' and b.track_id is not null
  on conflict (id) do nothing;

  update public.email_contacts c
  set last_sent_at = now()
  where c.id in (
    select s.contact_id
    from _batch_results b
    join public.email_campaign_sends s on s.id = b.send_id
    where b.status = 'sent'
  );

  select
    count(*) filter (where b.status = 'sent'),
    count(*) filter (where b.status = 'failed'),
    count(*) filter (where b.status = 'skipped')
  into v_sent, v_failed, v_skipped
  from _batch_results b;

  if v_sent > 0 or v_failed > 0 then
    update public.email_campaigns c
    set sent_count = c.sent_count + v_sent,
        error_count = c.error_count + v_failed,
        sent_at = coalesce(c.sent_at, case when v_sent > 0 then now() end),
        send_slow_strikes = 0,
        updated_at = now()
    where c.id = p_campaign_id;
  end if;

  return query select v_sent, v_failed, v_skipped;
end;
$$;

revoke all on function public.finalize_email_campaign_batch(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.finalize_email_campaign_batch(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Delivery webhook for a campaign letter in one round trip.
--    Returns null when the provider id is not a campaign send (caller falls
--    back to the automation path).
-- ---------------------------------------------------------------------------
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

    -- sent/delivered carry no event row; the status rank is the dedupe.
    if not p_record_event and v_rank_next <= v_rank_current then
      v_duplicate := true;
    end if;

    if not v_duplicate and v_rank_next >= v_rank_current then
      update public.email_campaign_sends
      set status = p_send_status
      where id = v_send.id;
    end if;
  end if;

  if not v_duplicate and p_counter in (
    'delivered_count', 'opened_count', 'clicked_count', 'bounced_count', 'complained_count'
  ) then
    execute format(
      'update public.email_campaigns set %I = %I + 1, updated_at = now() where id = $1',
      p_counter, p_counter
    ) using v_send.campaign_id;
  end if;

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

revoke all on function public.apply_email_campaign_delivery(text, text, text, text, boolean, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.apply_email_campaign_delivery(text, text, text, text, boolean, jsonb, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Drop the per-letter sent/delivered event rows (75 600 rows, 64 MB of
--    raw webhook JSON). The send row status already carries this.
-- ---------------------------------------------------------------------------
delete from public.email_events
where event_type in ('email.sent', 'email.delivered');
