import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
const mail=vi.hoisted(()=>({send:vi.fn()}));
vi.mock('./marketingMail',()=>({getMarketingTransportProfile:()=>({provider:'resend'}),htmlToPlaintext:(s:string)=>s,sendMarketingEmail:mail.send}));
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
 expect(finish).toHaveBeenCalledWith(expect.objectContaining({p_error:null}));
});
