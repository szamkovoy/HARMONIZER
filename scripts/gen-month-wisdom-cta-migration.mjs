/**
 * Month Wisdom: import HTML + replace ONLY wait invitation + #156abf button.
 */
import {readFile,writeFile} from 'node:fs/promises';
import {courseEmailHeaderHtml} from './courses-content.mjs';

const IMPORT_SQL='supabase/migrations/20261118160000_month_wisdom_content.sql';
const OUT='supabase/migrations/20261121235000_month_wisdom_lesson_letters_cta.sql';
const COLOR='#156abf';
const q=s=>`'${String(s).replaceAll("'","''")}'`;

const STEPS={
  'month-wisdom-01':'1b8e2b8d-18fc-53e4-9ba5-9cda8f5c6031',
  'month-wisdom-02':'0fe3e7b0-0b01-5a56-804e-81fd1a5637ff',
  'month-wisdom-03':'7867efa7-d83e-51a7-8df9-4c386f5cf012',
  'month-wisdom-04':'fc123961-3e3c-5e55-b685-4440c662d41f',
  'month-wisdom-05':'9c3ad33f-efbc-5246-b6dc-4692cabf96b7',
  'month-wisdom-06':'cc44270b-8345-5fa0-9caa-d90086841085',
  'month-wisdom-07':'acc7528e-b883-53df-b69c-8eafe16bb09a',
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
    case 'month-wisdom-01':
      return [[
        '<p>Урок ждёт вас в Гармонизаторе, на вкладке &quot;День&quot;.</p><p></p><p>Желаю',
        `<p>Нажмите кнопку ниже, чтобы открыть первый (вводный) урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p>${b('Урок 1')}<p></p><p>Желаю`,
      ]];
    case 'month-wisdom-02':
      return [['<p>Урок ждёт вас в Гармонизаторе - на вкладке &quot;День&quot;.</p><p></p><p>До встречи',`<p>Нажмите кнопку ниже, чтобы открыть второй урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p>${b('Урок 2')}<p></p><p>До встречи`]];
    case 'month-wisdom-03':
      return [['<p>Урок уже ждёт вас в Гармонизаторе на вкладке &quot;День&quot;.</p><p></p><p>До встречи',`<p>Нажмите кнопку ниже, чтобы открыть третий урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p>${b('Урок 3')}<p></p><p>До встречи`]];
    case 'month-wisdom-04':
      return [['<p>Урок уже ждёт вас в Гармонизаторе на вкладке &quot;День&quot;.</p><p></p>',`<p>Нажмите кнопку ниже, чтобы открыть дополнительную практику в браузере, или посмотрите её в Гармонизаторе на вкладке «День».</p><p></p>${b('Открыть доп. урок 1')}<p></p>`]];
    case 'month-wisdom-05':
      return [[
        'А сейчас пришло время четвертого урока. Он ждёт вас в Гармонизаторе - на вкладке &quot;День&quot;.</p><p></p><p>До встречи',
        'А сейчас пришло время четвертого урока.</p><p></p><p>Нажмите кнопку ниже, чтобы открыть четвёртый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p>'+b('Урок 4')+'<p></p><p>До встречи',
      ]];
    case 'month-wisdom-06':
      return [['<p>Данная практика ждёт вас в Гармонизаторе, на вкладке &quot;День&quot;.</p><p></p>',`<p>Нажмите кнопку ниже, чтобы открыть дополнительную практику в браузере, или посмотрите её в Гармонизаторе на вкладке «День».</p><p></p>${b('Открыть доп. урок 2')}<p></p>`]];
    case 'month-wisdom-07':
      return [['<p>Урок ждёт вас в Гармонизаторе на вкладке &quot;День&quot;.</p><p></p><p>',`<p>Нажмите кнопку ниже, чтобы открыть пятый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p>${b('Урок 5')}<p></p><p>`]];
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
const course=JSON.parse(await readFile('content/courses/month-wisdom.json','utf8'));
const HEADER=courseEmailHeaderHtml(course.emailHeader);

const lines=['-- Month Wisdom: CTA + GetCourse buttons (#156abf); import HTML only.',''];

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