import {afterEach,describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
const invites=vi.hoisted(()=>({send:vi.fn().mockResolvedValue({sent:1,failed:0})}));
vi.mock('../account/webinarNotices',()=>({sendPassWebinarInvites:invites.send}));
import {listUserCourses,startPreparedCourse} from './courseService';

// In-memory query adapter applies the actual predicates supplied by the service.
function database(rows:Record<string,Record<string,unknown>[]>){
 return {from(table:string){let result=rows[table]??[];const q={
  select(){return q;},eq(key:string,value:unknown){result=result.filter(r=>r[key]===value);return q;},
  neq(key:string,value:unknown){result=result.filter(r=>r[key]!==value);return q;},
  in(key:string,values:unknown[]){result=result.filter(r=>values.includes(r[key]));return q;},order(){return q;},
  then(resolve:(v:unknown)=>unknown){return Promise.resolve({data:result,error:null}).then(resolve);},
 };return q;}} as unknown as SupabaseClient;
}
const schedule=[{lessonId:'open',opensAt:'2026-11-16T00:00:00Z'},{lessonId:'future',opensAt:'2026-11-18T00:00:00Z'}];
const grant={id:'own',user_id:'owner',course_slug:'pilot',status:'active',mode:'test',started_at:'2026-11-16T00:00:00Z',access_until:'2027-02-01T00:00:00Z',display_until:'2026-11-21T00:00:00Z',schedule};
const rows=()=>({
 course_enrollments:[grant,{...grant,id:'other',user_id:'stranger'},{...grant,id:'waiting',status:'prepared'}],
 courses:[{slug:'pilot',title:'Pilot',landing_url:'https://example.test'}],
 course_lessons:[{id:'open',course_slug:'pilot',position:1,title:'Open',blocks:[{type:'text',markdown:'Allowed text'}]},
 {id:'future',course_slug:'pilot',position:2,title:'Secret future title',blocks:[{type:'text',markdown:'Secret future body'}]}],
});
afterEach(()=>vi.useRealTimers());
describe('course ownership and release boundaries',()=>{
 it('lists only owned, started grants and never returns future titles or bodies',async()=>{
  vi.useFakeTimers().setSystemTime(new Date('2026-11-17T12:00:00Z'));
  const result=await listUserCourses(database(rows()),'owner');
  expect(result.map(c=>c.id)).toEqual(['own']);expect(result[0].current?.id).toBe('open');expect(result[0].totalLessons).toBe(2);
  expect(JSON.stringify(result)).not.toContain('Secret');expect(result[0].nextChangeAt).toBe('2026-11-18T00:00:00Z');
 });
 it('denies a guessed grant belonging to another account and a direct future lesson',async()=>{
  vi.useFakeTimers().setSystemTime(new Date('2026-11-17T12:00:00Z'));
  expect(await listUserCourses(database(rows()),'owner',undefined,'other')).toEqual([]);
  expect((await listUserCourses(database(rows()),'owner','future','own'))[0].current).toBeNull();
 });
 it('opens exactly on the boundary without waiting for an email record',async()=>{
  vi.useFakeTimers().setSystemTime(new Date('2026-11-18T00:00:00Z'));
  const [course]=await listUserCourses(database(rows()),'owner');expect(course.current?.id).toBe('future');expect(course.lessons).toHaveLength(2);
 });
 it('retains the archive after Day display ends, but removes all bodies at access expiry',async()=>{
  vi.useFakeTimers().setSystemTime(new Date('2026-12-01T00:00:00Z'));
  expect((await listUserCourses(database(rows()),'owner'))[0].current).not.toBeNull();
  vi.setSystemTime(new Date(grant.access_until));
  const [expired]=await listUserCourses(database(rows()),'owner');expect(expired.state).toBe('expired');expect(expired.current).toBeNull();expect(expired.lessons).toEqual([]);
 });
});

describe('course start webinar invitations',()=>{
 it.each(['normal','test'])('mode %s keeps real invitations separate from rehearsal',async mode=>{
  invites.send.mockClear();const values:Record<string,unknown>={
   course_enrollments:{id:'grant',status:'prepared',mode,user_id:'owner',course_slug:'pilot',timezone:'Europe/Moscow'},
   course_lessons:[{id:'one',gap_days:0},{id:'two',gap_days:2}],courses:{access_days:90,day_card_extra_days:3},
  };
  const rpc=vi.fn().mockResolvedValue({error:null});const db={rpc,from(table:string){const q={select(){return q;},eq(){return q;},order(){return q;},single(){return Promise.resolve({data:values[table],error:null});},then(resolve:(v:unknown)=>unknown){return Promise.resolve({data:values[table],error:null}).then(resolve);}};return q;}} as unknown as SupabaseClient;
  const result=await startPreparedCourse(db,'grant');expect(rpc).toHaveBeenCalledOnce();
  if(mode==='normal'){expect(invites.send).toHaveBeenCalledWith(db,'owner');expect(result.webinarInvites?.sent).toBe(1);}
  else{expect(invites.send).not.toHaveBeenCalled();expect(Date.parse(result.schedule[1].opensAt)-Date.parse(result.schedule[0].opensAt)).toBe(120000);}
 });
});


it('keeps a standalone completion letter out of the lesson count and access payload',async()=>{
 vi.useFakeTimers().setSystemTime(new Date(grant.display_until));
 const data=rows();data.course_enrollments=[{...grant,completion_email_step_id:'closing-step',completion_mail_at:'2026-11-21T07:00:00Z'} as typeof grant];
 const [course]=await listUserCourses(database(data),'owner');
 expect(course.totalLessons).toBe(2);expect(course.lessons).toHaveLength(2);expect(course.current?.id).toBe('future');
 expect(course.state).toBe('available');expect(course.displayUntil).toBe(grant.display_until);expect(course.accessUntil).toBe(grant.access_until);
 expect(JSON.stringify(course)).not.toContain('closing-step');expect(course.nextChangeAt).toBe(grant.access_until);
});
