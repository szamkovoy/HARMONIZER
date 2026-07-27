-- Per-step deliverability counters for automation letters (updated by webhook / runner).

alter table public.email_automation_steps
  add column if not exists sent_count int not null default 0,
  add column if not exists delivered_count int not null default 0,
  add column if not exists opened_count int not null default 0,
  add column if not exists clicked_count int not null default 0,
  add column if not exists bounced_count int not null default 0,
  add column if not exists complained_count int not null default 0,
  add column if not exists failed_count int not null default 0;

comment on column public.email_automation_steps.sent_count is
  'Lifetime of successful Resend sends for this step (monotonic).';

-- Best-effort backfill of sent/failed from send log.
update public.email_automation_steps s
set
  sent_count = coalesce((
    select count(*)::int
    from public.email_automation_sends x
    where x.step_id = s.id and x.status = 'sent'
  ), 0),
  failed_count = coalesce((
    select count(*)::int
    from public.email_automation_sends x
    where x.step_id = s.id and x.status = 'failed'
  ), 0);
