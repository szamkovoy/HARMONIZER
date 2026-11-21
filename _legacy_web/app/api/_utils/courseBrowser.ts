import type {SupabaseClient} from '@supabase/supabase-js';
import {hasCourseAccess,courseAccessNotice} from '@shared/courseAccess';
import {listUserCourses} from './courseService';
import {courseMarkdownHtml} from './courseSchedule';
import {vimeoEmbedUrl} from './vimeo';

/** Read-only link to one grant and one released lesson; no account data is returned. */
export async function browserCourseLesson(db:SupabaseClient,enrollmentId:string,lessonId:string) {
 const {data:grant,error}=await db.from('course_enrollments').select('user_id,course_slug').eq('id',enrollmentId).neq('status','prepared').maybeSingle();
 if(error)throw error;
 if(!grant?.user_id)return null;
 const {data:lesson,error:le}=await db.from('course_lessons').select('id').eq('id',lessonId).eq('course_slug',grant.course_slug).maybeSingle();
 if(le)throw le;
 if(!lesson)return null;
 const course=(await listUserCourses(db,grant.user_id,lessonId,enrollmentId))[0];
 if(!course)return null;
 if(!hasCourseAccess(course))return {state:course.state==='revoked'?'revoked':'expired',courseTitle:course.title,notice:courseAccessNotice(course,'ru')};
 if(!course.current)return null;
 return {state:'available',courseTitle:course.title,lessonTitle:course.current.title,accessUntil:course.accessUntil,
  // Intensives keep their daily boundary, even if an operator opens such a link.
  refreshAt:course.currentUntil??course.accessUntil,
  blocks:course.current.blocks.map(block=>block.type==='text'
   ?{type:'text',html:courseMarkdownHtml(block.markdown)}
   :{type:'video',src:vimeoEmbedUrl(block.vimeoId)})};
}
