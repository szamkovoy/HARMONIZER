/** Operator tool. `status` never starts anything. Start/cleanup require explicit flags. */
import {execFileSync} from 'node:child_process';
import {buildCourseSchedule,courseRunDates} from '../_legacy_web/app/api/_utils/courseSchedule.ts';
const [action,id,...flags]=process.argv.slice(2);
if(!['status','start','cleanup'].includes(action)||!id||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new Error('Usage: course-test.mjs status|start|cleanup UUID [--confirm-start|--confirm-cleanup] [--timed]');
const q=value=>`'${String(value).replaceAll("'","''")}'`;
function query(sql){
 const raw=execFileSync('supabase',['db','query','--linked',sql],{encoding:'utf8',maxBuffer:2*1024*1024});
 const result=JSON.parse(raw);if(!Array.isArray(result.rows))throw new Error('Unexpected database response');return result.rows;
}
const [grant]=query(`select e.id,e.course_slug,e.mode,e.status,e.schedule,e.buyer_email,e.timezone,e.started_at,e.next_mail_at,e.mail_position,e.last_error,e.completion_email_step_id,e.completion_mail_at,c.kind,c.access_days,c.day_card_extra_days,c.completion_email_step_id as configured_completion_email_step_id,
 (select jsonb_agg(jsonb_build_object('id',l.id,'gapDays',l.gap_days) order by l.position) from public.course_lessons l where l.course_slug=e.course_slug) as lessons
 from public.course_enrollments e join public.courses c on c.slug=e.course_slug where e.id=${q(id)}::uuid and e.mode='test';`);
if(!grant)throw new Error('Test enrolment not found');
if(grant.kind==='intensive')throw new Error('Для интенсива используйте scripts/intensive-test.mjs: два письма и отдельное завершение просмотра');
if(action==='status'){
 const totalLessons=grant.status==='prepared'?(grant.lessons?.length??0):grant.schedule.length;
 const total=totalLessons+Number(grant.status==='prepared'?!!grant.configured_completion_email_step_id:!!grant.completion_email_step_id);
 console.log(JSON.stringify({id,course:grant.course_slug,recipient:grant.buyer_email,status:grant.status,
  lessonsOpen:grant.schedule.filter(s=>Date.parse(s.opensAt)<=Date.now()).length,totalLessons,
  mailsSent:grant.mail_position,totalMails:total,completed:grant.status==='active'&&grant.mail_position===total,
  nextMailAt:grant.next_mail_at,error:grant.last_error},null,2));
}
if(action==='start'){
 if(!flags.includes('--confirm-start'))throw new Error('No start: explicit --confirm-start required after the user says «запускай»');
 if(grant.status!=='prepared')throw new Error('Test already started or revoked');
 if(!flags.includes('--timed')){
  const [result]=query(`select public.start_course_content_test(${q(id)}::uuid) as result;`);
  const r=result.result;
  console.log(JSON.stringify({id,status:'active',recipient:grant.buyer_email,testMode:'content',lessonsOpen:r.lessonCount,totalMails:r.totalMails,displayUntil:r.displayUntil,dispatchQueued:r.dispatchQueued},null,2));
 }else{
 const start=new Date().toISOString();const schedule=buildCourseSchedule(grant.lessons,start,grant.timezone,120);
 const dates=courseRunDates(schedule,grant.timezone,grant.access_days,grant.day_card_extra_days,!!grant.configured_completion_email_step_id,true);
 query(`select public.start_course_enrollment(${q(id)}::uuid,${q(JSON.stringify(schedule))}::jsonb,${q(start)}::timestamptz,${q(dates.accessUntil)}::timestamptz,${q(dates.displayUntil)}::timestamptz);`);
 console.log(JSON.stringify({id,status:'active',recipient:grant.buyer_email,schedule,...dates},null,2));
 }
}
if(action==='cleanup'){
 if(!flags.includes('--confirm-cleanup'))throw new Error('No cleanup: explicit --confirm-cleanup required after the user requests removal');
 query(`select public.cleanup_course_test(${q(id)}::uuid);`);console.log(JSON.stringify({id,removed:true}));
}
