import type { SupabaseClient } from '@supabase/supabase-js';
import type { CourseLesson, CourseView } from '@shared/courses';
import { buildCourseSchedule,courseRunDates } from './courseSchedule';

export async function listUserCourses(db:SupabaseClient,userId:string,lessonId?:string,enrollmentId?:string):Promise<CourseView[]> {
  let q=db.from('course_enrollments').select('*').eq('user_id',userId).neq('status','prepared').order('started_at',{ascending:false}).order('created_at',{ascending:false}).order('id',{ascending:false});
  if(enrollmentId) q=q.eq('id',enrollmentId);
  const {data:enrollments,error}=await q; if(error) throw error;
  if(!enrollments?.length) return [];
  const slugs=[...new Set(enrollments.map(e=>e.course_slug))];
  const {data:courses,error:ce}=await db.from('courses').select('*').in('slug',slugs); if(ce)throw ce;
  const now=Date.now();
  // Future lesson content never leaves the server, even in a direct detail request.
  const allowed=enrollments.flatMap(e=>e.status==='active'&&Date.parse(e.access_until)>now ? e.schedule.filter((s:{opensAt:string})=>Date.parse(s.opensAt)<=now).map((s:{lessonId:string})=>s.lessonId):[]);
  const {data:lessons,error:le}=allowed.length ? await db.from('course_lessons').select('id,course_slug,position,title,blocks').in('id',allowed) : {data:[],error:null}; if(le)throw le;
  return enrollments.map(e=>{
    const course=courses?.find(c=>c.slug===e.course_slug);if(!course)throw new Error('Course metadata missing');
    const state=e.status==='revoked'?'revoked':Date.parse(e.access_until)<=now?'expired':'available';
    const unlocked:CourseLesson[]=state==='available'?e.schedule.filter((s:{opensAt:string})=>Date.parse(s.opensAt)<=now).map((s:{lessonId:string})=>lessons?.find(l=>l.id===s.lessonId&&l.course_slug===e.course_slug)).filter(Boolean):[];
    const current=lessonId?unlocked.find(l=>l.id===lessonId)??null:unlocked.at(-1)??null;
    const future=[...e.schedule.map((s:{opensAt:string})=>s.opensAt),e.display_until,e.access_until].filter((t:string)=>Date.parse(t)>now).sort((a:string,b:string)=>Date.parse(a)-Date.parse(b));
    return {id:e.id,slug:course.slug,title:course.title,mode:e.mode,startedAt:e.started_at,accessUntil:e.access_until,displayUntil:e.display_until,landingUrl:course.landing_url,state,current,
      lessons:unlocked.map(({id,position,title})=>({id,position,title})),totalLessons:e.schedule.length,nextChangeAt:future[0]??null} as CourseView;
  });
}

export async function startPreparedCourse(db:SupabaseClient,id:string,testMode:'content'|'timed'='content') {
 const {data:e,error}=await db.from('course_enrollments').select('*').eq('id',id).single();if(error)throw error;
 if(e.status!=='prepared')throw new Error('Этот запуск уже начат или отменён');
 if(e.mode==='test'&&testMode==='content'){
  const {data,error:se}=await db.rpc('start_course_content_test',{p_id:id});if(se)throw se;
  return data as {id:string;start:string;schedule:import('./courseSchedule').CourseScheduleItem[];accessUntil:string;displayUntil:string;completionMailAt:string|null;testMode:'content';intervalSeconds:0;webinarInvites?:never};
 }
 const {data:lessons,error:le}=await db.from('course_lessons').select('id,gap_days').eq('course_slug',e.course_slug).order('position');if(le)throw le;
 const {data:c,error:ce}=await db.from('courses').select('access_days,day_card_extra_days,completion_email_step_id').eq('slug',e.course_slug).single();if(ce)throw ce;
 const start=new Date().toISOString();
 const schedule=buildCourseSchedule((lessons??[]).map(l=>({id:l.id,gapDays:l.gap_days})),start,e.timezone,e.mode==='test'?120:undefined);
 if(!schedule.length)throw new Error('В курсе нет уроков');
 const dates=courseRunDates(schedule,e.timezone,c.access_days,c.day_card_extra_days,!!c.completion_email_step_id,e.mode==='test');
 const {error:se}=await db.rpc('start_course_enrollment',{p_id:id,p_schedule:schedule,p_start:start,p_access_until:dates.accessUntil,p_display_until:dates.displayUntil});if(se)throw se;
 let webinarInvites:{sent:number;failed:number}|undefined;
 if(e.mode==='normal'&&e.user_id){
  try{const {sendPassWebinarInvites}=await import('../account/webinarNotices');webinarInvites=await sendPassWebinarInvites(db,e.user_id);}
  catch(error){console.error('[courses] webinar invite failed',error);webinarInvites={sent:0,failed:1};}
 }
 return {id,start,schedule,...dates,...(webinarInvites?{webinarInvites}:{})};
}
