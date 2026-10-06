-- safeupdate (loaded on this project) rejects DELETE without a WHERE clause.
-- finalize_email_campaign_batch used `delete from _batch_results` to reset a
-- temp table; the first two claimed batches stayed in 'sending' (Resend
-- Idempotency-Key = batch_key, so a retry will not double-send).

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
