import {createServiceSupabase,errorResponse,json,requireUserId} from '../../_utils/supabase';
import {listUserCourses} from '../../_utils/courseService';
export const runtime='nodejs';
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){try{
 const userId=await requireUserId(req);const {id}=await params;
 if(!/^[\da-f-]{36}$/i.test(id))return json({error:'Not found'},{status:404});
 const lessonId=new URL(req.url).searchParams.get('lessonId')||undefined;
 const course=(await listUserCourses(createServiceSupabase(),userId,lessonId,id))[0];
 if(!course||(lessonId&&!course.current))return json({error:'Not found'},{status:404});
 return json({course});
}catch(e){return errorResponse(e);}}
