import {afterEach,describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
const invites=vi.hoisted(()=>({send:vi.fn().mockResolvedValue({sent:1,failed:0})}));
vi.mock('../account/webinarNotices',()=>({sendPassWebinarInvites:invites.send}));
import {listUserCourses,startPreparedCourse} from './courseService';

// In-memory query adapter applies the actual predicates supplied by the service.
function database(rows:Record<string,Record<string,unknown>[]>){
 return {from(table:string){let result=rows[table]??[];const orders:{key:string;ascending:boolean}[]=[];const q={
  select(){return q;},eq(key:string,value:unknown){result=result.filter(r=>r[key]===value);return q;},
  neq(key:string,value:unknown){result=result.filter(r=>r[key]!==value);return q;},
  in(key:string,values:unknown[]){result=result.filter(r=>values.includes(r[key]));return q;},order(key:string,{ascending=true}={}){orders.push({key,ascending});return q;},
  then(resolve:(v:unknown)=>unknown){return Promise.resolve({data:[...result].sort((a,b)=>{for(const {key,ascending} of orders){const cmp=String(a[key]??'').localeCompare(String(b[key]??''));if(cmp)return ascending?cmp:-cmp;}return 0;}),error:null}).then(resolve);},
 };return q;}} as unknown as SupabaseClient;
}
const schedule=[{lessonId:'open',opensAt:'2026-11-16T00:00:00Z'},{lessonId:'future',opensAt:'2026-11-18T00:00:00Z'}];
const grant={created_at:'2026-11-16T00:00:00Z',id:'own',user_id:'owner',course_slug:'pilot',status:'active',mode:'test',started_at:'2026-11-16T00:00:00Z',access_until:'2027-02-01T00:00:00Z',display_until:'2026-11-21T00:00:00Z',schedule};
const rows=()=>({
 course_enrollments:[grant,{...grant,id:'other',user_id:'stranger'},{...grant,id:'waiting',status:'prepared'}],
 courses:[{slug:'pilot',title:'Pilot',landing_url:'https://example.test'}],
 course_lessons:[{id:'open',course_slug:'pilot',position:1,title:'Open',blocks:[{type:'text',markdown:'Allowed text'}]},
 {id:'future',course_slug:'pilot',position:2,title:'Secret future title',blocks:[{type:'text',markdown:'Secret future body'}]}],
});
const intensiveRows=(review=false,mode='normal')=>({
 ...rows(),courses:[{slug:'pilot',title:'Интенсив',kind:'intensive',title_i18n:{en:'Intensive'},landing_url:''}],
 course_enrollments:[{...grant,mode,test_browse:review,schedule:[{lessonId:'past',opensAt:'2026-11-15T00:00:00Z'},{lessonId:'open',opensAt:'2026-11-16T00:00:00Z'},{lessonId:'future',opensAt:'2026-11-18T00:00:00Z'}]}],
 course_lessons:[...rows().course_lessons,{id:'past',course_slug:'pilot',position:0,title:'Secret past title',blocks:[{type:'text',markdown:'Secret past body'}]}],
});
afterEach(()=>vi.useRealTimers());
describe('course ownership and release boundaries',()=>{
 it('returns only today in an intensive, excluding past/future even by direct ID',async()=>{
  vi.useFakeTimers().setSystemTime(new Date('2026-11-17T12:00:00Z'));
  const db=database(intensiveRows());const [course]=await listUserCourses(db,'owner');
  expect(course.current?.id).toBe('open');expect(course.lessons.map(l=>l.id)).toEqual(['open']);
  expect(course.currentUntil).toBe('2026-11-18T00:00:00Z');expect(JSON.stringify(course)).not.toContain('Secret');
  for(const id of ['past','future'])expect((await listUserCourses(database(intensiveRows()),'owner',id,'own'))[0].current).toBeNull();
 });
 it('permits all intensive days only in an explicit test review and expires every translation',async()=>{
  vi.useFakeTimers().setSystemTime(new Date('2026-11-17T12:00:00Z'));
  const [review]=await listUserCourses(database(intensiveRows(true,'test')),'owner','future','own');
  expect(review.reviewAllLessons).toBe(true);expect(review.current?.id).toBe('future');expect(review.lessons).toHaveLength(3);
  const [ordinary]=await listUserCourses(database(intensiveRows(true,'normal')),'owner','future','own');
  expect(ordinary.reviewAllLessons).toBe(false);expect(ordinary.current).toBeNull();
  vi.setSystemTime(new Date(grant.access_until));
  const [expired]=await listUserCourses(database(intensiveRows(true,'test')),'owner');
  expect(expired.current).toBeNull();expect(expired.lessons).toEqual([]);
 });
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
  const result=await startPreparedCourse(db,'grant','timed');expect(rpc).toHaveBeenCalledOnce();
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

it('orders all history by actual purchase/start, independent of preparation and latest release',async()=>{
 vi.useFakeTimers().setSystemTime(new Date('2026-11-20T12:00:00Z'));
 const data=rows();
 data.course_enrollments=[
  {...grant,id:'earlier-start-later-prepared',started_at:'2026-11-15T00:00:00Z',created_at:'2026-11-15T00:00:00Z'},
  {...grant,id:'later-start-earlier-prepared',started_at:'2026-11-19T00:00:00Z',created_at:'2026-11-14T00:00:00Z'},
  {...grant,id:'expired',started_at:'2026-11-10T00:00:00Z',created_at:'2026-11-10T00:00:00Z',access_until:'2026-11-19T00:00:00Z'},
 ];
 const courses=await listUserCourses(database(data),'owner');
 expect(courses.map(c=>c.id)).toEqual(['later-start-earlier-prepared','earlier-start-later-prepared','expired']);
 expect(courses.at(-1)?.state).toBe('expired');
});

it('starts a prepared test in immediate content mode by default, without real webinar invitations',async()=>{
 invites.send.mockClear();
 const started={id:'grant',testMode:'content',intervalSeconds:0,lessonCount:7,totalMails:8};
 const rpc=vi.fn().mockResolvedValue({data:started,error:null});
 const db={rpc,from(){const q={select(){return q;},eq(){return q;},single(){return Promise.resolve({data:{id:'grant',status:'prepared',mode:'test'},error:null});}};return q;}} as unknown as SupabaseClient;
 expect(await startPreparedCourse(db,'grant')).toBe(started);
 expect(rpc).toHaveBeenCalledExactlyOnceWith('start_course_content_test',{p_id:'grant'});
 expect(invites.send).not.toHaveBeenCalled();
});

it('starts an intensive review using the existing daily calendar, two immediate mails and no real webinar invitations',async()=>{
 vi.useFakeTimers().setSystemTime(new Date('2026-11-19T16:00:00Z'));invites.send.mockClear();
 const tables:Record<string,unknown>={course_enrollments:{id:'grant',status:'prepared',mode:'test',course_slug:'intensive-fixture',timezone:'Europe/Moscow',courses:{kind:'intensive'}},courses:{access_days:1,day_card_extra_days:1,completion_email_step_id:'closing'},course_lessons:Array.from({length:30},(_,i)=>({id:`day-${i}`,gap_days:i?1:0}))};
 const rpc=vi.fn().mockResolvedValue({error:null});
 const db={rpc,from(table:string){const q={select(){return q;},eq(){return q;},order(){return q;},single(){return Promise.resolve({data:tables[table],error:null});},then(resolve:(value:unknown)=>unknown){return Promise.resolve({data:tables[table],error:null}).then(resolve);}};return q;}} as unknown as SupabaseClient;
 const result=await startPreparedCourse(db,'grant');
 expect(rpc).toHaveBeenCalledWith('start_intensive_enrollment',expect.objectContaining({p_review:true}));
 expect(result.schedule[1].opensAt).toBe('2026-11-20T21:00:00.000Z');
 expect(result.completionMailAt).toBe('2026-11-19T16:00:00.000Z');
 expect(invites.send).not.toHaveBeenCalled();
});
