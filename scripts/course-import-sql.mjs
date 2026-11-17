import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {courseMarkdownHtml} from '../_legacy_web/app/api/_utils/courseSchedule.ts';
import {courseEmailHeaderHtml} from './courses-content.mjs';
const course=JSON.parse(await readFile(new URL('../content/courses/month-health.json',import.meta.url),'utf8'));
const id=(name)=>{const b=createHash('sha256').update(name).digest().subarray(0,16);b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const h=b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
const q=(s)=>`'${String(s).replaceAll("'","''")}'`;
const auto=id(`course:${course.slug}`);
const lines=[`-- Generated from approved author text. Starts no enrolments and sends no email.`,
 `insert into public.email_automations(id,key,name,trigger_type,is_active) values('${auto}',${q('course_'+course.slug)},${q(course.title)},'course',false) on conflict(id) do nothing;`,
 `insert into public.courses(slug,title,kind,landing_url,access_days,day_card_extra_days,webinar_extra_days,automation_id,source_hash) values(${q(course.slug)},${q(course.title)},${q(course.kind)},${q(course.landingUrl)},${course.accessDays},${course.dayCardExtraDays},${course.webinarExtraDays},'${auto}',${q(course.sourceHash)}) on conflict(slug) do update set title=excluded.title,source_hash=excluded.source_hash;`];
for(const lesson of course.lessons){
 const step=id(`course-mail:${lesson.id}`);
 const body=courseMarkdownHtml(lesson.email.markdown.replaceAll('{first_name}','{{name}}'));
 const html=courseEmailHeaderHtml(course.emailHeader)+body;
 const blocks=[...(course.emailHeader?[course.emailHeader]:[]),{id:`${lesson.id}-text`,type:'text',html:body,align:'left',fontFamily:'system',fontSize:'md',marginTop:0,marginBottom:0}];
 const update=process.argv.includes('--replace-emails')?'do update set subject=excluded.subject,subject_i18n=excluded.subject_i18n,html_body=excluded.html_body,html_body_i18n=excluded.html_body_i18n,blocks_i18n=excluded.blocks_i18n':'do nothing';
 lines.push(`insert into public.email_automation_steps(id,automation_id,name,position,delay_hours,subject,subject_i18n,html_body,html_body_i18n,blocks_i18n) values('${step}','${auto}',${q(lesson.title)},${lesson.position},0,${q(lesson.email.subject)},${q(JSON.stringify({ru:lesson.email.subject}))}::jsonb,${q(html)},${q(JSON.stringify({ru:html}))}::jsonb,${q(JSON.stringify({ru:blocks}))}::jsonb) on conflict(id) ${update};`);
 lines.push(`insert into public.course_lessons(id,course_slug,position,gap_days,title,blocks,email_step_id) values(${q(lesson.id)},${q(course.slug)},${lesson.position},${lesson.gapDays},${q(lesson.title)},${q(JSON.stringify(lesson.blocks))}::jsonb,'${step}') on conflict(id) ${process.argv.includes('--replace-lessons')?'do update set title=excluded.title,blocks=excluded.blocks,gap_days=excluded.gap_days':'do nothing'};`);
}
const output=process.argv.find(a=>a.endsWith('.sql'));
if(!output)throw new Error('Укажите путь к SQL-файлу');
await writeFile(output,lines.join('\n')+'\n');
console.log('Подготовлен импорт 8 уроков и писем без запуска цепочки. Существующие письма и уроки сохраняются; замена только через --replace-emails / --replace-lessons.');
