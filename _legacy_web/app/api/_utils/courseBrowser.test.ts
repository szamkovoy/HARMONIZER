import {afterEach,describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {browserCourseLesson} from './courseBrowser';
import {courseAccessNotice} from '@shared/courseAccess';
const grant={id:'grant',user_id:'private-user',buyer_email:'private@example.test',course_slug:'pilot',status:'active',mode:'normal',started_at:'2026-11-01T10:00:00Z',access_until:'2027-02-01T00:00:00Z',display_until:'2026-11-08T00:00:00Z',schedule:[{lessonId:'one',opensAt:'2026-11-01T10:00:00Z'},{lessonId:'two',opensAt:'2026-11-05T00:00:00Z'},{lessonId:'future',opensAt:'2026-12-01T00:00:00Z'}]};
function database(overrides:Record<string,unknown>={}){
 const rows:Record<string,Record<string,unknown>[]>={course_enrollments:[{...grant,...overrides}],courses:[{slug:'pilot',title:'Курс',kind:'practicum'}],course_lessons:['one','two','future'].map((id,i)=>({id,course_slug:'pilot',title:id,position:i+1,blocks:[{type:'text',markdown:'**Текст**\n\n<script>alert(1)</script> https://example.test/'},{type:'video',vimeoId:'12345678'}]}))};
 return {from(table:string){let result=rows[table]??[];const q={select(){return q;},order(){return q;},eq(key:string,value:unknown){result=result.filter(r=>r[key]===value);return q;},neq(key:string,value:unknown){result=result.filter(r=>r[key]!==value);return q;},in(key:string,values:unknown[]){result=result.filter(r=>values.includes(r[key]));return q;},maybeSingle(){return Promise.resolve({data:result[0]??null,error:null});},then(resolve:(v:unknown)=>unknown){return Promise.resolve({data:result,error:null}).then(resolve);}};return q;}} as unknown as SupabaseClient;
}
afterEach(()=>vi.useRealTimers());
describe('anonymous browser lesson',()=>{
 it('opens the selected earlier lesson even after Day has become an archive',async()=>{
  vi.useFakeTimers().setSystemTime(new Date('2026-11-21T12:00:00Z'));
  const data=await browserCourseLesson(database(),'grant','one');
  expect(data).toMatchObject({state:'available',courseTitle:'Курс',lessonTitle:'one',blocks:[{type:'text',html:expect.stringContaining('<strong>Текст</strong>')},{type:'video',src:'https://player.vimeo.com/video/12345678?audiotrack=ru'}]});
  const text=JSON.stringify(data);expect(text).not.toContain('<script>');expect(text).not.toContain('private');expect(text).not.toContain('future');expect(text).not.toContain('two');
 });
 it.each(['expired','revoked'])('returns the exact shared Profile notice, with no content (%s)',async state=>{
  vi.useFakeTimers().setSystemTime(new Date(state==='expired'?grant.access_until:'2026-11-21T12:00:00Z'));
  const data=await browserCourseLesson(database(state==='revoked'?{status:'revoked'}:{}),'grant','one');
  expect(data).toEqual({state,courseTitle:'Курс',notice:courseAccessNotice({startedAt:grant.started_at,accessUntil:grant.access_until},'ru')});
 });
 it('does not combine different grants, reveal future lessons, or open prepared tests',async()=>{
  vi.useFakeTimers().setSystemTime(new Date('2026-11-21T12:00:00Z'));
  for(const [id,lesson] of [['unknown','one'],['grant','future'],['grant','foreign-lesson']])expect(await browserCourseLesson(database(),id,lesson)).toBeNull();
  expect(await browserCourseLesson(database({status:'prepared'}),'grant','one')).toBeNull();
  // Another purchase of the same course cannot extend this link's expired period.
  expect(await browserCourseLesson(database({access_until:'2026-11-20T00:00:00Z'}),'grant','one')).toMatchObject({state:'expired'});
 });
 it('formats expiry dates in the course timezone, independently of the server',()=>{
  const notice=courseAccessNotice({startedAt:'2026-11-01T22:00:00Z',accessUntil:'2026-12-01T21:00:00Z',timezone:'Europe/Moscow'},'ru');
  expect(notice.period).toBe('Период доступа: 02.11.2026 — 02.12.2026');
 });
});
