import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveExactEmailCopy } from './emailCopy';
import { applyEmailPlaceholders,wrapMarketingEmailHtml } from './emailTemplate';
import { getMarketingTransportProfile,htmlToPlaintext,sendMarketingEmail } from './marketingMail';

export async function runCourseEmails(db:SupabaseClient,testOnly=false) {
 let q=db.from('course_enrollments').select('id').eq('status','active').eq('mail_paused',false).lte('next_mail_at',new Date().toISOString()).order('next_mail_at').limit(30);
 if(testOnly)q=q.eq('mode','test');
 const {data:due,error}=await q;if(error)throw error;let sent=0,failed=0;
 for(const row of due??[]) {
  const {data:e,error:claimError}=await db.rpc('claim_course_mail',{p_id:row.id});if(claimError)throw claimError;if(!e)continue;
  let subject='';let resendId:string|null=null;let failure:string|null=null;
  try {
   if(getMarketingTransportProfile().provider!=='resend')throw new Error('Course delivery requires the configured Resend transport for idempotent sends');
   const lessonId=e.schedule[e.mail_position]?.lessonId;
   const {data:l,error:le}=await db.from('course_lessons').select('email_step_id').eq('id',lessonId).eq('course_slug',e.course_slug).single();if(le)throw le;
   const {data:step,error:se}=await db.from('email_automation_steps').select('*').eq('id',l.email_step_id).single();if(se)throw se;
   const {data:a,error:ae}=await db.from('email_automation_enrollments').select('contact_id').eq('course_enrollment_id',e.id).eq('status','active').single();if(ae)throw ae;
   const {data:contact,error:co}=await db.from('email_contacts').select('email,user_id,marketing_status,locale').eq('id',a.contact_id).single();if(co)throw co;
   if(contact.user_id!==e.user_id||contact.email.trim().toLowerCase()!==e.buyer_email.trim().toLowerCase())throw new Error('Course recipient mismatch');
   if(['complained','suppressed'].includes(contact.marketing_status))throw new Error('Delivery blocked by contact status');
   const {data:user,error:ue}=await db.from('users').select('display_name,locale').eq('id',e.user_id).single();if(ue)throw ue;
   const input={subject:step.subject,htmlBody:step.html_body,subjectI18n:step.subject_i18n,htmlBodyI18n:step.html_body_i18n};
   const copy=resolveExactEmailCopy(user.locale||contact.locale,input)||resolveExactEmailCopy('en',input)||resolveExactEmailCopy('ru',input);if(!copy)throw new Error('Course email copy missing');
   const name=(user.display_name||'').replace(/[<>&"]/g,'');
   subject=applyEmailPlaceholders(copy.subject,{name});
   const html=wrapMarketingEmailHtml({bodyHtml:applyEmailPlaceholders(copy.htmlBody,{name}),footer:null,lang:copy.locale});
   const result=await sendMarketingEmail({to:contact.email,subject,html,text:htmlToPlaintext(html),locale:copy.locale,idempotencyKey:`course/${e.id}/${e.mail_position}`});
   if(result.ok)resendId=result.resendId;else failure=result.detail;
  }catch(error){failure=error instanceof Error?error.message:String(error);}
  const {error:finishError}=await db.rpc('finish_course_mail',{p_id:e.id,p_token:e.claim_token,p_subject:subject,p_resend_id:resendId,p_error:failure});if(finishError)throw finishError;
  if(failure)failed++;else sent++;
 }
 return {course_sent:sent,course_failed:failed};
}
