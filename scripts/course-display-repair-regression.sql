-- LOCAL DISPOSABLE DATABASE ONLY. Reapply the repair to simulate a completed legacy test.
insert into auth.users values('00000000-0000-4000-8000-000000000022','display@example.test');
insert into public.users values('00000000-0000-4000-8000-000000000022','Display','ru','Europe/Moscow');
insert into email_contacts(user_id,email,email_normalized) values('00000000-0000-4000-8000-000000000022','display@example.test','display@example.test');
create temporary table expected_course_display(id uuid, snapshot jsonb);
do $$
declare eid uuid; schedule jsonb; last_lesson timestamptz;
begin
 select jsonb_agg(jsonb_build_object('lessonId',id,'opensAt',now()-interval '1 day'+(position-1)*interval '2 minutes','mailAt',now()-interval '1 day'+(position-1)*interval '2 minutes') order by position)
 into schedule from course_lessons where course_slug='fixture-completion';
 last_lesson:=(schedule->-1->>'opensAt')::timestamptz;
 eid:=prepare_course_test('00000000-0000-4000-8000-000000000022','fixture-completion','Europe/Moscow');
 perform start_course_enrollment(eid,schedule,(schedule->0->>'opensAt')::timestamptz,last_lesson+interval '90 days',last_lesson+interval '3 days');
 update course_enrollments set mail_position=8,next_mail_at=null where id=eid;
 insert into expected_course_display select id,to_jsonb(e) from course_enrollments e where id=eid;
 update course_enrollments set display_until=last_lesson+interval '2 minutes' where id=eid;
end$$;
\ir ../supabase/migrations/20261118050000_course_display_and_lesson_title.sql
-- Run twice: a repair must neither extend the date again nor restart completed mail.
\ir ../supabase/migrations/20261118050000_course_display_and_lesson_title.sql
do $$begin
 if exists(select 1 from course_enrollments e join expected_course_display x using(id) where to_jsonb(e) is distinct from x.snapshot)
 then raise exception 'Display repair changed delivery, access, content, or the exact last-lesson deadline';end if;
end$$;
select cleanup_course_test(id) from expected_course_display;
