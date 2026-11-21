import {getSupabaseAccessToken} from '@/services/supabase';
import {getCommunicatorApiBaseUrl} from '@/services/communicatorConfig';
import {withTransientNetworkRetry} from '@/services/withTransientNetworkRetry';
import {logRuntimeEvent} from '@/services/runtimeDiagnostics';
import type {CourseView} from '@shared/courses';

export class CourseRequestError extends Error {
  constructor(public readonly status:number) {super(`Courses HTTP ${status}`);this.name='CourseRequestError';}
}
export async function fetchCourseData<T>(path=''):Promise<T>{
  const token=await getSupabaseAccessToken();
  const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),15000);
  try {
    return await withTransientNetworkRetry(async()=>{
      const res=await fetch(`${getCommunicatorApiBaseUrl()}/api/courses${path}`,{headers:{Authorization:`Bearer ${token}`},signal:abort.signal});
      if(!res.ok)throw new CourseRequestError(res.status);
      return await res.json() as T;
    },{signal:abort.signal});
  } catch(error) {
    logRuntimeEvent('courses_load_failed',{status:error instanceof CourseRequestError?error.status:null,detail:error instanceof Error?error.name:'unknown',detailRequest:!!path},'warn');
    throw error;
  } finally {clearTimeout(timer);}
}
export const loadCourses=()=>fetchCourseData<{courses:CourseView[]}>();
export const loadCourse=(id:string,lessonId?:string)=>fetchCourseData<{course:CourseView}>(`/${encodeURIComponent(id)}${lessonId?`?lessonId=${encodeURIComponent(lessonId)}`:''}`);
