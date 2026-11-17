-- Course grants are independent of membership. No enrolment or mail is started by migration.
create table public.courses (
 slug text primary key, title text not null, kind text not null,
 landing_url text not null, access_days int not null check(access_days>0),
 day_card_extra_days int not null default 3 check(day_card_extra_days>0),
 automation_id uuid not null references public.email_automations(id),
 source_hash text not null, active boolean not null default false,
 created_at timestamptz not null default now()
);
create table public.course_lessons (
 id text primary key, course_slug text not null references public.courses(slug),
 position int not null check(position>0), gap_days int not null check(gap_days>=0),
 title text not null, blocks jsonb not null check(jsonb_typeof(blocks)='array'),
 email_step_id uuid not null references public.email_automation_steps(id),
 unique(course_slug,position)
);
create table public.course_enrollments (
 id uuid primary key default gen_random_uuid(), course_slug text not null references public.courses(slug),
 user_id uuid references public.users(id) on delete set null, buyer_email text not null,
 source_key text not null unique, timezone text not null,
 mode text not null check(mode in ('normal','test')),
 status text not null default 'prepared' check(status in ('prepared','active','revoked')),
 started_at timestamptz, access_until timestamptz, display_until timestamptz,
 schedule jsonb not null default '[]' check(jsonb_typeof(schedule)='array'),
 mail_position int not null default 0, next_mail_at timestamptz,
 mail_paused boolean not null default false, mail_failures int not null default 0,
 claim_token uuid, claim_until timestamptz, last_error text,
 created_at timestamptz not null default now(),
 check(status<>'active' or (started_at is not null and access_until>started_at and display_until>started_at))
);
create unique index course_one_test on public.course_enrollments(user_id,course_slug)
 where mode='test' and status in ('prepared','active');
create index course_own on public.course_enrollments(user_id);
create index course_mail_due on public.course_enrollments(next_mail_at) where status='active' and not mail_paused;
alter table public.courses enable row level security;
alter table public.course_lessons enable row level security;
alter table public.course_enrollments enable row level security;
revoke all on public.courses, public.course_lessons, public.course_enrollments from public, anon, authenticated;
grant all on public.courses, public.course_lessons, public.course_enrollments to service_role;

alter table public.email_automations drop constraint email_automations_trigger_type_check;
alter table public.email_automations add constraint email_automations_trigger_type_check
 check(trigger_type in ('manual','account_registered','app_first_open','onboarded','subscription_expired','inactive','course'));
alter table public.email_automation_enrollments add column course_enrollment_id uuid unique
 references public.course_enrollments(id) on delete cascade;
alter table public.email_automation_sends add column course_send_key text unique;

create function public.prepare_course_test(p_user_id uuid,p_slug text,p_timezone text)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_id uuid; v_email text;
begin
 if not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Invalid timezone'; end if;
 select email into v_email from auth.users where id=p_user_id;
 if v_email is null then raise exception 'User not found'; end if;
 if not exists(select 1 from courses where slug=p_slug) then raise exception 'Course not found'; end if;
 select id into v_id from course_enrollments where user_id=p_user_id and course_slug=p_slug and mode='test' and status in ('prepared','active');
 if v_id is not null then return v_id; end if;
 insert into course_enrollments(course_slug,user_id,buyer_email,source_key,timezone,mode)
 values(p_slug,p_user_id,lower(v_email),'test:'||gen_random_uuid(),p_timezone,'test') returning id into v_id;
 return v_id;
end $$;

create function public.start_course_enrollment(p_id uuid,p_schedule jsonb,p_start timestamptz,p_access_until timestamptz,p_display_until timestamptz)
returns void language plpgsql security definer set search_path=public,extensions as $$
declare e course_enrollments; c courses; v_contact uuid;
begin
 select * into e from course_enrollments where id=p_id for update;
 if not found or e.status<>'prepared' then raise exception 'Course is not prepared'; end if;
 select * into c from courses where slug=e.course_slug;
 if jsonb_array_length(p_schedule)<>(select count(*) from course_lessons where course_slug=e.course_slug)
 or exists(select 1 from jsonb_array_elements(p_schedule) with ordinality x(item,n)
   where not exists(select 1 from course_lessons l where l.id=x.item->>'lessonId' and l.course_slug=e.course_slug and l.position=x.n)
   or (x.item->>'opensAt')::timestamptz is null or (x.item->>'mailAt')::timestamptz is null
   or (x.item->>'mailAt')::timestamptz<(x.item->>'opensAt')::timestamptz)
 or (p_schedule->0->>'opensAt')::timestamptz is distinct from p_start
 or p_display_until<=(p_schedule->-1->>'opensAt')::timestamptz
 or p_access_until<p_display_until
 then raise exception 'Invalid schedule'; end if;
 select id into v_contact from email_contacts where user_id=e.user_id and lower(trim(email))=e.buyer_email order by created_at limit 1;
 if v_contact is null then raise exception 'Email contact missing'; end if;
 if exists(select 1 from email_contacts where id=v_contact and marketing_status in ('complained','suppressed')) then raise exception 'Email delivery is blocked for contact'; end if;
 insert into email_automation_enrollments(automation_id,contact_id,current_position,next_step_at,status,cycle_key,course_enrollment_id)
 values(c.automation_id,v_contact,0,(p_schedule->0->>'mailAt')::timestamptz,'active','course:'||e.id,e.id);
 update course_enrollments set schedule=p_schedule,started_at=p_start,access_until=p_access_until,display_until=p_display_until,
 status='active',next_mail_at=(p_schedule->0->>'mailAt')::timestamptz where id=e.id;
 update email_automations set is_active=true,activated_at=coalesce(activated_at,now()) where id=c.automation_id;
