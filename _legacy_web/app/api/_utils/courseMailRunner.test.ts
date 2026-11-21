import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
const mail=vi.hoisted(()=>({send:vi.fn()}));
vi.mock('./marketingMail',()=>({getMarketingTransportProfile:()=>({provider:'resend'}),htmlToPlaintext:(s:string)=>s,sendMarketingEmail:mail.send,sleep:async()=>{}}));
import {runCourseEmails} from './courseMailRunner';
const grant={id:'grant',claim_token:'lease',course_slug:'pilot',user_id:'owner',buyer_email:'owner@example.test',mail_position:0,schedule:[{lessonId:'one'}]};
function dbFor(options:{claimed?:boolean;contact?:Record<string,unknown>;completion?:boolean}={}){
 const finish=vi.fn();const tables:Record<string,unknown>={
  course_enrollments:[{id:'grant'}],course_lessons:{email_step_id:'step'},
  email_automation_steps:{subject:'Урок для {{name}}',html_body:'<p>Здравствуйте, {{name}}!</p>',subject_i18n:{ru:'Урок для {{name}}'},html_body_i18n:{ru:'<p>Здравствуйте, {{name}}!</p>'}},
  email_automation_enrollments:{contact_id:'contact',automation_id:'automation'},
  email_contacts:{email:'owner@example.test',user_id:'owner',marketing_status:'active',locale:'ru',...options.contact},
  users:{display_name:'Сергей',locale:'pt'},
 };
 const queried:string[]=[];const db={from(table:string){queried.push(table);const q={select(){return q;},eq(){return q;},lte(){return q;},order(){return q;},limit(){return q;},single(){return Promise.resolve({data:tables[table],error:null});},then(resolve:(r:unknown)=>unknown){return Promise.resolve({data:tables[table],error:null}).then(resolve);}};return q;},
  async rpc(name:string,args:unknown){if(name==='claim_course_mail')return {data:options.claimed===false?null:options.completion?{...grant,mail_position:1,completion_email_step_id:'closing'}:grant,error:null};finish(args);return {error:null};},
 } as unknown as SupabaseClient;
 return {db,finish,queried};
}
beforeEach(()=>{vi.clearAllMocks();mail.send.mockResolvedValue({ok:true,resendId:'provider-id'});});
describe('course email delivery',()=>{
 it('sends nothing when the database does not grant a send lease',async()=>{
  const {db,finish}=dbFor({claimed:false});expect(await runCourseEmails(db,true)).toEqual({course_sent:0,course_failed:0});expect(mail.send).not.toHaveBeenCalled();expect(finish).not.toHaveBeenCalled();
 });
 it('uses the fixed recipient, author copy and stable provider key, then records success',async()=>{
  const {db,finish}=dbFor();expect(await runCourseEmails(db)).toEqual({course_sent:1,course_failed:0});
  expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({to:'owner@example.test',subject:'Урок для Сергей',idempotencyKey:'course/grant/0'}));
  expect(mail.send.mock.calls[0][0].html).toContain('https://zamkovoi.yoga/cabinet/lesson.html?enrollment=grant&amp;lesson=one');
  expect(finish).toHaveBeenCalledWith(expect.objectContaining({p_id:'grant',p_token:'lease',p_resend_id:'provider-id',p_error:null}));
 });
 it.each([{user_id:'other'},{email:'other@example.test'},{marketing_status:'complained'},{marketing_status:'suppressed'}])('blocks unsafe recipient/status %j',async contact=>{
  const {db,finish}=dbFor({contact});expect(await runCourseEmails(db)).toEqual({course_sent:0,course_failed:1});expect(mail.send).not.toHaveBeenCalled();expect(finish).toHaveBeenCalledWith(expect.objectContaining({p_error:expect.any(String)}));
 });
 it('records a transport failure without declaring a sent lesson',async()=>{
  mail.send.mockResolvedValue({ok:false,detail:'temporary outage'});const {db,finish}=dbFor();expect(await runCourseEmails(db)).toEqual({course_sent:0,course_failed:1});expect(finish).toHaveBeenCalledWith(expect.objectContaining({p_resend_id:null,p_error:'temporary outage'}));
 });
});


it('sends a standalone completion letter without reading or inventing a lesson',async()=>{
 const {db,finish,queried}=dbFor({completion:true});
 expect(await runCourseEmails(db)).toEqual({course_sent:1,course_failed:0});
 expect(queried).not.toContain('course_lessons');
 expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({idempotencyKey:'course/grant/1'}));
 expect(mail.send.mock.calls[0][0].html).not.toContain('/cabinet/lesson.html');
 expect(finish).toHaveBeenCalledWith(expect.objectContaining({p_error:null}));
});

