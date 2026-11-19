/** CLI-only operator path; no browser clicking and no implicit email sends. */
import {execFileSync} from 'node:child_process';
import {buildCourseSchedule,intensiveRunDates} from '../_legacy_web/app/api/_utils/courseSchedule.ts';
const [action,target,...flags]=process.argv.slice(2);
const q=value=>`'${String(value).replaceAll("'","''")}'`;
const query=sql=>JSON.parse(execFileSync('supabase',['db','query','--linked',sql],{encoding:'utf8',maxBuffer:2*1024*1024})).rows;
if(!['prepare','status','start','finish'].includes(action)||!target)throw new Error('tsx scripts/intensive-test.mjs prepare intensive-SLUG | status|start|finish UUID [--confirm-start|--confirm-finish]');
if(action==='prepare'){
 if(!/^intensive-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(target))throw new Error('Неверный код интенсива');
 const [row]=query(`select public.prepare_course_test(u.id,${q(target)},coalesce(u.tz,'Europe/Moscow')) as id from public.users u join auth.users a on a.id=u.id where lower(a.email)='sergei@zamkovoi.yoga' and exists(select 1 from courses where slug=${q(target)} and kind='intensive');`);
 if(!row)throw new Error('Интенсив или тестовый аккаунт не найден');console.log(JSON.stringify({id:row.id,status:'prepared',sent:false}));
}else{
 if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(target))throw new Error('Неверный ID теста');
 const [e]=query(`select e.*,c.kind,(select jsonb_agg(jsonb_build_object('id',id,'gapDays',gap_days) order by position) from course_lessons where course_slug=c.slug) as lessons from course_enrollments e join courses c on c.slug=e.course_slug where e.id=${q(target)}::uuid and e.mode='test' and c.kind='intensive' and e.buyer_email='sergei@zamkovoi.yoga';`);
 if(!e)throw new Error('Тест интенсива не найден');
 if(action==='status')console.log(JSON.stringify({id:e.id,course:e.course_slug,status:e.status,reviewAllLessons:e.test_browse,mailsSent:e.mail_position,totalMails:2,error:e.last_error,nextMailAt:e.next_mail_at,displayUntil:e.display_until}));
 else{
  const start=new Date().toISOString();const schedule=buildCourseSchedule(e.lessons,start,e.timezone);const dates=intensiveRunDates(schedule,e.timezone);
  if(action==='start'){
   if(!flags.includes('--confirm-start')||e.status!=='prepared')throw new Error('Нужны отдельная команда Сергея на запуск и --confirm-start; повторный запуск запрещён');
   query(`select public.start_intensive_enrollment(${q(e.id)}::uuid,${q(JSON.stringify(schedule))}::jsonb,${q(start)}::timestamptz,${q(dates.accessUntil)}::timestamptz,${q(dates.displayUntil)}::timestamptz,true);`);
   console.log(JSON.stringify({id:e.id,reviewAllLessons:true,mailQueue:2,recipient:e.buyer_email,started:true}));
  }else{
   if(!flags.includes('--confirm-finish'))throw new Error('Нужна команда «проверил» и --confirm-finish');
   const [result]=query(`select public.finish_intensive_review(${q(e.id)}::uuid,${q(JSON.stringify(schedule))}::jsonb,${q(start)}::timestamptz) as result;`);console.log(JSON.stringify(result.result));
  }
 }
}
