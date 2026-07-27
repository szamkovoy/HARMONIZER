-- Deliverability dashboard: faster event / status scans.

create index if not exists email_events_created_idx
  on public.email_events (created_at desc);

create index if not exists email_events_type_created_idx
  on public.email_events (event_type, created_at desc);

create index if not exists email_contacts_status_created_idx
  on public.email_contacts (marketing_status, created_at desc);
