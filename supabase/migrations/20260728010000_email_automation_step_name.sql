-- Display name for automation step emails (list + editor), independent of subject.
alter table public.email_automation_steps
  add column if not exists name text not null default '';

comment on column public.email_automation_steps.name is
  'Admin label for the step in the chain list; subject remains the email subject line.';

-- Backfill empty names from subject so existing steps stay readable in the list.
update public.email_automation_steps
set name = trim(subject)
where trim(name) = '' and trim(subject) <> '';
