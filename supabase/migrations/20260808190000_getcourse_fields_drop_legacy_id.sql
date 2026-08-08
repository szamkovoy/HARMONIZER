-- GetCourse import polish:
--   • drop crm_legacy_id (no future sync with GetCourse)
--   • add getcourse_last_activity_at (structured; not stuffed into admin_note)

alter table public.users
  drop column if exists crm_legacy_id;

alter table public.users
  add column if not exists getcourse_last_activity_at timestamptz;

comment on column public.users.getcourse_last_activity_at is
  'Last activity timestamp from GetCourse export at import time (admin display only).';

comment on column public.users.crm_imported_at is
  'Set when row originated from GetCourse import; with null onboarded_at+last_seen_at → email_only.';
