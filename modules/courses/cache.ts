import {Platform} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type {CourseView} from '@shared/courses';
import {courseMetadata} from './state';

const prefix='harmonizer.courses.meta.v1';
const maxAge=30*86400_000;
const queues=new Map<string,Promise<void>>();
const keyFor=(uid:string)=>`${prefix}.${uid.replace(/[^a-zA-Z0-9_-]/g,'_')}`;
async function get(key:string){return Platform.OS==='web'?globalThis.localStorage?.getItem(key)??null:SecureStore.getItemAsync(key);}
async function put(key:string,value:string){if(Platform.OS==='web')globalThis.localStorage?.setItem(key,value);else await SecureStore.setItemAsync(key,value);}
async function remove(key:string){if(Platform.OS==='web')globalThis.localStorage?.removeItem(key);else await SecureStore.deleteItemAsync(key);}
type Manifest={generation:string;count:number};
function manifest(raw:string|null):Manifest|null {
  if(!raw)return null;let m;try{m=JSON.parse(raw);}catch{return null;}
  if(!m||typeof m!=='object')return null;
  return typeof m.generation==='string'&&/^[a-z0-9_-]+$/i.test(m.generation)&&Number.isInteger(m.count)&&m.count>0&&m.count<=256?m:null;
}
export async function readCourseCache(uid:string):Promise<CourseView[]|null>{
  try {
    const key=keyFor(uid);const m=manifest(await get(key));if(!m)return null;
    const chunks=await Promise.all(Array.from({length:m.count},(_,i)=>get(`${key}.${m.generation}.${i}`)));
    if(chunks.some(c=>c==null))return null;
    const entry=JSON.parse(chunks.join(''));
    if(entry.uid!==uid||entry.version!==1||!Number.isFinite(entry.savedAt)||Date.now()-entry.savedAt>maxAge||!Array.isArray(entry.courses))return null;
    const valid=entry.courses.every((c:CourseView)=>typeof c.id==='string'&&typeof c.title==='string'&&Number.isFinite(Date.parse(c.accessUntil))&&Number.isFinite(Date.parse(c.displayUntil))&&Array.isArray(c.lessons)&&c.lessons.every(l=>typeof l.id==='string'&&typeof l.title==='string'&&Number.isFinite(l.position))&&(!c.current||(typeof c.current.id==='string'&&typeof c.current.title==='string')));
    return valid?courseMetadata(entry.courses):null;
  } catch{return null;}
}
export function saveCourseCache(uid:string,courses:CourseView[]):Promise<void>{
  const work=(queues.get(uid)??Promise.resolve()).catch(()=>{}).then(async()=>{
    try {
      const key=keyFor(uid);const previous=manifest(await get(key));
      const chars=Array.from(JSON.stringify({version:1,uid,savedAt:Date.now(),courses:courseMetadata(courses)}));
      const count=Math.ceil(chars.length/400);if(count>256)return;
      const generation=Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,9);
      for(let i=0;i<count;i++)await put(`${key}.${generation}.${i}`,chars.slice(i*400,(i+1)*400).join(''));
      await put(key,JSON.stringify({generation,count}));
      if(previous)await Promise.all(Array.from({length:previous.count},(_,i)=>remove(`${key}.${previous.generation}.${i}`)));
    } catch{/* Storage failure must not block network results or startup. */}
  });
  queues.set(uid,work);void work.finally(()=>{if(queues.get(uid)===work)queues.delete(uid);});return work;
}
