-- LOCAL DISPOSABLE DATABASE ONLY; no provider and no HTTP calls.
begin;
insert into auth.users values('00000000-0000-4000-8000-000000000030','intensive@example.test');
insert into public.users values('00000000-0000-4000-8000-000000000030','Intensive','ru','Europe/Moscow');
insert into email_contacts(user_id,email,email_normalized) values('00000000-0000-4000-8000-000000000030','intensive@example.test','intensive@example.test');
do $$
declare eid uuid;e course_enrollments;schedule jsonb;start_at timestamptz:=now();end_at timestamptz;payload jsonb;result jsonb;denied boolean;
begin
 if has_function_privilege('anon','public.start_intensive_enrollment(uuid,jsonb,timestamptz,timestamptz,timestamptz,boolean)','EXECUTE')
 or has_function_privilege('authenticated','public.finish_intensive_review(uuid,jsonb,timestamptz)','EXECUTE') then raise exception 'Public intensive operator RPC';end if;
 if (select count(*) from course_lessons where course_slug='intensive-fixture')<>30 then raise exception 'Missing intensive lessons';end if;
 if (select count(*) from email_automation_steps where automation_id=(select automation_id from courses where slug='intensive-fixture'))<>2 then raise exception 'Expected two intensive emails';end if;
 select jsonb_agg(jsonb_build_object('lessonId',id,'opensAt',case when position=1 then start_at else date_trunc('day',start_at)+make_interval(days=>position-1) end,'mailAt',case when position=1 then start_at else date_trunc('day',start_at)+make_interval(days=>position-1,hours=>7) end) order by position)
 into schedule from course_lessons where course_slug='intensive-fixture';
 end_at:=(schedule->-1->>'opensAt')::timestamptz+interval '1 day';
 eid:=prepare_course_test('00000000-0000-4000-8000-000000000030','intensive-fixture','Europe/Moscow');
 if claim_course_mail(eid) is not null then raise exception 'Prepared intensive sent mail';end if;
 perform start_intensive_enrollment(eid,schedule,start_at,end_at,end_at,true);
 select * into e from course_enrollments where id=eid;
 if not e.test_browse or jsonb_array_length(e.mail_schedule)<>2 then raise exception 'Review not started';end if;
 if (e.mail_schedule->0->>'mailAt')::timestamptz<>start_at or (e.mail_schedule->1->>'mailAt')::timestamptz<>start_at then raise exception 'Test mail waits';end if;
 if exists(select 1 from webinar_passes where course_enrollment_id=eid) then raise exception 'Review grants real webinar pass';end if;
 denied:=false;begin perform finish_intensive_review(eid,schedule,start_at);exception when others then denied:=true;end;
 if not denied then raise exception 'Review ended before both emails';end if;
 for i in 0..1 loop
  payload:=claim_course_mail(eid);
  if payload is null or (payload->>'mail_position')::int<>i then raise exception 'Wrong intensive email order';end if;
  if claim_course_mail(eid) is not null then raise exception 'Concurrent intensive claim';end if;
  perform finish_course_mail(eid,(payload->>'claim_token')::uuid,'Intensive','local-intensive-'||i,null);
 end loop;
 if claim_course_mail(eid) is not null then raise exception 'Duplicate third email';end if;
 if (select count(*) from email_automation_sends where course_send_key like eid::text||':%')<>2 then raise exception 'Wrong send ledger';end if;
 result:=finish_intensive_review(eid,schedule,start_at);
 select * into e from course_enrollments where id=eid;
 if e.test_browse or e.mail_position<>2 or e.next_mail_at is not null or e.schedule<>schedule then raise exception 'Finish reset email or failed to resume day one';end if;
 if claim_course_mail(eid) is not null then raise exception 'Finish resent email';end if;
 denied:=false;begin perform finish_intensive_review(eid,schedule,start_at);exception when others then denied:=true;end;
 if not denied then raise exception 'Repeated finish restarts calendar';end if;
 perform cleanup_course_test(eid);
 -- Ordinary purchase: same 30-day calendar, only intro now and closing on day 30 at 07 local.
 select jsonb_agg(jsonb_build_object('lessonId',id,'opensAt',case when position=1 then start_at else (date_trunc('day',start_at at time zone 'Europe/Moscow')+make_interval(days=>position-1)) at time zone 'Europe/Moscow' end,'mailAt',case when position=1 then start_at else (date_trunc('day',start_at at time zone 'Europe/Moscow')+make_interval(days=>position-1,hours=>7)) at time zone 'Europe/Moscow' end) order by position)
 into schedule from course_lessons where course_slug='intensive-fixture';
 end_at:=(schedule->-1->>'opensAt')::timestamptz+interval '1 day';
 eid:=prepare_course_test('00000000-0000-4000-8000-000000000030','intensive-fixture','Europe/Moscow');
 update course_enrollments set mode='normal' where id=eid;
 denied:=false;begin perform start_intensive_enrollment(eid,schedule,start_at,end_at,end_at,true);exception when others then denied:=true;end;
 if not denied then raise exception 'Ordinary purchase gained review mode';end if;
 perform start_intensive_enrollment(eid,schedule,start_at,end_at,end_at,false);
 select * into e from course_enrollments where id=eid;
 if e.test_browse or e.completion_mail_at<>(schedule->-1->>'opensAt')::timestamptz+interval '7 hours' then raise exception 'Wrong ordinary intensive closing time';end if;
 if e.access_until<>end_at or e.display_until<>end_at then raise exception 'Intensive archive is still available';end if;
 payload:=claim_course_mail(eid);perform finish_course_mail(eid,(payload->>'claim_token')::uuid,'Welcome','local-ordinary-intensive',null);
 if claim_course_mail(eid) is not null then raise exception 'Closing email sent before day 30';end if;
 if not exists(select 1 from webinar_passes where course_enrollment_id=eid and valid_until=end_at) then raise exception 'Normal intensive lost webinar mechanism';end if;
 denied:=false;begin perform finish_intensive_review(eid,schedule,start_at);exception when others then denied:=true;end;
 if not denied then raise exception 'Ordinary purchase calendar changed by test finish';end if;
end $$;
rollback;
