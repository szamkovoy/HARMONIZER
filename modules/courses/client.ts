import {getSupabaseAccessToken} from '@/services/supabase';
import {getCommunicatorApiBaseUrl} from '@/services/communicatorConfig';
import type {CourseView} from '@shared/courses';
export async function fetchCourseData<T>(path=''):Promise<T>{
 const token=await getSupabaseAccessToken();const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),15000);
 try{const res=await fetch(`${getCommunicatorApiBaseUrl()}/api/courses${path}`,{headers:{Authorization:`Bearer ${token}`},signal:abort.signal});
 if(!res.ok)throw new Error('COURSES_UNAVAILABLE');return await res.json() as T;
 }finally{clearTimeout(timer);}
}
export const loadCourses=()=>fetchCourseData<{courses:CourseView[]}>();
export const loadCourse=(id:string,lessonId?:string)=>fetchCourseData<{course:CourseView}>(`/${encodeURIComponent(id)}${lessonId?`?lessonId=${encodeURIComponent(lessonId)}`:''}`);
