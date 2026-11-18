-- LOCAL DISPOSABLE DATABASE ONLY. No HTTP delivery or real recipients.
begin;
insert into auth.users values('00000000-0000-4000-8000-000000000023','content@example.test');
insert into public.users values('00000000-0000-4000-8000-000000000023','Content','ru','Europe/Moscow');
insert into email_contacts(user_id,email,email_normalized) values('00000000-0000-4000-8000-000000000023','content@example.test','content@example.test');
do $$
declare eid uuid; result jsonb; e course_enrollments; payload jsonb; slug text; total int; rejected boolean;
begin
 if has_function_privilege('anon','public.start_course_content_test(uuid)','EXECUTE')
 or has_function_privilege('authenticated','public.start_course_content_test(uuid)','EXECUTE') then raise exception 'Public content-test start';end if;
 foreach slug in array array['fixture-completion','month-health'] loop
  eid:=prepare_course_test('00000000-0000-4000-8000-000000000023',slug,'Europe/Moscow');
  result:=start_course_content_test(eid);
  select * into e from course_enrollments where id=eid;
  if e.mode<>'test' or e.status<>'active' then raise exception 'Wrong test status';end if;
  if exists(select 1 from jsonb_array_elements(e.schedule) s where (s->>'opensAt')::timestamptz<>e.started_at or (s->>'mailAt')::timestamptz<>e.started_at)
  then raise exception 'Content was not released immediately';end if;
  if e.display_until<>e.started_at+interval '3 days' or e.access_until<>e.started_at+interval '90 days' then raise exception 'Content-test access/display changed';end if;
  if e.completion_email_step_id is not null and e.completion_mail_at<>e.started_at then raise exception 'Closing email waits';end if;
  total:=jsonb_array_length(e.schedule)+case when e.completion_email_step_id is null then 0 else 1 end;
  if (result->>'totalMails')::int<>total then raise exception 'Wrong email count';end if;
  if exists(select 1 from webinar_passes where course_enrollment_id=eid) then raise exception 'Content test grants real webinar access';end if;
  rejected:=false;
  begin perform start_course_content_test(eid);exception when others then rejected:=true;end;
  if not rejected then raise exception 'Repeated start restarts email';end if;
  for i in 1..total loop
   payload:=claim_course_mail(eid);
   if payload is null or (payload->>'mail_position')::int<>i-1 then raise exception 'Email unavailable/out of order';end if;
   perform finish_course_mail(eid,(payload->>'claim_token')::uuid,'Content','local-content-'||i,null);
  end loop;
  if claim_course_mail(eid) is not null then raise exception 'Duplicate email';end if;
  if (select count(*) from email_automation_sends where course_send_key like eid::text||':%')<>total then raise exception 'Wrong sent count';end if;
  if (select status from email_automation_enrollments where course_enrollment_id=eid)<>'completed' then raise exception 'Email chain not completed';end if;
  if (select schedule from course_enrollments where id=eid)<>e.schedule or (select display_until from course_enrollments where id=eid)<>e.display_until then raise exception 'Mail changes Day/access';end if;
  perform cleanup_course_test(eid);
 end loop;
 eid:=prepare_course_test('00000000-0000-4000-8000-000000000023','month-health','Europe/Moscow');
 update course_enrollments set mode='normal' where id=eid;
 rejected:=false;
 begin perform start_course_content_test(eid);exception when others then rejected:=true;end;
 if not rejected then raise exception 'Content test starts an ordinary purchase';end if;
end$$;
rollback;
