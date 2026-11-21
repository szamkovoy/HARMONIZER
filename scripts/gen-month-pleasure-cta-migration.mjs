import {readFile,writeFile} from 'node:fs/promises';
import {courseMarkdownHtml} from '../_legacy_web/app/api/_utils/courseSchedule.ts';
import {normalizeCourseLessonButtonSpacing} from '../_legacy_web/shared_core/courseLessonEmail.ts';
import {courseEmailHeaderHtml} from './courses-content.mjs';

const course=JSON.parse(await readFile('content/courses/month-pleasure.json','utf8'));
const HEADER=courseEmailHeaderHtml(course.emailHeader);
const q=s=>`'${String(s).replaceAll("'","''")}'`;
const STEPS={
  'month-pleasure-01':'0c26b947-251a-51cf-bcc8-acc896e54ad5',
  'month-pleasure-02':'21a8cc02-46f4-55a5-8085-f80a32baf312',
  'month-pleasure-03':'27ba9175-c8e4-5d5c-a26e-4429555889ff',
  'month-pleasure-04':'21e12317-8321-5e0a-8427-e967d7b4b068',
  'month-pleasure-05':'aa50ce5d-9aa9-5f66-b6c5-abacf9af1e62',
  'month-pleasure-06':'9533e345-3753-53ba-a846-8acdaada4038',
  'month-pleasure-07':'2846f467-863a-5689-a962-978ce9c71326',
};
const BUTTONS={
  'month-pleasure-01':['Открыть урок 1','#fc38be'],
  'month-pleasure-02':['Открыть урок 2','#fc38be'],
  'month-pleasure-03':['Открыть урок 3','#fc38be'],
  'month-pleasure-04':['Открыть доп. урок','#fc38be'],
  'month-pleasure-05':['Открыть урок 4','#fc38be'],
  'month-pleasure-06':['Открыть доп. урок','#fc38be'],
  'month-pleasure-07':['Открыть урок 5','#fc38be'],
};
function buttonHtml([label,color]){
  return `<p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:${color};border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:${color};mso-line-height-rule:exactly">${label}</a></p>`;
}
function lessonBody(markdown,lessonId){
  let md=markdown.replaceAll('{first_name}','{{name}}');
  md=md.replace('Первый (вводный) урок уже доступен вам в Гармонизаторе на вкладке «День». ','');
  let html=normalizeCourseLessonButtonSpacing(courseMarkdownHtml(md));
  if(!html.includes('{{course_lesson_url}}')){
    const btn=buttonHtml(BUTTONS[lessonId]);
    if(!html.includes('Нажмите кнопку ниже'))throw new Error(`Missing CTA in ${lessonId}`);
    html=html.replace(/(Нажмите кнопку ниже,[\s\S]+?вкладке «День»\.<\/p>)(\s*<p><\/p>)?/,`$1<p></p>${btn}<p></p>`);
    html=normalizeCourseLessonButtonSpacing(html);
  }
  if(!html.includes('{{course_lesson_url}}'))throw new Error(`No button in ${lessonId}`);
  return html;
}
const lines=['-- Month Pleasure: two-action CTA + GetCourse buttons (#fc38be).',''];
for(const lesson of course.lessons){
  const stepId=STEPS[lesson.id];
  const body=lessonBody(lesson.email.markdown,lesson.id);
  const fullHtml=HEADER+body;
  const blockId=`${lesson.id}-text`;
  const blocks=[course.emailHeader,{id:blockId,type:'text',html:body,align:'left',fontFamily:'system',fontSize:'md',marginTop:0,marginBottom:0}];
  lines.push(
    'update public.email_automation_steps set\n'+
    '  html_body='+q(fullHtml)+',\n'+
    "  html_body_i18n=jsonb_set(html_body_i18n,'{ru}',to_jsonb("+q(fullHtml)+"::text)),\n"+
    "  blocks_i18n=jsonb_set(blocks_i18n,'{ru}',"+q(JSON.stringify(blocks))+"::jsonb)\n"+
    "where id='"+stepId+"';",
  );
  lines.push('');
}
const path='supabase/migrations/20261121230000_month_pleasure_lesson_letters_cta.sql';
await writeFile(path,lines.join('\n'));
console.log('Wrote',path);