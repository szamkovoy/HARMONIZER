-- Run after course fixture, course schema/content, webinar fixture and course webinar migration.
begin;
insert into auth.users values('00000000-0000-4000-8000-000000000001','owner@example.test'),('00000000-0000-4000-8000-000000000002','other@example.test');
insert into public.users values('00000000-0000-4000-8000-000000000001','Owner','ru','Europe/Moscow'),('00000000-0000-4000-8000-000000000002','Other','ru','UTC');
insert into email_contacts(user_id,email,email_normalized) values('00000000-0000-4000-8000-000000000001','owner@example.test','owner@example.test');
insert into payment_contracts values('paid-owner','active'),('paid-other','active');
insert into webinar_passes(user_id,contract_id,credits,valid_from,valid_until) values
 ('00000000-0000-4000-8000-000000000001','paid-owner',2,now()-interval '1 hour',now()+interval '10 days'),
 ('00000000-0000-4000-8000-000000000002','paid-other',1,now()-interval '1 hour',now()+interval '10 days');
insert into webinars values
 ('00000000-0000-4000-8000-000000000011',now()+interval '1 hour',true),
 ('00000000-0000-4000-8000-000000000012',now()+interval '2 hours',true),
 ('00000000-0000-4000-8000-000000000013',now()-interval '30 minutes',true),
 ('00000000-0000-4000-8000-000000000014',now()+interval '31 days',true),
 ('00000000-0000-4000-8000-000000000015',now()+interval '3 hours',false);
-- Existing registration must survive course revocation and must not consume a pass credit.
insert into webinar_registrations(webinar_id,user_id) values('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001');
do $$
declare eid uuid;tid uuid;pid uuid;schedule jsonb;
begin
 tid:=prepare_course_test('00000000-0000-4000-8000-000000000001','month-health','Europe/Moscow');
 if exists(select 1 from webinar_passes where course_enrollment_id=tid) then raise exception 'prepared rehearsal has a pass';end if;
 select jsonb_agg(jsonb_build_object('lessonId',id,'opensAt',now()+(position-1)*interval '2 minutes','mailAt',now()+(position-1)*interval '2 minutes') order by position) into schedule from course_lessons;
 perform start_course_enrollment(tid,schedule,now(),now()+interval '90 days',now()+interval '3 days');
 if exists(select 1 from webinar_passes where course_enrollment_id=tid) then raise exception 'rehearsal grants real webinar access';end if;
 perform cleanup_course_test(tid);

 insert into course_enrollments(course_slug,user_id,buyer_email,source_key,timezone,mode)
 values('month-health','00000000-0000-4000-8000-000000000001','owner@example.test','normal-fixture','Europe/Moscow','normal') returning id into eid;
 -- Eight lessons, last release at D+26, webinar cutoff at D+31.
 select jsonb_agg(jsonb_build_object('lessonId',id,'opensAt',now()+case position when 1 then 0 when 2 then 2 when 3 then 9 when 4 then 12 when 5 then 16 when 6 then 19 when 7 then 23 else 26 end*interval '1 day','mailAt',now()+case position when 1 then 0 when 2 then 2 when 3 then 9 when 4 then 12 when 5 then 16 when 6 then 19 when 7 then 23 else 26 end*interval '1 day') order by position) into schedule from course_lessons;
 perform start_course_enrollment(eid,schedule,now(),now()+interval '116 days',now()+interval '29 days');
 select id into pid from webinar_passes where course_enrollment_id=eid;
 if pid is null then raise exception 'normal course missing pass';end if;
 if (select valid_until from webinar_passes where id=pid)<>now()+interval '31 days' then raise exception 'wrong cutoff';end if;
 if (select credits from webinar_passes where id=pid)<>1000000 then raise exception 'unexpected course credit cap';end if;
 if not exists(select 1 from webinar_registrations where pass_id=pid and webinar_id='00000000-0000-4000-8000-000000000012') then raise exception 'eligible webinar not registered';end if;
 if exists(select 1 from webinar_registrations where pass_id=pid and webinar_id in('00000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000014','00000000-0000-4000-8000-000000000015')) then raise exception 'outside-window or draft admitted';end if;
 perform apply_webinar_passes('00000000-0000-4000-8000-000000000001');
 if exists(select 1 from webinar_registrations r join webinar_passes p on p.id=r.pass_id where p.contract_id='paid-owner' and r.webinar_id in('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000015')) then raise exception 'paid credits consumed while course covers webinar';end if;
 if (select count(*) from webinar_passes where course_enrollment_id=eid)<>1 then raise exception 'duplicate course pass';end if;
 update webinars set is_published=true where id='00000000-0000-4000-8000-000000000015';
 perform apply_webinar_passes('00000000-0000-4000-8000-000000000001');
 if not exists(select 1 from webinar_registrations where pass_id=pid and webinar_id='00000000-0000-4000-8000-000000000015') then raise exception 'newly published webinar not covered';end if;
 perform apply_webinar_passes('00000000-0000-4000-8000-000000000002');
 if (select count(*) from webinar_registrations where user_id='00000000-0000-4000-8000-000000000002')<>1 then raise exception 'ordinary paid pass credit cap changed';end if;
 update course_enrollments set status='revoked' where id=eid;
 if (select status from webinar_passes where id=pid)<>'revoked' or exists(select 1 from webinar_registrations where pass_id=pid) then raise exception 'revocation left access';end if;
 if not exists(select 1 from webinar_registrations where webinar_id='00000000-0000-4000-8000-000000000011' and user_id='00000000-0000-4000-8000-000000000001' and pass_id is null) then raise exception 'unrelated registration removed';end if;
 delete from course_enrollments where id=eid;
 if exists(select 1 from webinar_passes where id=pid) then raise exception 'deleted course retained pass';end if;
 if (select count(*) from webinar_passes where contract_id is not null)<>2 then raise exception 'other paid passes removed';end if;
end $$;
rollback;
