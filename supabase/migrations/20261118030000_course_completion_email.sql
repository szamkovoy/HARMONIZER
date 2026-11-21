-- Optional completion letter is not a lesson. Existing grants and cursors are untouched.
begin;
alter table public.courses add column completion_email_step_id uuid references public.email_automation_steps(id);
alter table public.course_enrollments
 add column completion_email_step_id uuid references public.email_automation_steps(id),
 add column completion_mail_at timestamptz,
 add constraint course_completion_pair check((completion_email_step_id is null)=(completion_mail_at is null));

create or replace function public.start_course_enrollment(p_id uuid,p_schedule jsonb,p_start timestamptz,p_access_until timestamptz,p_display_until timestamptz)
returns void language plpgsql security definer set search_path=public,extensions as $$
declare e course_enrollments; c courses; v_contact uuid; v_completion_at timestamptz; v_expected_display timestamptz; v_last timestamptz;
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
 if jsonb_array_length(p_schedule)=0 then raise exception 'Course has no lessons'; end if;
 v_last:=(p_schedule->-1->>'opensAt')::timestamptz;
 if c.completion_email_step_id is not null then
  if not exists(select 1 from email_automation_steps s where s.id=c.completion_email_step_id and s.automation_id=c.automation_id)
   or exists(select 1 from course_lessons l where l.email_step_id=c.completion_email_step_id)
  then raise exception 'Invalid completion email'; end if;
  v_expected_display:=case when e.mode='test' then v_last+interval '2 minutes'
    else ((v_last at time zone e.timezone)+make_interval(days=>c.day_card_extra_days)) at time zone e.timezone end;
  if p_display_until is distinct from v_expected_display
   or p_access_until is distinct from (((v_last at time zone e.timezone)+make_interval(days=>c.access_days)) at time zone e.timezone)
  then raise exception 'Course deadlines must follow the last lesson'; end if;
  if e.mode='test' then v_completion_at:=p_display_until;
  else
   v_completion_at:=(date_trunc('day',p_display_until at time zone e.timezone)+interval '7 hours') at time zone e.timezone;
   if v_completion_at<p_display_until then
    v_completion_at:=((v_completion_at at time zone e.timezone)+interval '1 day') at time zone e.timezone;
   end if;
  end if;
 end if;
 select id into v_contact from email_contacts where user_id=e.user_id and lower(trim(email))=e.buyer_email order by created_at limit 1;
 if v_contact is null then raise exception 'Email contact missing'; end if;
 if exists(select 1 from email_contacts where id=v_contact and marketing_status in ('complained','suppressed')) then raise exception 'Email delivery is blocked for contact'; end if;
 insert into email_automation_enrollments(automation_id,contact_id,current_position,next_step_at,status,cycle_key,course_enrollment_id)
 values(c.automation_id,v_contact,0,(p_schedule->0->>'mailAt')::timestamptz,'active','course:'||e.id,e.id);
 update course_enrollments set schedule=p_schedule,started_at=p_start,access_until=p_access_until,display_until=p_display_until,
 completion_email_step_id=c.completion_email_step_id,completion_mail_at=v_completion_at,
 status='active',next_mail_at=(p_schedule->0->>'mailAt')::timestamptz where id=e.id;
 update email_automations set is_active=true,activated_at=coalesce(activated_at,now()) where id=c.automation_id;
end $$;

create or replace function public.claim_course_mail(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare e course_enrollments; v_token uuid:=gen_random_uuid();
begin
 select * into e from course_enrollments where id=p_id for update skip locked;
 if not found or e.status<>'active' or e.mail_paused or e.next_mail_at is null or e.next_mail_at>now()
 or (e.access_until<=now() and not(e.mail_position=jsonb_array_length(e.schedule) and e.completion_email_step_id is not null)) or e.claim_until>now() then return null; end if;
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
 if e.mail_position<jsonb_array_length(e.schedule) then
  select email_step_id into v_step from course_lessons where id=(e.schedule->e.mail_position->>'lessonId') and course_slug=e.course_slug;
 elsif e.mail_position=jsonb_array_length(e.schedule) then v_step:=e.completion_email_step_id;
 end if;
 if a.id is null or v_step is null or not exists(select 1 from email_automation_steps where id=v_step and automation_id=a.automation_id) then raise exception 'Course step missing'; end if;
 insert into email_automation_sends(enrollment_id,automation_id,step_id,contact_id,resend_id,status,subject,error_detail,course_send_key)
 values(a.id,a.automation_id,v_step,a.contact_id,p_resend_id,case when p_error is null then 'sent' else 'failed' end,p_subject,p_error,
 case when p_error is null then e.id::text||':'||e.mail_position else null end) on conflict(course_send_key) do nothing;
 if p_error is null then
  v_next:=case when e.mail_position+1=jsonb_array_length(e.schedule) then e.completion_mail_at else (e.schedule->(e.mail_position+1)->>'mailAt')::timestamptz end;
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
 where e.mode='test' and e.status='active' and not e.mail_paused and e.next_mail_at<=now() and (e.access_until>now() or (e.mail_position=jsonb_array_length(e.schedule) and e.completion_email_step_id is not null))) then return null; end if;
 v_secret:=public._cron_secret('precompute_global_cron_secret');
 if v_secret is null then return null; end if;
 select net.http_post(url:='https://harmonizer-ten.vercel.app/api/cron/course-tests',
 headers:=jsonb_build_object('content-type','application/json','x-cron-secret',v_secret),body:='{}',timeout_milliseconds:=120000) into v_id;
 return v_id;
end $$;
revoke all on function public.start_course_enrollment(uuid,jsonb,timestamptz,timestamptz,timestamptz),public.claim_course_mail(uuid),public.finish_course_mail(uuid,uuid,text,text,text),public.invoke_course_tests() from public,anon,authenticated;
grant execute on function public.start_course_enrollment(uuid,jsonb,timestamptz,timestamptz,timestamptz),public.claim_course_mail(uuid),public.finish_course_mail(uuid,uuid,text,text,text),public.invoke_course_tests() to service_role,postgres;
commit;
