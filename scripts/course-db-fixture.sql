-- LOCAL DISPOSABLE DATABASE ONLY. Never load this fixture in production.
create schema if not exists auth;
create schema if not exists extensions;
create schema if not exists cron;
create schema if not exists net;
do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;
end$$;
create table auth.users(id uuid primary key,email text);
create table public.users(id uuid primary key references auth.users,display_name text,locale text,tz text);
create table public.email_contacts(id uuid primary key default gen_random_uuid(),user_id uuid references public.users, email text,email_normalized text,marketing_status text default 'active',locale text,created_at timestamptz default now(),last_sent_at timestamptz);
create table public.email_automations(id uuid primary key default gen_random_uuid(),key text unique,name text,trigger_type text constraint email_automations_trigger_type_check check(trigger_type in('manual')),is_active boolean default false,activated_at timestamptz);
create table public.email_automation_steps(id uuid primary key,automation_id uuid references email_automations,name text,position int,delay_hours int,subject text,subject_i18n jsonb,html_body text,html_body_i18n jsonb,blocks_i18n jsonb,sent_count int default 0,failed_count int default 0,updated_at timestamptz);
create table public.email_automation_enrollments(id uuid primary key default gen_random_uuid(),automation_id uuid references email_automations,contact_id uuid references email_contacts,current_position int,next_step_at timestamptz,status text,cycle_key text,updated_at timestamptz);
create table public.email_automation_sends(id uuid primary key default gen_random_uuid(),enrollment_id uuid references email_automation_enrollments on delete set null,automation_id uuid,step_id uuid,contact_id uuid,resend_id text,status text,subject text,error_detail text);
create table public.email_tracking_keys(id uuid primary key default gen_random_uuid(),resend_id text);
create table public.email_events(id uuid primary key default gen_random_uuid(),resend_id text,event_type text);
alter table public.email_automation_steps add column delivered_count int default 0,add column opened_count int default 0,add column clicked_count int default 0,add column bounced_count int default 0,add column complained_count int default 0;
create function public._cron_secret(text) returns text language sql as $$select null::text$$;
create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int) returns bigint language sql as $$select 1::bigint$$;
