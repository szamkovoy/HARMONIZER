import {createServiceSupabase,errorResponse,json,requireAdmin} from '../../../../_utils/supabase';
import {validateCourseLesson} from '../../../../_utils/courseLessonEditor';
export const runtime='nodejs';
type Ctx={params:Promise<{id:string}>};
export async function GET(req:Request,ctx:Ctx){
 try{
  await requireAdmin(req);const {id}=await ctx.params;const db=createServiceSupabase();
  const {data:lesson,error}=await db.from('course_lessons').select('id,course_slug,title,blocks,email_step_id').eq('id',id).maybeSingle();if(error)throw error;
  if(!lesson)return json({error:'Урок не найден'},{status:404});
  const {data:course,error:ce}=await db.from('courses').select('title,automation_id').eq('slug',lesson.course_slug).single();if(ce)throw ce;
  return json({lesson,course});
 }catch(e){return errorResponse(e);}
}
export async function PATCH(req:Request,ctx:Ctx){
 try{
  await requireAdmin(req);const {id}=await ctx.params;const db=createServiceSupabase();
  const {data:old,error}=await db.from('course_lessons').select('blocks').eq('id',id).maybeSingle();if(error)throw error;
  if(!old)return json({error:'Урок не найден'},{status:404});
  let patch;try{patch=validateCourseLesson(await req.json(),old.blocks);}catch(e){return json({error:e instanceof Error?e.message:'Проверьте урок'},{status:400});}
  const {data:lesson,error:saveError}=await db.from('course_lessons').update(patch).eq('id',id).select('id,course_slug,title,blocks,email_step_id').single();if(saveError)throw saveError;
  return json({lesson});
 }catch(e){return errorResponse(e);}
}
