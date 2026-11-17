import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {AppState} from 'react-native';
import {useAuth} from '@/modules/auth';
import type {CourseView} from '@shared/courses';
import {loadCourses} from './client';
type State={courses:CourseView[];error:boolean;loading:boolean;refresh:()=>Promise<void>};
const Context=createContext<State>({courses:[],error:false,loading:false,refresh:async()=>{}});
export function CoursesProvider({children}:{children:ReactNode}){
 const {authUser}=useAuth();const uid=authUser?.id;
 const [snapshot,setSnapshot]=useState<{uid:string|undefined;courses:CourseView[]}>({uid,courses:[]});
 const courses=snapshot.uid===uid?snapshot.courses:[];
 const [error,setError]=useState(false);const [loading,setLoading]=useState(false);
 const owner=useRef(uid);owner.current=uid;const pending=useRef<{uid:string;promise:Promise<void>}|null>(null);
 const refresh=useCallback(async()=>{
  if(!uid)return;if(pending.current?.uid===uid)return pending.current.promise;
  const work=(async()=>{setLoading(true);try{const result=await loadCourses();if(owner.current===uid){setSnapshot({uid,courses:result.courses});setError(false);}}
   catch{if(owner.current===uid)setError(true);}finally{if(owner.current===uid)setLoading(false);if(pending.current?.uid===uid)pending.current=null;}})();
  pending.current={uid,promise:work};return work;
 },[uid]);
 useEffect(()=>{setSnapshot({uid,courses:[]});setError(false);setLoading(false);void refresh();},[refresh,uid]);
 useEffect(()=>{const listener=AppState.addEventListener('change',state=>{if(state==='active')void refresh();});return()=>listener.remove();},[refresh]);
 useEffect(()=>{
  const times=courses.map(c=>c.nextChangeAt?Date.parse(c.nextChangeAt):Infinity).filter(t=>t>Date.now());const next=Math.min(...times);
  if(!Number.isFinite(next))return;
  const timer=setTimeout(()=>void refresh(),Math.min(2147483000,Math.max(100,next-Date.now()+100)));
  return()=>clearTimeout(timer);
 },[courses,refresh]);
 return <Context.Provider value={{courses,error,loading,refresh}}>{children}</Context.Provider>;
}
export const useCourses=()=>useContext(Context);
export function showsOnDay(c:CourseView,now=Date.now()){return c.state==='available'&&Date.parse(c.accessUntil)>now&&Date.parse(c.displayUntil)>now&&!!c.current;}
