-- B2 editor + C1/C2 lifecycle: triggers, enrollment episodes, skip flag, seeds.

-- ---------------------------------------------------------------------------
-- users.skip_email_automations
-- ---------------------------------------------------------------------------
alter table public.users
  add column if not exists skip_email_automations boolean not null default false;

comment on column public.users.skip_email_automations is
  'Admin opt-out: marketing automation chains never enroll/send for this user.';

-- ---------------------------------------------------------------------------
-- email_automations: trigger types + activated_at
-- ---------------------------------------------------------------------------
alter table public.email_automations
  drop constraint if exists email_automations_trigger_type_check;

alter table public.email_automations
  add constraint email_automations_trigger_type_check
  check (trigger_type in (
    'manual',
    'account_registered',
    'app_first_open',
    'onboarded',
    'subscription_expired',
    'inactive'
  ));

alter table public.email_automations
  add column if not exists activated_at timestamptz;

alter table public.email_automations
  add column if not exists trigger_config jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- steps: blocks_i18n for block editor
-- ---------------------------------------------------------------------------
alter table public.email_automation_steps
  add column if not exists blocks_i18n jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- enrollments: episodes (partial unique active) + cycle_key
-- ---------------------------------------------------------------------------
alter table public.email_automation_enrollments
  drop constraint if exists email_automation_enrollments_automation_id_contact_id_key;

alter table public.email_automation_enrollments
  add column if not exists cycle_key text;

create unique index if not exists email_automation_enrollments_active_uidx
  on public.email_automation_enrollments (automation_id, contact_id)
  where status = 'active';

create index if not exists email_automation_enrollments_contact_idx
  on public.email_automation_enrollments (contact_id, created_at desc);

-- ---------------------------------------------------------------------------
-- automation send log (user card history)
-- ---------------------------------------------------------------------------
create table if not exists public.email_automation_sends (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid references public.email_automation_enrollments(id) on delete set null,
  automation_id uuid not null references public.email_automations(id) on delete cascade,
  step_id uuid references public.email_automation_steps(id) on delete set null,
  contact_id uuid not null references public.email_contacts(id) on delete cascade,
  resend_id text,
  status text not null default 'sent'
    check (status in ('sent', 'failed', 'skipped')),
  subject text not null default '',
  error_detail text,
  created_at timestamptz not null default now()
);

create index if not exists email_automation_sends_contact_idx
  on public.email_automation_sends (contact_id, created_at desc);
create index if not exists email_automation_sends_resend_idx
  on public.email_automation_sends (resend_id)
  where resend_id is not null;

alter table public.email_automation_sends enable row level security;

drop policy if exists email_automation_sends_admin_all on public.email_automation_sends;
create policy email_automation_sends_admin_all on public.email_automation_sends
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- Seed / migrate automations
-- ---------------------------------------------------------------------------
update public.email_automations
set
  key = 'account_registered',
  name = 'После регистрации аккаунта',
  trigger_type = 'account_registered',
  updated_at = now()
where key = 'welcome_after_install';

insert into public.email_automations (key, name, trigger_type, is_active)
values
  ('account_registered', 'После регистрации аккаунта', 'account_registered', false),
  ('subscription_expired', 'Не продлил подписку', 'subscription_expired', false),
  ('inactive_14d', 'Неактивен 14 дней', 'inactive', false)
on conflict (key) do update set
  name = excluded.name,
  trigger_type = excluded.trigger_type,
  updated_at = now();

-- Ensure welcome has at least one step (keep existing if present)
insert into public.email_automation_steps (
  automation_id, position, delay_hours, subject, subject_i18n, html_body, html_body_i18n
)
select
  a.id,
  1,
  24,
  'Добро пожаловать в Гармонизатор',
  '{}'::jsonb,
  '<p>Здравствуйте, {{name}}!</p><p>Рады, что вы с нами.</p>',
  '{}'::jsonb
from public.email_automations a
where a.key = 'account_registered'
  and not exists (
    select 1 from public.email_automation_steps s where s.automation_id = a.id
  );

-- C1: single step, delay 0
insert into public.email_automation_steps (
  automation_id, position, delay_hours, subject, subject_i18n, html_body, html_body_i18n
)
select
  a.id,
  1,
  0,
  'Ваша подписка закончилась',
  '{}'::jsonb,
  '<p>Здравствуйте, {{name}}!</p><p>Срок вашей подписки на Гармонизатор истёк. Если хотите продолжить — продлите доступ в личном кабинете.</p>',
  '{}'::jsonb
from public.email_automations a
where a.key = 'subscription_expired'
  and not exists (
    select 1 from public.email_automation_steps s where s.automation_id = a.id
  );

-- C2: single step, delay 0
insert into public.email_automation_steps (
  automation_id, position, delay_hours, subject, subject_i18n, html_body, html_body_i18n
)
select
  a.id,
  1,
  0,
  'Мы скучаем по вам',
  '{}'::jsonb,
  '<p>Здравствуйте, {{name}}!</p><p>Давно не виделись в приложении. Откройте Гармонизатор — там ждут практики и рекомендации на сегодня.</p>',
  '{}'::jsonb
from public.email_automations a
where a.key = 'inactive_14d'
  and not exists (
    select 1 from public.email_automation_steps s where s.automation_id = a.id
  );

-- Confirmed auth users for welcome enroll (service role / cron).
create or replace function public.email_automation_confirmed_users(p_since timestamptz)
returns table (
  user_id uuid,
  email_confirmed_at timestamptz,
  skip_email_automations boolean,
  display_name text
)
language sql
security definer
set search_path = public, auth
as $$
  select
    u.id,
    au.email_confirmed_at,
    coalesce(u.skip_email_automations, false),
    u.display_name
  from auth.users au
  join public.users u on u.id = au.id
  where au.email_confirmed_at is not null
    and (p_since is null or au.email_confirmed_at >= p_since);
$$;

revoke all on function public.email_automation_confirmed_users(timestamptz) from public;
grant execute on function public.email_automation_confirmed_users(timestamptz) to service_role;
grant execute on function public.email_automation_confirmed_users(timestamptz) to postgres;
