-- Run after the standalone fixture and the two course migrations in an isolated database.
begin;
insert into auth.users values('00000000-0000-4000-8000-000000000001','owner@example.test'),('00000000-0000-4000-8000-000000000002','other@example.test');
insert into public.users values('00000000-0000-4000-8000-000000000001','Owner','ru','Europe/Moscow'),('00000000-0000-4000-8000-000000000002','Other','ru','UTC');
insert into email_contacts(user_id,email,email_normalized) values('00000000-0000-4000-8000-000000000001','owner@example.test','owner@example.test');
do $$
declare eid uuid; prepared_again uuid; payload jsonb; schedule jsonb; token uuid; denied boolean:=false;
begin
 if has_function_privilege('anon','public.claim_course_mail(uuid)','EXECUTE') then raise exception 'anon can claim';end if;
 if has_table_privilege('authenticated','public.course_lessons','SELECT') then raise exception 'direct lesson read allowed';end if;
 eid:=prepare_course_test('00000000-0000-4000-8000-000000000001','month-health','Europe/Moscow');
 prepared_again:=prepare_course_test('00000000-0000-4000-8000-000000000001','month-health','Europe/Moscow');
 if eid<>prepared_again then raise exception 'prepare duplicates test';end if;
 if claim_course_mail(eid) is not null then raise exception 'prepared test can send';end if;
 if exists(select 1 from email_automation_enrollments) then raise exception 'prepare enrolled email';end if;
 select jsonb_agg(jsonb_build_object('lessonId',id,'opensAt',now()+(position-1)*interval '2 minutes','mailAt',now()+(position-1)*interval '2 minutes') order by position) into schedule from course_lessons where course_slug='month-health';
 perform start_course_enrollment(eid,schedule,now(),now()+interval '90 days',now()+interval '3 days');
 begin perform start_course_enrollment(eid,schedule,now(),now()+interval '90 days',now()+interval '3 days');exception when others then denied:=true;end;
 if not denied then raise exception 'duplicate start accepted';end if;
 payload:=claim_course_mail(eid);token:=(payload->>'claim_token')::uuid;
 if token is null then raise exception 'first step not claimable';end if;
 if claim_course_mail(eid) is not null then raise exception 'concurrent claim accepted';end if;
 perform finish_course_mail(eid,token,'Test','fake-first-provider-id',null);
 if (select mail_position from course_enrollments where id=eid)<>1 then raise exception 'first success not advanced';end if;
 if claim_course_mail(eid) is not null then raise exception 'future step claimed early';end if;
 for n in 1..5 loop
  update course_enrollments set next_mail_at=now()-interval '1 second' where id=eid;
  payload:=claim_course_mail(eid);token:=(payload->>'claim_token')::uuid;
  perform finish_course_mail(eid,token,'Test',null,'simulated failure');
 end loop;
 if not (select mail_paused from course_enrollments where id=eid) then raise exception 'retries did not pause';end if;
 if (select mail_position from course_enrollments where id=eid)<>1 then raise exception 'failure skipped step';end if;
 perform cleanup_course_test(eid);
 if exists(select 1 from course_enrollments where id=eid) or exists(select 1 from email_automation_enrollments) or exists(select 1 from email_automation_sends) then raise exception 'test residue';end if;
 if (select count(*) from auth.users)<>2 or (select count(*) from email_contacts)<>1 then raise exception 'cleanup removed account/contact';end if;
 if exists(select 1 from email_automation_steps where sent_count<>0 or failed_count<>0) then raise exception 'test counters remain';end if;
 eid:=prepare_course_test('00000000-0000-4000-8000-000000000001','month-health','Europe/Moscow');
 perform start_course_enrollment(eid,schedule,now(),now()+interval '90 days',now()+interval '3 days');
 update email_automation_enrollments set status='cancelled' where course_enrollment_id=eid;
 if claim_course_mail(eid) is not null or not (select mail_paused from course_enrollments where id=eid) then raise exception 'cancellation did not stop mail';end if;
 if (select status from course_enrollments where id=eid)<>'active' then raise exception 'mail cancellation revoked content';end if;
 update course_enrollments set user_id=null where id=eid;
 if (select status from course_enrollments where id=eid)<>'revoked' then raise exception 'account removal left course active';end if;
 perform cleanup_course_test(eid);
end $$;
rollback;
