/**
 * Month Freedom: import HTML + replace ONLY wait invitation + #6E9ECF button.
 */
import {readFile,writeFile} from 'node:fs/promises';
import {courseEmailHeaderHtml} from './courses-content.mjs';

const IMPORT_SQL='supabase/migrations/20261118150000_month_freedom_content.sql';
const OUT='supabase/migrations/20261121234000_month_freedom_lesson_letters_cta.sql';
const COLOR='#6E9ECF';
const q=s=>`'${String(s).replaceAll("'","''")}'`;

const STEPS={
  'month-freedom-01':'aa369f75-e047-535c-a433-9c5d8dcf9366',
  'month-freedom-02':'a0566599-ab24-505c-a3e1-90ff1043e248',
  'month-freedom-03':'4281828a-d19b-5848-8dd7-607607f55404',
  'month-freedom-04':'9e2c1f73-6c32-5c59-b5cc-7a1d709d5186',
  'month-freedom-05':'f1cd2c64-4f9b-5def-804e-f9d4110da98a',
  'month-freedom-06':'a6d2a486-d9eb-533f-80e0-b4698044265e',
  'month-freedom-07':'de955c05-5bff-5e5c-995c-e4dfec7f169b',
};

function parseQuoted(line,start){
  let value='';
  if(line[start]!=="'")throw new Error('expected quote');
  for(let i=start+1;i<line.length;i++){
    if(line[i]==="'"){
      if(line[i+1]==="'"){value+="'";i++;continue;}
      return {value,end:i+1};
    }
    value+=line[i];
  }
  throw new Error('unterminated string');
}

function parseImportStep(sql,id){
  const line=sql.split('\n').find(l=>l.includes(`'${id}'`));
  if(!line)throw new Error(`step ${id} not in import`);
  const marker=`blocks_i18n) values('${id}'`;
  let pos=line.indexOf(marker)+marker.length;
  for(let f=0;f<7;f++)pos=line.indexOf(',',pos)+1;
  return {htmlBody:parseQuoted(line,pos).value};
}

function button(label){
  return `<p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:${COLOR};border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:${COLOR};mso-line-height-rule:exactly">${label}</a></p>`;
}

/** @returns {Array<[string,string]>} */
function patchesFor(lessonId){
  const b=button;
  switch(lessonId){
    case 'month-freedom-01':
      return [[
        '<p>Первый урок ждёт вас в Гармонизаторе, на вкладке &quot;День&quot;.</p><p></p><p>Желаю',
        `<p>Нажмите кнопку ниже, чтобы открыть первый (вводный) урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p>${b('Урок 1')}<p></p><p>Желаю`,
      ]];
    case 'month-freedom-02':
      return [[
        '<p>Я надеюсь, что, пройдя первый урок, вы чётко сформулировали намерение на месяц, составили для себя план практик на каждый день, и уже приступили к их выполнению. А значит, вы готовы к первой глубокой исцеляющей практике. Урок уже ждёт вас в Гармонизаторе - на вкладке &quot;День&quot;.</p><p></p><p>До встречи',
        `<p>Я надеюсь, что, пройдя первый урок, вы чётко сформулировали намерение на месяц, составили для себя план практик на каждый день, и уже приступили к их выполнению. А значит, вы готовы к первой глубокой исцеляющей практике.</p><p></p><p>Нажмите кнопку ниже, чтобы открыть второй урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p>${b('Урок 2')}<p></p><p>До встречи`,
      ]];
    case 'month-freedom-03':
      return [[
        '<p>Движемся дальше в направлении гармоничного проявления состояний пятой чакры и здоровья органов, психосоматически с ней связанных. Урок ждёт вас в Гармонизаторе - на вкладке &quot;День&quot;.</p><p></p><p>Всех благ',
        `<p>Движемся дальше в направлении гармоничного проявления состояний пятой чакры и здоровья органов, психосоматически с ней связанных.</p><p></p><p>Нажмите кнопку ниже, чтобы открыть третий урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p>${b('Урок 3')}<p></p><p>Всех благ`,
      ]];
    case 'month-freedom-04':
      return [['<p>Урок уже ждёт вас в Гармонизаторе, на вкладке &quot;День“.</p><p></p>',`<p>Нажмите кнопку ниже, чтобы открыть дополнительную практику в браузере, или посмотрите её в Гармонизаторе на вкладке «День».</p><p></p>${b('Открыть доп. урок 1')}<p></p>`]];
    case 'month-freedom-05':
      return [['<p>Урок ждёт вас в Гармонизаторе, на вкладке &quot;День&quot;.</p><p></p><p>Всех благ',`<p>Нажмите кнопку ниже, чтобы открыть четвёртый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p>${b('Урок 4')}<p></p><p>Всех благ`]];
    case 'month-freedom-06':
      return [['<p>Урок уже ждёт вас в Гармонизаторе, на вкладке &quot;День&quot;.</p><p></p>',`<p>Нажмите кнопку ниже, чтобы открыть дополнительную практику в браузере, или посмотрите её в Гармонизаторе на вкладке «День».</p><p></p>${b('Открыть доп. урок 2')}<p></p>`]];
    case 'month-freedom-07':
      return [['<p>Урок ждёт вас в Гармонизаторе, на вкладке &quot;День“.</p><p></p><p>',`<p>Нажмите кнопку ниже, чтобы открыть пятый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p>${b('Урок 5')}<p></p><p>`]];
    default:
      throw new Error(lessonId);
  }
}

