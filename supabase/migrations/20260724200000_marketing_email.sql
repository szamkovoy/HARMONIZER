-- Marketing email module (phase A) + automation table stubs (phase B).
-- Expo client does not read these tables.
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Contacts
-- ---------------------------------------------------------------------------
create table public.email_contacts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_normalized text not null,
  user_id uuid references public.users(id) on delete set null,
  source text not null default 'imported'
    check (source in ('imported', 'app', 'subscribe_form', 'manual')),
  locale text not null default 'ru',
  country_code text,
  marketing_status text not null default 'active'
    check (marketing_status in ('active', 'unsubscribed', 'suppressed', 'complained')),
  unsubscribe_token text unique,
  last_open_at timestamptz,
  last_click_at timestamptz,
  last_sent_at timestamptz,
  engagement_score int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.email_contacts
  add constraint email_contacts_email_normalized_key unique (email_normalized);
create index email_contacts_user_idx on public.email_contacts (user_id)
  where user_id is not null;
create index email_contacts_status_idx on public.email_contacts (marketing_status);
create index email_contacts_locale_idx on public.email_contacts (locale);

-- ---------------------------------------------------------------------------
-- Campaigns
-- ---------------------------------------------------------------------------
create table public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'draft'
    check (status in ('draft', 'sending', 'sent', 'failed')),
  subject text not null default '',
  subject_i18n jsonb not null default '{}'::jsonb,
  html_body text not null default '',
  html_body_i18n jsonb not null default '{}'::jsonb,
  segment_query jsonb not null default '{}'::jsonb,
  recipient_count int not null default 0,
  skipped_locale_count int not null default 0,
  sent_count int not null default 0,
  delivered_count int not null default 0,
  opened_count int not null default 0,
  clicked_count int not null default 0,
  bounced_count int not null default 0,
  complained_count int not null default 0,
  unsubscribed_count int not null default 0,
  error_count int not null default 0,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index email_campaigns_created_idx on public.email_campaigns (created_at desc);

create table public.email_campaign_sends (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.email_campaigns(id) on delete cascade,
  contact_id uuid not null references public.email_contacts(id) on delete cascade,
  locale text not null,
  resend_id text,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'failed', 'skipped')),
  error_detail text,
  created_at timestamptz not null default now(),
  unique (campaign_id, contact_id)
);

create index email_campaign_sends_resend_idx on public.email_campaign_sends (resend_id)
  where resend_id is not null;
create index email_campaign_sends_campaign_idx on public.email_campaign_sends (campaign_id);

create table public.email_events (
  id uuid primary key default gen_random_uuid(),
  send_id uuid references public.email_campaign_sends(id) on delete set null,
  contact_id uuid references public.email_contacts(id) on delete set null,
  campaign_id uuid references public.email_campaigns(id) on delete set null,
  resend_id text,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index email_events_idempotency_uidx
  on public.email_events (resend_id, event_type)
  where resend_id is not null;
create index email_events_campaign_idx on public.email_events (campaign_id, created_at desc);

create table public.email_assets (
  id uuid primary key default gen_random_uuid(),
  path text not null unique,
  public_url text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Automations stubs (phase B — no runner yet)
-- ---------------------------------------------------------------------------
create table public.email_automations (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  trigger_type text not null default 'manual'
    check (trigger_type in ('manual', 'app_first_open', 'onboarded', 'subscription_expired', 'inactive')),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.email_automation_steps (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.email_automations(id) on delete cascade,
  position int not null,
  delay_hours int not null default 24,
  subject text not null default '',
  subject_i18n jsonb not null default '{}'::jsonb,
  html_body text not null default '',
  html_body_i18n jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (automation_id, position)
);

create table public.email_automation_enrollments (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.email_automations(id) on delete cascade,
  contact_id uuid not null references public.email_contacts(id) on delete cascade,
  current_position int not null default 0,
  next_step_at timestamptz,
  status text not null default 'active'
    check (status in ('active', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (automation_id, contact_id)
);

insert into public.email_automations (key, name, trigger_type, is_active)
values ('welcome_after_install', 'После установки приложения', 'app_first_open', false)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'email-assets',
  'email-assets',
  true,
  3145728,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists email_assets_public_read on storage.objects;
create policy email_assets_public_read on storage.objects for select
  using (bucket_id = 'email-assets');

drop policy if exists email_assets_admin_write on storage.objects;
create policy email_assets_admin_write on storage.objects for insert
  with check (bucket_id = 'email-assets' and public.is_admin(auth.uid()));

drop policy if exists email_assets_admin_update on storage.objects;
create policy email_assets_admin_update on storage.objects for update
  using (bucket_id = 'email-assets' and public.is_admin(auth.uid()));

drop policy if exists email_assets_admin_delete on storage.objects;
create policy email_assets_admin_delete on storage.objects for delete
  using (bucket_id = 'email-assets' and public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- RLS — admin only (service role bypasses)
-- ---------------------------------------------------------------------------
alter table public.email_contacts enable row level security;
alter table public.email_campaigns enable row level security;
alter table public.email_campaign_sends enable row level security;
alter table public.email_events enable row level security;
alter table public.email_assets enable row level security;
alter table public.email_automations enable row level security;
alter table public.email_automation_steps enable row level security;
alter table public.email_automation_enrollments enable row level security;

create policy email_contacts_admin_all on public.email_contacts
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy email_campaigns_admin_all on public.email_campaigns
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy email_campaign_sends_admin_all on public.email_campaign_sends
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy email_events_admin_all on public.email_events
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy email_assets_admin_all on public.email_assets
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy email_automations_admin_all on public.email_automations
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy email_automation_steps_admin_all on public.email_automation_steps
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy email_automation_enrollments_admin_all on public.email_automation_enrollments
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- Sync contacts from app users (auth.users email + public.users profile)
-- ---------------------------------------------------------------------------
create or replace function public.sync_email_contacts_from_users()
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_upserted int := 0;
begin
  insert into public.email_contacts (
    email, email_normalized, user_id, source, locale, country_code,
    marketing_status, unsubscribe_token, updated_at
  )
  select
    trim(au.email),
    lower(trim(au.email)),
    u.id,
    'app',
    coalesce(nullif(trim(u.locale), ''), 'ru'),
    u.country_code,
    'active',
    encode(extensions.gen_random_bytes(24), 'hex'),
    now()
  from auth.users au
  join public.users u on u.id = au.id
  where au.email is not null
    and trim(au.email) <> ''
  on conflict (email_normalized) do update
    set
      email = excluded.email,
      user_id = coalesce(email_contacts.user_id, excluded.user_id),
      locale = case
        when email_contacts.user_id is not null or excluded.user_id is not null
          then coalesce(nullif(trim(excluded.locale), ''), email_contacts.locale)
        else email_contacts.locale
      end,
      country_code = coalesce(excluded.country_code, email_contacts.country_code),
      source = case
        when email_contacts.source = 'imported' and excluded.user_id is not null then 'app'
        else email_contacts.source
      end,
      updated_at = now();

  get diagnostics v_upserted = row_count;
  return jsonb_build_object('upserted', v_upserted, 'ran_at', now());
end;
$$;

revoke all on function public.sync_email_contacts_from_users() from public;
grant execute on function public.sync_email_contacts_from_users() to service_role;
