-- After the 2026-10-16 send on compute Small, 100 letters / 120 seconds
-- stayed green (no 504 cluster, connections well under 50). That is the
-- default for the next campaign. The ceiling stays 100.

update public.email_send_pace
set batch_limit = 100,
    claim_interval_seconds = 120,
    updated_at = now()
where id = 1;

alter table public.email_send_pace
  alter column batch_limit set default 100,
  alter column claim_interval_seconds set default 120;
