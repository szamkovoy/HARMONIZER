import type { SupabaseClient } from '@supabase/supabase-js';
import type { CourseLesson, CourseView } from '@shared/courses';
import { buildCourseSchedule,courseRunDates,intensiveRunDates } from './courseSchedule';

export async function listUserCourses(db:SupabaseClient,userId:string,lessonId?:string,enrollmentId?:string):Promise<CourseView[]> {
  let q=db.from('course_enrollments').select('*').eq('user_id',userId).neq('status','prepared').order('started_at',{ascending:false}).order('created_at',{ascending:false}).order('id',{ascending:false});
  if(enrollmentId) q=q.eq('id',enrollmentId);
  const {data:enrollments,error}=await q; if(error) throw error;
  if(!enrollments?.length) return [];
  const slugs=[...new Set(enrollments.map(e=>e.course_slug))];
  const {data:courses,error:ce}=await db.from('courses').select('*').in('slug',slugs); if(ce)throw ce;
  const now=Date.now();
  // Future lesson content never leaves the server, even in a direct detail request.
  const released=(e:typeof enrollments[number])=>{
    const intensive=courses?.find(c=>c.slug===e.course_slug)?.kind==='intensive';
    if(e.status!=='active'||Date.parse(e.access_until)<=now)return [];
    if(intensive&&e.mode==='test'&&e.test_browse===true)return e.schedule;
    const open=e.schedule.filter((s:{opensAt:string})=>Date.parse(s.opensAt)<=now);
    return intensive?open.slice(-1):open;
  };
  const allowed=enrollments.flatMap(e=>released(e).map((s:{lessonId:string})=>s.lessonId));
  const {data:lessons,error:le}=allowed.length ? await db.from('course_lessons').select('id,course_slug,position,title,blocks,blocks_i18n').in('id',allowed) : {data:[],error:null}; if(le)throw le;
  return enrollments.map(e=>{
    const course=courses?.find(c=>c.slug===e.course_slug);if(!course)throw new Error('Course metadata missing');
    const state=e.status==='revoked'?'revoked':Date.parse(e.access_until)<=now?'expired':'available';
    const unlocked:CourseLesson[]=released(e).map((s:{lessonId:string})=>lessons?.find(l=>l.id===s.lessonId&&l.course_slug===e.course_slug)).filter(Boolean).map((l:CourseLesson&{blocks_i18n?:CourseLesson['blocksI18n']})=>({id:l.id,position:l.position,title:l.title,blocks:l.blocks,...(course.kind==='intensive'?{blocksI18n:l.blocks_i18n??{}}:{})}));
    const currentId=e.schedule.filter((s:{opensAt:string})=>Date.parse(s.opensAt)<=now).at(-1)?.lessonId;
    const current=lessonId?unlocked.find(l=>l.id===lessonId)??null:course.kind==='intensive'?unlocked.find(l=>l.id===currentId)??null:unlocked.at(-1)??null;
    const future=[...e.schedule.map((s:{opensAt:string})=>s.opensAt),e.display_until,e.access_until].filter((t:string)=>Date.parse(t)>now).sort((a:string,b:string)=>Date.parse(a)-Date.parse(b));
    return {id:e.id,slug:course.slug,title:course.title,kind:course.kind,titleI18n:course.title_i18n??{},reviewAllLessons:course.kind==='intensive'&&e.mode==='test'&&e.test_browse===true,...(course.kind==='intensive'?{currentUntil:e.schedule.find((s:{opensAt:string})=>Date.parse(s.opensAt)>now)?.opensAt??e.access_until}:{}),mode:e.mode,startedAt:e.started_at,accessUntil:e.access_until,displayUntil:e.display_until,landingUrl:course.landing_url,state,current,
      lessons:unlocked.map(({id,position,title})=>({id,position,title})),totalLessons:e.schedule.length,nextChangeAt:future[0]??null} as CourseView;
  });
}

export async function startPreparedCourse(db:SupabaseClient,id:string,testMode:'content'|'timed'='content') {
 const {data:e,error}=await db.from('course_enrollments').select('*,courses(kind)').eq('id',id).single();if(error)throw error;
 if(e.status!=='prepared')throw new Error('Этот запуск уже начат или отменён');
 if(e.mode==='test'&&testMode==='content'&&e.courses?.kind!=='intensive'){
  const {data,error:se}=await db.rpc('start_course_content_test',{p_id:id});if(se)throw se;
  return data as {id:string;start:string;schedule:import('./courseSchedule').CourseScheduleItem[];accessUntil:string;displayUntil:string;completionMailAt:string|null;testMode:'content';intervalSeconds:0;webinarInvites?:never};
 }
 const {data:lessons,error:le}=await db.from('course_lessons').select('id,gap_days').eq('course_slug',e.course_slug).order('position');if(le)throw le;
 const {data:c,error:ce}=await db.from('courses').select('access_days,day_card_extra_days,completion_email_step_id').eq('slug',e.course_slug).single();if(ce)throw ce;
 const start=new Date().toISOString();
 const intensive=e.courses?.kind==='intensive';
 if(intensive&&testMode==='timed')throw new Error('Для интенсивов используется просмотр всех уроков без сжатия календаря');
 const schedule=buildCourseSchedule((lessons??[]).map(l=>({id:l.id,gapDays:l.gap_days})),start,e.timezone,!intensive&&e.mode==='test'?120:undefined);
 if(!schedule.length)throw new Error('В курсе нет уроков');
 const dates=intensive?intensiveRunDates(schedule,e.timezone):courseRunDates(schedule,e.timezone,c.access_days,c.day_card_extra_days,!!c.completion_email_step_id,e.mode==='test');
 const {error:se}=await db.rpc(intensive?'start_intensive_enrollment':'start_course_enrollment',{p_id:id,p_schedule:schedule,p_start:start,p_access_until:dates.accessUntil,p_display_until:dates.displayUntil,...(intensive?{p_review:e.mode==='test'}:{})});if(se)throw se;
 let webinarInvites:{sent:number;failed:number}|undefined;
 if(e.mode==='normal'&&e.user_id){
  try{const {sendPassWebinarInvites}=await import('../account/webinarNotices');webinarInvites=await sendPassWebinarInvites(db,e.user_id);}
  catch(error){console.error('[courses] webinar invite failed',error);webinarInvites={sent:0,failed:1};}
 }
 return {id,start,schedule,...dates,...(intensive?{reviewAllLessons:e.mode==='test',totalMails:2,completionMailAt:e.mode==='test'?start:dates.completionMailAt}:{}),...(webinarInvites?{webinarInvites}:{})};
}

export async function finishIntensiveReview(db:SupabaseClient,id:string){
 const {data:e,error}=await db.from('course_enrollments').select('*').eq('id',id).eq('mode','test').single();if(error)throw error;
 const {data:lessons,error:le}=await db.from('course_lessons').select('id,gap_days').eq('course_slug',e.course_slug).order('position');if(le)throw le;
 const start=new Date().toISOString();
 const schedule=buildCourseSchedule((lessons??[]).map(l=>({id:l.id,gapDays:l.gap_days})),start,e.timezone);
 const {data,error:fe}=await db.rpc('finish_intensive_review',{p_id:id,p_schedule:schedule,p_start:start});if(fe)throw fe;return data;
}