// Stateful adapter: finishing advances the real cursor, so order/retries can be observed.
function immediateDb({mode='test',timed=false,completion=true,blockedAt=-1,intensive=false}:{mode?:string;timed?:boolean;completion?:boolean;blockedAt?:number;intensive?:boolean}={}){
 let position=0;const total=intensive?2:2+(completion?1:0);const finishes:Record<string,unknown>[]=[];const queried:string[]=[];
 const schedule=(intensive?Array.from({length:30},(_,i)=>`day-${i}`):['one','two']).map((lessonId,i)=>({lessonId,opensAt:timed?`2026-01-01T00:0${i}:00Z`:'2026-01-01T00:00:00Z',mailAt:timed?`2026-01-01T00:0${i}:00Z`:'2026-01-01T00:00:00Z'}));
 const db={from(table:string){queried.push(table);const filters:Record<string,unknown>={};const q={select(){return q;},eq(k:string,v:unknown){filters[k]=v;return q;},lte(){return q;},order(){return q;},limit(){return q;},
  single(){const data=table==='course_lessons'?{email_step_id:`${filters.id}-mail`}:table==='email_automation_steps'?{subject:String(filters.id),html_body:'<p>Test</p>'}:table==='email_automation_enrollments'?{contact_id:'contact',automation_id:'automation'}:table==='email_contacts'?{email:'owner@example.test',user_id:'owner',marketing_status:'active',locale:'ru'}:{display_name:'Owner',locale:'ru'};return Promise.resolve({data,error:null});},
  then(resolve:(r:unknown)=>unknown){return Promise.resolve({data:[{id:'grant'}],error:null}).then(resolve);}};return q;},
  async rpc(name:string,args:Record<string,unknown>){
   if(name==='claim_course_mail')return {data:position>=total||position===blockedAt?null:{...grant,mode,mail_position:position,schedule,completion_email_step_id:completion?'closing':null,...(intensive?{mail_schedule:[{stepId:'intro',mailAt:schedule[0].opensAt},{stepId:'closing',mailAt:schedule[0].opensAt}]}:{})},error:null};
   finishes.push(args);if(!args.p_error)position++;return {error:null};
  }} as unknown as SupabaseClient;
 return {db,finishes,position:()=>position,queried};
}
describe('immediate content test delivery',()=>{
 it('sends only the two intensive emails for thirty lessons, without looking up daily email steps',async()=>{
  const {db,queried,position}=immediateDb({intensive:true});
  expect(await runCourseEmails(db,true)).toEqual({course_sent:2,course_failed:0});
  expect(mail.send.mock.calls.map(([input])=>input.subject)).toEqual(['intro','closing']);
  expect(mail.send.mock.calls.every(([input])=>!input.html.includes('/cabinet/lesson.html'))).toBe(true);
  expect(queried).not.toContain('course_lessons');expect(position()).toBe(2);
  expect(await runCourseEmails(db,true)).toEqual({course_sent:0,course_failed:0});
 });
 it.each([true,false])('sends all lesson letters and optional closing (%s) sequentially with individual keys',async completion=>{
  const {db,position}=immediateDb({completion});const total=completion?3:2;
  expect(await runCourseEmails(db,true)).toEqual({course_sent:total,course_failed:0});
  expect(mail.send.mock.calls.map(([input])=>input.subject)).toEqual(completion?['one-mail','two-mail','closing']:['one-mail','two-mail']);
  expect(mail.send.mock.calls.map(([input])=>input.idempotencyKey)).toEqual(Array.from({length:total},(_,i)=>`course/grant/${i}`));
  expect(position()).toBe(total);
  expect(await runCourseEmails(db,true)).toEqual({course_sent:0,course_failed:0});
  expect(mail.send).toHaveBeenCalledTimes(total);
 });
 it.each([{mode:'normal'},{timed:true}])('retains a single step for ordinary or timed schedules %j',async options=>{
  const {db,position}=immediateDb(options);expect(await runCourseEmails(db)).toEqual({course_sent:1,course_failed:0});expect(position()).toBe(1);
 });
 it('stops on failure, then resumes the same key before sending the remaining letters',async()=>{
  const {db,position}=immediateDb();
  mail.send.mockResolvedValueOnce({ok:true,resendId:'first'}).mockResolvedValueOnce({ok:false,detail:'temporary outage'});
  expect(await runCourseEmails(db,true)).toEqual({course_sent:1,course_failed:1});expect(position()).toBe(1);
  expect(await runCourseEmails(db,true)).toEqual({course_sent:2,course_failed:0});
  expect(mail.send.mock.calls.map(([input])=>input.idempotencyKey)).toEqual(['course/grant/0','course/grant/1','course/grant/1','course/grant/2']);
 });
 it('yields when a concurrent worker owns the next send lease',async()=>{
  const {db,position}=immediateDb({blockedAt:1});expect(await runCourseEmails(db,true)).toEqual({course_sent:1,course_failed:0});expect(position()).toBe(1);
 });
 it('leaves remaining mail to cron when the request time budget is reached',async()=>{
  const clock=vi.spyOn(Date,'now').mockReturnValue(0);
  try{
   const {db,position}=immediateDb();mail.send.mockImplementationOnce(async()=>{clock.mockReturnValue(80_000);return {ok:true,resendId:'first'};});
   expect(await runCourseEmails(db,true)).toEqual({course_sent:1,course_failed:0});expect(position()).toBe(1);
  }finally{clock.mockRestore();}
 });
});
