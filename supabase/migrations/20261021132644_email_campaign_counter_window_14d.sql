-- opened_count on a sent campaign froze once sent_at fell outside 6 hours,
-- because refresh_email_campaign_counters only rewrites sending/paused rows
-- and sent rows inside that window. Opens keep arriving for days after send.
-- 14 days covers the letters still on the admin cards. Older cards stay as
-- they are: their send-row statuses are repaired separately and must not be
-- rolled back into the counters.

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
       or (c2.status = 'sent' and c2.sent_at > now() - interval '14 days')
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
