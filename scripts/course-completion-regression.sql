-- LOCAL DISPOSABLE DATABASE ONLY. Run after the generic fixture import and all course migrations.
begin;
insert into auth.users values('00000000-0000-4000-8000-000000000021','completion@example.test');
insert into public.users values('00000000-0000-4000-8000-000000000021','Completion','ru','Europe/Moscow');
insert into email_contacts(user_id,email,email_normalized) values('00000000-0000-4000-8000-000000000021','completion@example.test','completion@example.test');
do $$
declare eid uuid; mail_id uuid; step uuid; payload jsonb; token uuid; schedule jsonb; last_lesson timestamptz;
 display_end timestamptz; access_end timestamptz; closing_at timestamptz; original_pass_end timestamptz; rejected boolean;
begin
 if (select count(*) from course_lessons where course_slug='fixture-completion')<>7 then raise exception 'Fake eighth lesson';end if;
 select completion_email_step_id into step from courses where slug='fixture-completion';
 if step is null or exists(select 1 from course_lessons where email_step_id=step) then raise exception 'Completion linked to lesson';end if;
 if (select count(*) from email_automation_steps where automation_id=(select automation_id from courses where slug='fixture-completion'))<>8 then raise exception 'Expected eight letters';end if;
 if has_function_privilege('anon','public.start_course_enrollment(uuid,jsonb,timestamptz,timestamptz,timestamptz)','EXECUTE') then raise exception 'Public start allowed';end if;
 if has_table_privilege('authenticated','public.course_enrollments','SELECT') then raise exception 'Public entitlement table allowed';end if;
 last_lesson:=date_trunc('day',now() at time zone 'Europe/Moscow') at time zone 'Europe/Moscow'-interval '5 days';
 select jsonb_agg(jsonb_build_object('lessonId',id,'opensAt',last_lesson-(23-day_offset)*interval '1 day','mailAt',last_lesson-(23-day_offset)*interval '1 day'+interval '7 hours') order by position)
 into schedule from course_lessons l join (values(1,0),(2,2),(3,9),(4,12),(5,16),(6,19),(7,23)) d(pos,day_offset) on l.position=d.pos where course_slug='fixture-completion';
 display_end:=last_lesson+interval '3 days';access_end:=last_lesson+interval '90 days';closing_at:=display_end+interval '7 hours';
 eid:=prepare_course_test('00000000-0000-4000-8000-000000000021','fixture-completion','Europe/Moscow');
 update course_enrollments set mode='normal' where id=eid;
 perform start_course_enrollment(eid,schedule,(schedule->0->>'opensAt')::timestamptz,access_end,display_end);
 if (select completion_mail_at from course_enrollments where id=eid)<>closing_at then raise exception 'Wrong morning completion time';end if;
 select valid_until into original_pass_end from webinar_passes where course_enrollment_id=eid;
 if original_pass_end<>last_lesson+interval '5 days' then raise exception 'Completion extends webinar window';end if;
 -- Importing the same content must not enqueue mail or rewrite current grants.
 for n in 0..6 loop
  payload:=claim_course_mail(eid);token:=(payload->>'claim_token')::uuid;
  if token is null then raise exception 'Missing lesson letter %',n;end if;
  perform finish_course_mail(eid,token,'Lesson','local-lesson-'||n,null);
 end loop;
 if (select next_mail_at from course_enrollments where id=eid)<>closing_at then raise exception 'Closing mail not queued';end if;
 payload:=claim_course_mail(eid);token:=(payload->>'claim_token')::uuid;
 perform finish_course_mail(eid,token,'Completion',null,'simulated retry');
 if (select mail_position from course_enrollments where id=eid)<>7 then raise exception 'Closing failure skipped';end if;
 if (select display_until from course_enrollments where id=eid)<>display_end then raise exception 'Failed mail moves Day cutoff';end if;
 update course_enrollments set next_mail_at=now()-interval '1 second' where id=eid;
 payload:=claim_course_mail(eid);token:=(payload->>'claim_token')::uuid;
 perform finish_course_mail(eid,token,'Completion','local-completion',null);
 if (select status from course_enrollments where id=eid)<>'active' then raise exception 'Completion revokes archive';end if;
 if (select mail_position from course_enrollments where id=eid)<>8 or (select next_mail_at from course_enrollments where id=eid) is not null then raise exception 'Closing did not finish';end if;
 if (select status from email_automation_enrollments where course_enrollment_id=eid)<>'completed' then raise exception 'Email automation not completed';end if;
 if (select e.schedule from course_enrollments e where e.id=eid)<>schedule or (select display_until from course_enrollments where id=eid)<>display_end or (select access_until from course_enrollments where id=eid)<>access_end then raise exception 'Completion changed content/deadlines';end if;
 if (select valid_until from webinar_passes where course_enrollment_id=eid)<>original_pass_end then raise exception 'Completion changed webinar window';end if;
 if claim_course_mail(eid) is not null then raise exception 'Completed letter claimed twice';end if;
 if (select count(*) from email_automation_sends where step_id=step and status='sent')<>1 then raise exception 'Duplicate completion letter';end if;
 delete from course_enrollments where id=eid;
 -- Accelerated test: seven real releases, then a closing letter two minutes later; Day stays for three days.
 select jsonb_agg(jsonb_build_object('lessonId',id,'opensAt',now()+(position-1)*interval '2 minutes','mailAt',now()+(position-1)*interval '2 minutes') order by position) into schedule from course_lessons where course_slug='fixture-completion';
 last_lesson:=(schedule->-1->>'opensAt')::timestamptz;
 eid:=prepare_course_test('00000000-0000-4000-8000-000000000021','fixture-completion','Europe/Moscow');
 rejected:=false;
 begin perform start_course_enrollment(eid,schedule,now(),last_lesson+interval '90 days',last_lesson+interval '2 minutes');exception when others then rejected:=true;end;
 if not rejected then raise exception 'Test silently accepted wrong display window';end if;
 perform start_course_enrollment(eid,schedule,now(),last_lesson+interval '90 days',last_lesson+interval '3 days');
 if (select display_until from course_enrollments where id=eid)<>last_lesson+interval '3 days' then raise exception 'Test Day window compressed';end if;
 if (select completion_mail_at from course_enrollments where id=eid)<>last_lesson+interval '2 minutes' then raise exception 'Test closing not compressed';end if;
 if exists(select 1 from webinar_passes where course_enrollment_id=eid) then raise exception 'Test grants real webinar access';end if;
 if jsonb_array_length((select e.schedule from course_enrollments e where e.id=eid))<>7 then raise exception 'Test acquired fake lesson';end if;
 update course_enrollments set mail_position=7,next_mail_at=completion_mail_at where id=eid;
 if claim_course_mail(eid) is not null then raise exception 'Future completion claimed';end if;
 perform cleanup_course_test(eid);
 if exists(select 1 from course_enrollments where id=eid) then raise exception 'Test cleanup failed';end if;
end$$;
rollback;
