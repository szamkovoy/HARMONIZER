-- Campaigns sent before 2026-10-10 stored email.opened / email.clicked on
-- email_events (with send_id) but left email_campaign_sends.status at
-- delivered or sent. Segments and cohorts read the send status.
-- Rank matches apply_email_campaign_delivery:
--   clicked > opened > delivered > sent > queued/sending/skipped.
-- bounced, complained and failed stay (rank 5, terminal). This does not
-- call refresh_email_campaign_counters: those cards are already right, and
-- the 14-day window does not include these sends.
-- Batches of 1000. safeupdate requires a WHERE on every UPDATE.

do $$
declare
  v_batch int;
begin
  loop
    with picked as (
      select
        s.id,
        case
          when bool_or(e.event_type = 'email.clicked') then 'clicked'
          else 'opened'
        end as next_status
      from public.email_campaigns c
      join public.email_events e
        on e.campaign_id = c.id
       and e.event_type in ('email.opened', 'email.clicked')
       and e.send_id is not null
      join public.email_campaign_sends s on s.id = e.send_id
      where c.sent_at < timestamp '2026-10-10'
        and s.status in ('queued', 'sending', 'skipped', 'sent', 'delivered', 'opened')
      group by s.id, s.status
      having
        case
          when bool_or(e.event_type = 'email.clicked') then 'clicked'
          else 'opened'
        end is distinct from s.status
      limit 1000
    ),
    upd as (
      update public.email_campaign_sends s
      set status = picked.next_status
      from picked
      where s.id = picked.id
        and s.status in ('queued', 'sending', 'skipped', 'sent', 'delivered', 'opened')
        and s.status not in ('bounced', 'complained', 'failed')
      returning s.id
    )
    select count(*)::int into v_batch from upd;

    exit when v_batch = 0;
  end loop;
end $$;
