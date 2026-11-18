import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {courseMarkdownHtml} from '../_legacy_web/app/api/_utils/courseSchedule.ts';
import {courseEmailHeaderHtml} from './courses-content.mjs';

export const courseStableId=name=>{const b=createHash('sha256').update(name).digest().subarray(0,16);b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const h=b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
const q=s=>`'${String(s).replaceAll("'","''")}'`;
export function generateCourseImportSql(course,{replaceEmails=false,replaceLessons=false}={}){
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(course.slug)||!course.title||!['practicum','intensive','course','masterclass'].includes(course.kind)||!/^https:\/\/[^\s]+$/.test(course.landingUrl))throw new Error('Проверьте метаданные курса');
 for(const n of ['accessDays','dayCardExtraDays','webinarExtraDays'])if(!Number.isInteger(course[n])||course[n]<=0)throw new Error(`Проверьте ${n}`);
 if(!/^[a-f0-9]{64}$/.test(course.sourceHash))throw new Error('Нужен SHA-256 утверждённого авторского источника');
 if(!Array.isArray(course.lessons)||!course.lessons.length||course.lessons.length>500)throw new Error('Нужен непустой список учебных материалов');
 if(course.completionEmail&&course.dayCardExtraDays!==3)throw new Error('Завершающее письмо привязано к окончанию трёхдневного показа последнего урока');
 if(course.emailHeader&&(!/^https:\/\/[^\s]+$/.test(course.emailHeader.src)||course.emailHeader.type!=='image'))throw new Error('Нужна HTTPS-шапка image');
 const auto=courseStableId(`course:${course.slug}`);const ids=new Set();
 const lines=['-- Generated from approved author text. Starts no enrolments and sends no email.','begin;',
 `insert into public.email_automations(id,key,name,trigger_type,is_active) values('${auto}',${q('course_'+course.slug)},${q(course.title)},'course',false) on conflict(id) do nothing;`,
 `insert into public.courses(slug,title,kind,landing_url,access_days,day_card_extra_days,webinar_extra_days,automation_id,source_hash) values(${q(course.slug)},${q(course.title)},${q(course.kind)},${q(course.landingUrl)},${course.accessDays},${course.dayCardExtraDays},${course.webinarExtraDays},'${auto}',${q(course.sourceHash)}) on conflict(slug) do update set title=excluded.title,source_hash=excluded.source_hash;`];
 function letter(email,step,name,position,blockId){
  if(typeof email?.subject!=='string'||!email.subject.trim()||typeof email?.markdown!=='string'||!email.markdown.trim())throw new Error('Нужны тема и текст каждого письма');
  const body=courseMarkdownHtml(email.markdown.replaceAll('{first_name}','{{name}}'));
  const html=courseEmailHeaderHtml(course.emailHeader)+body;
  const blocks=[...(course.emailHeader?[course.emailHeader]:[]),{id:blockId,type:'text',html:body,align:'left',fontFamily:'system',fontSize:'md',marginTop:0,marginBottom:0}];
  const update=replaceEmails?'do update set subject=excluded.subject,subject_i18n=excluded.subject_i18n,html_body=excluded.html_body,html_body_i18n=excluded.html_body_i18n,blocks_i18n=excluded.blocks_i18n':'do nothing';
  lines.push(`insert into public.email_automation_steps(id,automation_id,name,position,delay_hours,subject,subject_i18n,html_body,html_body_i18n,blocks_i18n) values('${step}','${auto}',${q(name)},${position},0,${q(email.subject)},${q(JSON.stringify({ru:email.subject}))}::jsonb,${q(html)},${q(JSON.stringify({ru:html}))}::jsonb,${q(JSON.stringify({ru:blocks}))}::jsonb) on conflict(id) ${update};`);
 }
 for(const [i,lesson] of course.lessons.entries()){
  if(typeof lesson.id!=='string'||!lesson.id.startsWith(course.slug+'-')||ids.has(lesson.id)||lesson.position!==i+1||!lesson.title||!Number.isInteger(lesson.gapDays)||lesson.gapDays<(i?1:0)||(!i&&lesson.gapDays!==0))throw new Error('Проверьте ID, порядок и интервалы уроков');
  ids.add(lesson.id);
  if(!Array.isArray(lesson.blocks)||!lesson.blocks.length||lesson.blocks.some(b=>b.type==='text'?typeof b.markdown!=='string'||!b.markdown.trim():b.type!=='video'||!/^\d{5,15}$/.test(b.vimeoId)||(b.practiceId&&!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(b.practiceId))))throw new Error('Проверьте текстовые и видеоблоки');
  const step=courseStableId(`course-mail:${lesson.id}`);letter(lesson.email,step,lesson.title,lesson.position,`${lesson.id}-text`);
  lines.push(`do $$begin if exists(select 1 from public.course_lessons where id=${q(lesson.id)} and course_slug<>${q(course.slug)}) then raise exception 'Lesson belongs to another course';end if;end$$;`);
  lines.push(`insert into public.course_lessons(id,course_slug,position,gap_days,title,blocks,email_step_id) values(${q(lesson.id)},${q(course.slug)},${lesson.position},${lesson.gapDays},${q(lesson.title)},${q(JSON.stringify(lesson.blocks))}::jsonb,'${step}') on conflict(id) ${replaceLessons?'do update set title=excluded.title,blocks=excluded.blocks,gap_days=excluded.gap_days':'do nothing'};`);
 }
 if(course.completionEmail){
  const step=courseStableId(`course-completion:${course.slug}`);
  letter(course.completionEmail,step,'Завершение практикума',course.lessons.length+1,`${course.slug}-completion-text`);
  lines.push(`do $$begin if exists(select 1 from public.courses where slug=${q(course.slug)} and (day_card_extra_days<>3 or (completion_email_step_id is not null and completion_email_step_id<>'${step}'::uuid))) then raise exception 'Completion configuration differs; review before replacing';end if;end$$;`);
  lines.push(`update public.courses set completion_email_step_id='${step}' where slug=${q(course.slug)};`);
 }
 lines.push('commit;');return lines.join('\n')+'\n';
}
if(process.argv[1]?.endsWith('/course-import-sql.mjs')){
 const input=process.argv.slice(2).find(a=>a.endsWith('.json'))||new URL('../content/courses/month-health.json',import.meta.url);
 const output=process.argv.slice(2).find(a=>a.endsWith('.sql'));if(!output)throw new Error('Укажите [курс.json] новый-файл.sql');
 const course=JSON.parse(await readFile(input,'utf8'));
 const sql=generateCourseImportSql(course,{replaceEmails:process.argv.includes('--replace-emails'),replaceLessons:process.argv.includes('--replace-lessons')});
 await writeFile(output,sql,{flag:'wx'});
 console.log(`Подготовлен импорт ${course.lessons.length} уроков и ${course.lessons.length+(course.completionEmail?1:0)} писем без запуска. Правки БД сохраняются по умолчанию; замена — только через --replace-emails / --replace-lessons.`);
}