end $$;

create function public.claim_course_mail(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare e course_enrollments; v_token uuid:=gen_random_uuid();
begin
 select * into e from course_enrollments where id=p_id for update skip locked;
 if not found or e.status<>'active' or e.mail_paused or e.next_mail_at is null or e.next_mail_at>now()
 or e.access_until<=now() or e.claim_until>now() then return null; end if;
 if not exists(select 1 from courses c join email_automations a on a.id=c.automation_id where c.slug=e.course_slug and a.is_active) then return null; end if;
 if not exists(select 1 from email_automation_enrollments where course_enrollment_id=e.id and status='active') then return null; end if;
 update course_enrollments set claim_token=v_token,claim_until=now()+interval '2 minutes' where id=e.id;
 return to_jsonb(e)||jsonb_build_object('claim_token',v_token);
end $$;

create function public.finish_course_mail(p_id uuid,p_token uuid,p_subject text,p_resend_id text,p_error text)
returns void language plpgsql security definer set search_path=public,extensions as $$
declare e course_enrollments; a email_automation_enrollments; l course_lessons; v_next timestamptz;
begin
 select * into e from course_enrollments where id=p_id for update;
 if not found or p_token is null or e.claim_token is distinct from p_token then raise exception 'Course send lease lost'; end if;
 select * into a from email_automation_enrollments where course_enrollment_id=e.id;
 select * into l from course_lessons where id=(e.schedule->e.mail_position->>'lessonId') and course_slug=e.course_slug;
 if a.id is null or l.id is null then raise exception 'Course step missing'; end if;
 insert into email_automation_sends(enrollment_id,automation_id,step_id,contact_id,resend_id,status,subject,error_detail,course_send_key)
 values(a.id,a.automation_id,l.email_step_id,a.contact_id,p_resend_id,case when p_error is null then 'sent' else 'failed' end,p_subject,p_error,
 case when p_error is null then e.id::text||':'||e.mail_position else null end) on conflict(course_send_key) do nothing;
 if p_error is null then
  v_next:=(e.schedule->(e.mail_position+1)->>'mailAt')::timestamptz;
  update course_enrollments set mail_position=mail_position+1,next_mail_at=v_next,mail_failures=0,claim_token=null,claim_until=null,last_error=null where id=e.id;
  update email_automation_enrollments set current_position=e.mail_position+1,next_step_at=v_next,status=case when v_next is null then 'completed' else 'active' end,updated_at=now() where id=a.id;
  update email_automation_steps set sent_count=sent_count+1,updated_at=now() where id=l.email_step_id;
  update email_contacts set last_sent_at=now() where id=a.contact_id;
 else
  v_next:=case when e.mail_failures>=4 then null else now()+interval '1 minute' end;
  update course_enrollments set next_mail_at=v_next,mail_failures=mail_failures+1,mail_paused=(v_next is null),claim_token=null,claim_until=null,last_error=p_error where id=e.id;
  update email_automation_enrollments set next_step_at=v_next,updated_at=now() where id=a.id;
  update email_automation_steps set failed_count=failed_count+1,updated_at=now() where id=l.email_step_id;
 end if;
end $$;

-- Dedicated minute tick: no HTTP at all until an explicitly started test has due mail.
create function public.invoke_course_tests() returns bigint language plpgsql security definer
set search_path=public,extensions,net as $$
declare v_secret text; v_id bigint;
begin
 if not exists(select 1 from course_enrollments e join courses c on c.slug=e.course_slug
 join email_automations a on a.id=c.automation_id and a.is_active
 join email_automation_enrollments m on m.course_enrollment_id=e.id and m.status='active'
 where e.mode='test' and e.status='active' and not e.mail_paused and e.next_mail_at<=now() and e.access_until>now()) then return null; end if;
 v_secret:=public._cron_secret('precompute_global_cron_secret');
 if v_secret is null then return null; end if;
 select net.http_post(url:='https://harmonizer-ten.vercel.app/api/cron/course-tests',
 headers:=jsonb_build_object('content-type','application/json','x-cron-secret',v_secret),body:='{}',timeout_milliseconds:=120000) into v_id;
 return v_id;
end $$;
revoke all on function public.prepare_course_test(uuid,text,text),public.start_course_enrollment(uuid,jsonb,timestamptz,timestamptz,timestamptz),public.claim_course_mail(uuid),public.finish_course_mail(uuid,uuid,text,text,text),public.invoke_course_tests() from public,anon,authenticated;
grant execute on function public.prepare_course_test(uuid,text,text),public.start_course_enrollment(uuid,jsonb,timestamptz,timestamptz,timestamptz),public.claim_course_mail(uuid),public.finish_course_mail(uuid,uuid,text,text,text),public.invoke_course_tests() to service_role,postgres;
select cron.schedule('course_tests_due_every_minute','* * * * *','select public.invoke_course_tests();');

-- Remove only an explicitly selected rehearsal; keep the contact and all other purchases.
create function public.cleanup_course_test(p_id uuid) returns void language plpgsql security definer set search_path=public,extensions as $$
declare e course_enrollments; v_auto uuid;
begin
 select * into e from course_enrollments where id=p_id for update;
 if not found or e.mode<>'test' then raise exception 'Test enrolment not found'; end if;
 if e.claim_until>now() then raise exception 'Wait for the current send to finish'; end if;
 select id into v_auto from email_automation_enrollments where course_enrollment_id=e.id;
 delete from email_tracking_keys where resend_id in(select resend_id from email_automation_sends where enrollment_id=v_auto);
 update email_automation_steps s set sent_count=greatest(0,s.sent_count-x.n) from
 (select step_id,count(*)::int n from email_automation_sends where enrollment_id=v_auto and course_send_key is not null group by step_id) x where s.id=x.step_id;
 update email_automation_steps s set failed_count=greatest(0,s.failed_count-x.n) from
 (select step_id,count(*)::int n from email_automation_sends where enrollment_id=v_auto and status='failed' and course_send_key is null group by step_id) x where s.id=x.step_id;
 update email_automation_steps s set
 delivered_count=greatest(0,s.delivered_count-x.delivered),opened_count=greatest(0,s.opened_count-x.opened),
 clicked_count=greatest(0,s.clicked_count-x.clicked),bounced_count=greatest(0,s.bounced_count-x.bounced),
 complained_count=greatest(0,s.complained_count-x.complained),failed_count=greatest(0,s.failed_count-x.failed)
 from (select m.step_id,
 count(*) filter(where v.event_type='email.delivered')::int delivered,count(*) filter(where v.event_type='email.opened')::int opened,
 count(*) filter(where v.event_type='email.clicked')::int clicked,count(*) filter(where v.event_type='email.bounced')::int bounced,
 count(*) filter(where v.event_type='email.complained')::int complained,count(*) filter(where v.event_type='email.failed')::int failed
 from email_events v join email_automation_sends m on m.resend_id=v.resend_id where m.enrollment_id=v_auto group by m.step_id) x where s.id=x.step_id;
 delete from email_events where resend_id in(select resend_id from email_automation_sends where enrollment_id=v_auto);
 delete from email_automation_sends where enrollment_id=v_auto;
 delete from course_enrollments where id=e.id;
end $$;
revoke all on function public.cleanup_course_test(uuid) from public,anon,authenticated;
grant execute on function public.cleanup_course_test(uuid) to service_role,postgres;

-- Account removal and administrative mail cancellation must stop future course mail too.
create function public.course_stop_mail() returns trigger language plpgsql security definer set search_path=public,extensions as $$
begin
 if tg_table_name='course_enrollments' then
  if new.user_id is null and old.user_id is not null then
   new.status:='revoked';new.mail_paused:=true;new.next_mail_at:=null;
  end if;
 else
  if new.course_enrollment_id is not null and new.status='cancelled' and old.status is distinct from new.status then
   update course_enrollments set mail_paused=true,next_mail_at=null where id=new.course_enrollment_id;
  end if;
 end if;
 return new;
end $$;
revoke all on function public.course_stop_mail() from public,anon,authenticated;
create trigger course_user_removed before update of user_id on public.course_enrollments for each row execute function public.course_stop_mail();
create trigger course_automation_cancelled after update of status on public.email_automation_enrollments for each row execute function public.course_stop_mail();
