-- Fast content rehearsal: no calendar simulation and no change to existing grants.
begin;
create or replace function public.start_course_content_test(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare e course_enrollments; c courses; v_start timestamptz:=now(); v_schedule jsonb; v_dispatch bigint;
begin
 select * into e from course_enrollments where id=p_id for update;
 if not found or e.status<>'prepared' or e.mode<>'test' then raise exception 'Prepared test required';end if;
 select * into c from courses where slug=e.course_slug;
 select jsonb_agg(jsonb_build_object('lessonId',id,'opensAt',v_start,'mailAt',v_start) order by position)
 into v_schedule from course_lessons where course_slug=e.course_slug;
 if v_schedule is null then raise exception 'Course has no lessons';end if;
 perform public.start_course_enrollment(p_id,v_schedule,v_start,
  ((v_start at time zone e.timezone)+make_interval(days=>c.access_days)) at time zone e.timezone,
  ((v_start at time zone e.timezone)+make_interval(days=>c.day_card_extra_days)) at time zone e.timezone);
 -- Closing mail is immediately due too, but remains outside the real lesson schedule.
 update course_enrollments set completion_mail_at=v_start where id=p_id and completion_email_step_id is not null;
 select * into e from course_enrollments where id=p_id;
 -- Dispatch after commit via pg_net; the minute cron remains the recovery path.
 begin v_dispatch:=public.invoke_course_tests();exception when others then v_dispatch:=null;end;
 return jsonb_build_object('id',p_id,'start',e.started_at,'schedule',e.schedule,
  'accessUntil',e.access_until,'displayUntil',e.display_until,'completionMailAt',e.completion_mail_at,
  'testMode','content','intervalSeconds',0,'lessonCount',jsonb_array_length(e.schedule),
  'totalMails',jsonb_array_length(e.schedule)+case when e.completion_email_step_id is null then 0 else 1 end,
  'dispatchQueued',v_dispatch is not null);
end $$;
revoke all on function public.start_course_content_test(uuid) from public,anon,authenticated;
grant execute on function public.start_course_content_test(uuid) to service_role,postgres;
commit;
