-- Add daily intensives without rewriting any existing course, calendar or send.
begin;
alter table public.courses add column title_i18n jsonb not null default '{}' check(jsonb_typeof(title_i18n)='object'),
 add column intro_email_step_id uuid references public.email_automation_steps(id);
alter table public.course_lessons alter column email_step_id drop not null;
alter table public.course_lessons add column blocks_i18n jsonb not null default '{}' check(jsonb_typeof(blocks_i18n)='object');
alter table public.course_enrollments
 add column mail_schedule jsonb check(mail_schedule is null or (jsonb_typeof(mail_schedule)='array' and jsonb_array_length(mail_schedule)=2)),
 add column test_browse boolean not null default false check(not test_browse or mode='test');

create function public.valid_intensive_schedule(p_slug text,p_schedule jsonb,p_start timestamptz)
returns boolean language sql stable set search_path=public as $$
 select jsonb_array_length(p_schedule)=30
 and (select count(*)=30 from course_lessons where course_slug=p_slug)
 and (p_schedule->0->>'opensAt')::timestamptz=p_start
 and not exists(select 1 from jsonb_array_elements(p_schedule) with ordinality x(item,n)
  where not exists(select 1 from course_lessons l where l.course_slug=p_slug and l.position=x.n and l.id=x.item->>'lessonId' and l.gap_days=case when x.n=1 then 0 else 1 end)
   or (x.item->>'opensAt')::timestamptz is null or (x.item->>'mailAt')::timestamptz is null
   or (x.item->>'mailAt')::timestamptz<(x.item->>'opensAt')::timestamptz
   or (x.n>1 and (x.item->>'opensAt')::timestamptz<=(p_schedule->(x.n::int-2)->>'opensAt')::timestamptz));
$$;

create function public.start_intensive_enrollment(p_id uuid,p_schedule jsonb,p_start timestamptz,p_access_until timestamptz,p_display_until timestamptz,p_review boolean default false)
returns void language plpgsql security definer set search_path=public,extensions as $$
declare e course_enrollments;c courses;v_close timestamptz;v_dispatch bigint;
begin
 select * into e from course_enrollments where id=p_id for update;
 if not found or e.status<>'prepared' then raise exception 'Prepared intensive required';end if;
 select * into c from courses where slug=e.course_slug;
 if c.kind<>'intensive' or c.access_days<>1 or c.day_card_extra_days<>1
  or c.intro_email_step_id is null or c.completion_email_step_id is null
  or c.intro_email_step_id=c.completion_email_step_id
  or (p_review and e.mode<>'test')
  or not coalesce(public.valid_intensive_schedule(c.slug,p_schedule,p_start),false)
  or not exists(select 1 from email_automation_steps where id=c.intro_email_step_id and automation_id=c.automation_id)
 then raise exception 'Invalid intensive configuration';end if;
 -- Existing starter retains identity, suppression, deadlines, webinar trigger and enrollment rules.
 perform public.start_course_enrollment(p_id,p_schedule,p_start,p_access_until,p_display_until);
 v_close:=case when p_review then p_start else
  (date_trunc('day',(p_schedule->-1->>'opensAt')::timestamptz at time zone e.timezone)+interval '7 hours') at time zone e.timezone end;
 update course_enrollments set test_browse=p_review,completion_mail_at=v_close,
  mail_schedule=jsonb_build_array(jsonb_build_object('stepId',c.intro_email_step_id,'mailAt',p_start),jsonb_build_object('stepId',c.completion_email_step_id,'mailAt',v_close))
 where id=p_id;
 if p_review then begin v_dispatch:=public.invoke_course_tests();exception when others then v_dispatch:=null;end;end if;
end $$;

create function public.finish_intensive_review(p_id uuid,p_schedule jsonb,p_start timestamptz)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare e course_enrollments;v_end timestamptz;
begin
 select * into e from course_enrollments where id=p_id for update;
 if not found or e.mode<>'test' or e.status<>'active' or not e.test_browse
  or not exists(select 1 from courses where slug=e.course_slug and kind='intensive')
 then raise exception 'Active intensive review required';end if;
 if e.mail_position<>2 or e.next_mail_at is not null then raise exception 'Finish after both test emails are delivered';end if;
 if not coalesce(public.valid_intensive_schedule(e.course_slug,p_schedule,p_start),false) then raise exception 'Invalid intensive calendar';end if;
 v_end:=((date_trunc('day',(p_schedule->-1->>'opensAt')::timestamptz at time zone e.timezone))+interval '1 day') at time zone e.timezone;
 -- Restart only the lesson calendar. Completed emails and their idempotency keys stay untouched.
 update course_enrollments set test_browse=false,schedule=p_schedule,started_at=p_start,access_until=v_end,display_until=v_end where id=p_id;
 return jsonb_build_object('id',p_id,'reviewAllLessons',false,'start',p_start,'accessUntil',v_end,'displayUntil',v_end,'mailsSent',e.mail_position);
end $$;

