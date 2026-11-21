-- A rehearsal accelerates letters, never the three-day Day card lifetime.
begin;
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
  v_expected_display:=((v_last at time zone e.timezone)+make_interval(days=>c.day_card_extra_days)) at time zone e.timezone;
  if p_display_until is distinct from v_expected_display
   or p_access_until is distinct from (((v_last at time zone e.timezone)+make_interval(days=>c.access_days)) at time zone e.timezone)
  then raise exception 'Course deadlines must follow the last lesson'; end if;
  if e.mode='test' then v_completion_at:=v_last+interval '2 minutes';
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

-- Repair only the former two-minute test window; delivery dates/cursors stay intact.
update public.course_enrollments e
set display_until=(((e.schedule->-1->>'opensAt')::timestamptz at time zone e.timezone)
  +make_interval(days=>c.day_card_extra_days)) at time zone e.timezone
from public.courses c
where c.slug=e.course_slug and e.mode='test' and e.status='active'
  and e.completion_email_step_id is not null and jsonb_array_length(e.schedule)>0
  and e.display_until=(e.schedule->-1->>'opensAt')::timestamptz+interval '2 minutes';

-- Correct the first catalogue bonus, preserving any subsequent manual rename/content edit.
update public.course_lessons set title='Дополнительная практика'
where id='month-pleasure-04' and course_slug='month-pleasure' and position=4 and title='Урок 4'
  and blocks @> '[{"type":"video","practiceId":"ee440169-bf2a-4e7c-a3ee-4f8778fcbbda"}]'::jsonb;
commit;
