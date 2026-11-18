import {createServiceSupabase,errorResponse,json,requireAdmin} from '../../../_utils/supabase';
import {startPreparedCourse} from '../../../_utils/courseService';
export const runtime='nodejs';
export async function POST(req:Request){try{
 await requireAdmin(req);const db=createServiceSupabase();const body=await req.json();
 if(body.action==='prepare'){
  const courseSlug=body.courseSlug??'month-health';
  if(typeof courseSlug!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(courseSlug))return json({error:'Invalid course slug'},{status:400});
  if(typeof body.email!=='string')return json({error:'Email required'},{status:400});
  const {data:c,error}=await db.from('email_contacts').select('user_id').eq('email_normalized',body.email.trim().toLowerCase()).single();if(error)throw error;
  if(!c.user_id)return json({error:'Сначала войдите в приложение с этой почтой'},{status:400});
  const {data:u,error:ue}=await db.from('users').select('tz').eq('id',c.user_id).single();if(ue)throw ue;
  const {data:id,error:pe}=await db.rpc('prepare_course_test',{p_user_id:c.user_id,p_slug:courseSlug,p_timezone:u.tz||'Europe/Moscow'});if(pe)throw pe;
  return json({id,status:'prepared',intervalSeconds:120,started:false});
 }
 if(body.action==='start'&&typeof body.id==='string'&&body.confirmStart===true)return json(await startPreparedCourse(db,body.id));
 if(body.action==='cleanup'&&typeof body.id==='string'&&body.confirmCleanup===true){
  const {error}=await db.rpc('cleanup_course_test',{p_id:body.id});if(error)throw error;
  return json({id:body.id,removed:true});
 }
 return json({error:'Explicit start confirmation required'},{status:400});
}catch(e){return errorResponse(e);}}
