import {createServiceSupabase,errorResponse,json,requireUserId} from '../_utils/supabase';
import {listUserCourses} from '../_utils/courseService';
export const runtime='nodejs';
export async function GET(req:Request){try{const userId=await requireUserId(req);return json({courses:await listUserCourses(createServiceSupabase(),userId)});}catch(e){return errorResponse(e);}}
