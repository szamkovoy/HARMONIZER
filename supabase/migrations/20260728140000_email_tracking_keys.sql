-- First-party open/click tracking keys (Resend cannot issue tracking TLS for .ru).
create table if not exists public.email_tracking_keys (
  id uuid primary key default gen_random_uuid(),
  resend_id text,
  contact_id uuid references public.email_contacts (id) on delete set null,
  campaign_id uuid references public.email_campaigns (id) on delete set null,
  step_id uuid references public.email_automation_steps (id) on delete set null,
  send_id uuid references public.email_campaign_sends (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists email_tracking_keys_resend_idx
  on public.email_tracking_keys (resend_id)
  where resend_id is not null;

create index if not exists email_tracking_keys_created_idx
  on public.email_tracking_keys (created_at desc);

alter table public.email_tracking_keys enable row level security;

create policy email_tracking_keys_admin_all on public.email_tracking_keys
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