function applyPatches(html,lessonId){
  let out=html;
  for(const [from,to] of patchesFor(lessonId)){
    if(!out.includes(from))throw new Error(`${lessonId}: missing fragment ${from.slice(0,70)}…`);
    out=out.replace(from,to);
  }
  out=out.replace(
    /(<p style="text-align:center"><a href="\{\{course_lesson_url\}}"[\s\S]*?<\/a><\/p>)<p><\/p><p><\/p>/g,
    '$1<p></p>',
  );
  if(!out.includes('{{course_lesson_url}}'))throw new Error(`${lessonId}: no button after patch`);
  return out;
}

function stripHeader(fullHtml){
  const marker='</div><p>Здравствуйте';
  const i=fullHtml.indexOf(marker);
  if(i<0)throw new Error('header marker');
  return fullHtml.slice(i+'</div>'.length);
}

const sql=await readFile(IMPORT_SQL,'utf8');
const course=JSON.parse(await readFile('content/courses/month-freedom.json','utf8'));
const HEADER=courseEmailHeaderHtml(course.emailHeader);

const lines=['-- Month Freedom: CTA + GetCourse buttons (#6E9ECF); import HTML only.',''];

for(const [lessonId,stepId] of Object.entries(STEPS)){
  const imp=parseImportStep(sql,stepId);
  const body=applyPatches(stripHeader(imp.htmlBody),lessonId);
  const fullHtml=HEADER+body;
  const blockId=`${lessonId}-text`;
  const blocks=course.emailHeader
    ?[course.emailHeader,{id:blockId,type:'text',html:body,align:'left',fontFamily:'system',fontSize:'md',marginTop:0,marginBottom:0}]
    :[{id:blockId,type:'text',html:body,align:'left',fontFamily:'system',fontSize:'md',marginTop:0,marginBottom:0}];
  lines.push(`-- ${lessonId}`);
  lines.push('update public.email_automation_steps set');
  lines.push(`  html_body=${q(fullHtml)},`);
  lines.push(`  html_body_i18n=jsonb_set(html_body_i18n,'{ru}',to_jsonb(${q(fullHtml)}::text)),`);
  lines.push(`  blocks_i18n=jsonb_set(blocks_i18n,'{ru}',${q(JSON.stringify(blocks))}::jsonb)`);
  lines.push(`where id='${stepId}';`);
  lines.push('');
}

await writeFile(OUT,lines.join('\n'));
console.log('Wrote',OUT);