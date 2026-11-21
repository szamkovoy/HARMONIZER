import {createServiceSupabase,errorResponse} from '../../_utils/supabase';
import {corsJson,corsPreflight,withCors} from '../../account/_utils';
import {browserCourseLesson} from '../../_utils/courseBrowser';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const OPTIONS=corsPreflight;
export async function GET(req:Request){try{
 const params=new URL(req.url).searchParams;
 const enrollmentId=params.get('enrollment')??'';const lessonId=params.get('lesson')??'';
 if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(enrollmentId)||!/^[-a-zA-Z0-9_]{1,150}$/.test(lessonId))return corsJson({error:'not_found'},{status:404});
 const result=await browserCourseLesson(createServiceSupabase(),enrollmentId,lessonId);
 return result?corsJson(result):corsJson({error:'not_found'},{status:404});
}catch(error){return withCors(errorResponse(error));}}