revoke all on function public.valid_intensive_schedule(text,jsonb,timestamptz),public.start_intensive_enrollment(uuid,jsonb,timestamptz,timestamptz,timestamptz,boolean),public.finish_intensive_review(uuid,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.valid_intensive_schedule(text,jsonb,timestamptz),public.start_intensive_enrollment(uuid,jsonb,timestamptz,timestamptz,timestamptz,boolean),public.finish_intensive_review(uuid,jsonb,timestamptz) to service_role,postgres;

create or replace function public.claim_course_mail(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare e course_enrollments; v_token uuid:=gen_random_uuid();
begin
 select * into e from course_enrollments where id=p_id for update skip locked;
 if not found or e.status<>'active' or e.mail_paused or e.next_mail_at is null or e.next_mail_at>now()
 or (e.access_until<=now() and not((e.mail_schedule is not null and e.mail_position=1) or (e.mail_schedule is null and e.mail_position=jsonb_array_length(e.schedule) and e.completion_email_step_id is not null))) or e.claim_until>now() then return null; end if;
 if not exists(select 1 from courses c join email_automations a on a.id=c.automation_id where c.slug=e.course_slug and a.is_active) then return null; end if;
 if not exists(select 1 from email_automation_enrollments where course_enrollment_id=e.id and status='active') then return null; end if;
 update course_enrollments set claim_token=v_token,claim_until=now()+interval '2 minutes' where id=e.id;
 return to_jsonb(e)||jsonb_build_object('claim_token',v_token);
end $$;

create or replace function public.finish_course_mail(p_id uuid,p_token uuid,p_subject text,p_resend_id text,p_error text)
returns void language plpgsql security definer set search_path=public,extensions as $$
declare e course_enrollments; a email_automation_enrollments; v_step uuid; v_next timestamptz;
begin
 select * into e from course_enrollments where id=p_id for update;
 if not found or p_token is null or e.claim_token is distinct from p_token then raise exception 'Course send lease lost'; end if;
 select * into a from email_automation_enrollments where course_enrollment_id=e.id;
 if e.mail_schedule is not null then
  v_step:=(e.mail_schedule->e.mail_position->>'stepId')::uuid;
 elsif e.mail_position<jsonb_array_length(e.schedule) then
  select email_step_id into v_step from course_lessons where id=(e.schedule->e.mail_position->>'lessonId') and course_slug=e.course_slug;
 elsif e.mail_position=jsonb_array_length(e.schedule) then v_step:=e.completion_email_step_id;
 end if;
 if a.id is null or v_step is null or not exists(select 1 from email_automation_steps where id=v_step and automation_id=a.automation_id) then raise exception 'Course step missing'; end if;
 insert into email_automation_sends(enrollment_id,automation_id,step_id,contact_id,resend_id,status,subject,error_detail,course_send_key)
 values(a.id,a.automation_id,v_step,a.contact_id,p_resend_id,case when p_error is null then 'sent' else 'failed' end,p_subject,p_error,
 case when p_error is null then e.id::text||':'||e.mail_position else null end) on conflict(course_send_key) do nothing;
 if p_error is null then
  v_next:=case when e.mail_schedule is not null then (e.mail_schedule->(e.mail_position+1)->>'mailAt')::timestamptz
    when e.mail_position+1=jsonb_array_length(e.schedule) then e.completion_mail_at else (e.schedule->(e.mail_position+1)->>'mailAt')::timestamptz end;
  update course_enrollments set mail_position=mail_position+1,next_mail_at=v_next,mail_failures=0,claim_token=null,claim_until=null,last_error=null where id=e.id;
  update email_automation_enrollments set current_position=e.mail_position+1,next_step_at=v_next,status=case when v_next is null then 'completed' else 'active' end,updated_at=now() where id=a.id;
  update email_automation_steps set sent_count=sent_count+1,updated_at=now() where id=v_step;
  update email_contacts set last_sent_at=now() where id=a.contact_id;
 else
  v_next:=case when e.mail_failures>=4 then null else now()+interval '1 minute' end;
  update course_enrollments set next_mail_at=v_next,mail_failures=mail_failures+1,mail_paused=(v_next is null),claim_token=null,claim_until=null,last_error=p_error where id=e.id;
  update email_automation_enrollments set next_step_at=v_next,updated_at=now() where id=a.id;
  update email_automation_steps set failed_count=failed_count+1,updated_at=now() where id=v_step;
 end if;
end $$;


create or replace function public.invoke_course_tests() returns bigint language plpgsql security definer
set search_path=public,extensions,net as $$
declare v_secret text; v_id bigint;
begin
 if not exists(select 1 from course_enrollments e join courses c on c.slug=e.course_slug
 join email_automations a on a.id=c.automation_id and a.is_active
 join email_automation_enrollments m on m.course_enrollment_id=e.id and m.status='active'
 where e.mode='test' and e.status='active' and not e.mail_paused and e.next_mail_at<=now() and (e.access_until>now() or (e.mail_schedule is not null and e.mail_position=1) or (e.mail_schedule is null and e.mail_position=jsonb_array_length(e.schedule) and e.completion_email_step_id is not null))) then return null; end if;
 v_secret:=public._cron_secret('precompute_global_cron_secret');
 if v_secret is null then return null; end if;
 select net.http_post(url:='https://harmonizer-ten.vercel.app/api/cron/course-tests',
 headers:=jsonb_build_object('content-type','application/json','x-cron-secret',v_secret),body:='{}',timeout_milliseconds:=120000) into v_id;
 return v_id;
end $$;

commit;
