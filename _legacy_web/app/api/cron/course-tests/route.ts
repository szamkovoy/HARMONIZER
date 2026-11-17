import {cronSecretDenied} from '../../_utils/emailCronIdle';
import {createServiceSupabase,errorResponse,json} from '../../_utils/supabase';
import {runCourseEmails} from '../../_utils/courseMailRunner';
export const runtime='nodejs';export const maxDuration=120;
export async function POST(req:Request){const denied=cronSecretDenied(req);if(denied)return denied;try{return json(await runCourseEmails(createServiceSupabase(),true));}catch(e){return errorResponse(e);}}
