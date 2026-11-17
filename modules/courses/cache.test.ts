import {beforeEach,describe,it,expect,vi} from 'vitest';
const store=vi.hoisted(()=>new Map<string,string>());
vi.mock('react-native',()=>({Platform:{OS:'ios'}}));
vi.mock('expo-secure-store',()=>({getItemAsync:vi.fn(async(k:string)=>store.get(k)??null),setItemAsync:vi.fn(async(k:string,v:string)=>{if(Buffer.byteLength(v)>2048)throw Error('too large');store.set(k,v);}),deleteItemAsync:vi.fn(async(k:string)=>{store.delete(k);})}));
import type {CourseView} from '@shared/courses';
import {readCourseCache,saveCourseCache} from './cache';
const course:CourseView={id:'grant',slug:'pilot',title:'Здоровье 🌳',mode:'test',startedAt:'2026-11-01T12:00:00Z',accessUntil:'2027-02-01T00:00:00Z',displayUntil:'2026-11-21T00:00:00Z',landingUrl:'https://example.test',state:'available',current:{id:'one',title:'Урок',position:1,blocks:[{type:'text',markdown:'SECRET CONTENT'},{type:'video',vimeoId:'12345678'}]},lessons:[{id:'one',position:1,title:'Урок'}],totalLessons:8,nextChangeAt:null};
beforeEach(()=>store.clear());
describe('private course metadata cache',()=>{
 it('restores owned metadata on cold start without persisting protected content',async()=>{
  await saveCourseCache('owner',[structuredClone(course)]);
  expect((await readCourseCache('owner'))?.[0].title).toBe(course.title);
  expect(await readCourseCache('another')).toBeNull();expect([...store.values()].join('')).not.toContain('SECRET CONTENT');expect([...store.values()].join('')).not.toContain('12345678');
 });
 it('chunks long multilingual lists below native secure storage limits',async()=>{
  const many=Array.from({length:40},(_,i)=>({...course,id:`grant-${i}`,title:'🌳'.repeat(100)}));
  await saveCourseCache('owner',many);expect(await readCourseCache('owner')).toHaveLength(40);
 });
 it('recovers a corrupt cache and serializes concurrent updates',async()=>{
  store.set('harmonizer.courses.meta.v1.owner','broken');
  expect(await readCourseCache('owner')).toBeNull();
  await Promise.all([saveCourseCache('owner',[course]),saveCourseCache('owner',[])]);
  expect(await readCourseCache('owner')).toEqual([]);
 });
});
