import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {AppState} from 'react-native';
import {useAuth} from '@/modules/auth';
import type {CourseView} from '@shared/courses';
import {loadCourses} from './client';
import {readCourseCache,saveCourseCache} from './cache';
import {useAppLocale} from '@/modules/i18n';
import {localizeCourse} from './state';
export {showsOnDay} from './state';

type State={courses:CourseView[];error:boolean;loading:boolean;fromCache:boolean;refresh:()=>Promise<void>};
const Context=createContext<State>({courses:[],error:false,loading:false,fromCache:false,refresh:async()=>{}});
export function CoursesProvider({children}:{children:ReactNode}){
  const {authUser}=useAuth();const uid=authUser?.id;
  const {locale}=useAppLocale();
  const [snapshot,setSnapshot]=useState<{uid:string|undefined;courses:CourseView[];fromCache:boolean}>({uid,courses:[],fromCache:false});
  const courses=useMemo(()=>snapshot.uid===uid?snapshot.courses.map(c=>localizeCourse(c,locale)):[],[snapshot,uid,locale]);
  const [error,setError]=useState(false);const [loading,setLoading]=useState(false);
  const owner=useRef(uid);owner.current=uid;
  const freshVersion=useRef(0);
  const pending=useRef<{uid:string;promise:Promise<void>}|null>(null);
  const refresh=useCallback(async()=>{
    if(!uid)return;if(pending.current?.uid===uid)return pending.current.promise;
    const work=(async()=>{setLoading(true);try{
      const result=await loadCourses();
      if(owner.current===uid){freshVersion.current++;setSnapshot({uid,courses:result.courses,fromCache:false});setError(false);void saveCourseCache(uid,result.courses);}
    }catch{if(owner.current===uid)setError(true);}
    finally{if(owner.current===uid)setLoading(false);if(pending.current?.uid===uid)pending.current=null;}})();
    pending.current={uid,promise:work};return work;
  },[uid]);
  useEffect(()=>{
    let live=true;setSnapshot({uid,courses:[],fromCache:false});setError(false);setLoading(false);
    const version=freshVersion.current;
    if(uid)void readCourseCache(uid).then(cached=>{if(live&&owner.current===uid&&freshVersion.current===version&&cached)setSnapshot({uid,courses:cached,fromCache:true});});
    void refresh();return()=>{live=false;};
  },[refresh,uid]);
  useEffect(()=>{const sub=AppState.addEventListener('change',state=>{if(state==='active')void refresh();});return()=>sub.remove();},[refresh]);
  useEffect(()=>{
    const next=Math.min(...courses.map(c=>c.nextChangeAt?Date.parse(c.nextChangeAt):Infinity).filter(t=>t>Date.now()));
    if(!Number.isFinite(next))return;
    const timer=setTimeout(()=>void refresh(),Math.min(2147483000,Math.max(100,next-Date.now()+100)));return()=>clearTimeout(timer);
  },[courses,refresh]);
  useEffect(()=>{
    if(!error||!uid)return;
    const timer=setTimeout(()=>{if(AppState.currentState==='active')void refresh();},15000);return()=>clearTimeout(timer);
  },[error,loading,refresh,uid]);
  return <Context.Provider value={{courses,error,loading,fromCache:snapshot.uid===uid&&snapshot.fromCache,refresh}}>{children}</Context.Provider>;
}
export const useCourses=()=>useContext(Context);
