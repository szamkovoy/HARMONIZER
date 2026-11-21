/**
 * Month M+Ж: import HTML + replace ONLY wait invitation + #de6f90 button.
 */
import {readFile,writeFile} from 'node:fs/promises';
import {courseEmailHeaderHtml} from './courses-content.mjs';

const IMPORT_SQL='supabase/migrations/20261118180000_month_male_female_content.sql';
const OUT='supabase/migrations/20261122030000_month_male_female_lesson_letters_cta.sql';
const COLOR='#de6f90';
const q=s=>`'${String(s).replaceAll("'","''")}'`;

const STEPS={
  'month-male-female-01':'d5b816e9-ee23-5564-89d1-b402e0e42054',
  'month-male-female-02':'909eb9a6-bc27-595a-9d27-aabed619cb51',
  'month-male-female-03':'8d75dfd5-52cd-52fe-8602-1e120a15fd96',
  'month-male-female-04':'5918936c-e358-5282-8a06-909fe272dab3',
  'month-male-female-05':'3202b93b-a48d-5535-bcfc-73a5f59a676a',
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
    case 'month-male-female-01':
      return [[
        '<p>Урок ждёт вас в Гармонизаторе - на вкладке &quot;День&quot;.</p><p></p><p>Желаю',
        `<p>Нажмите кнопку ниже, чтобы открыть первый (вводный) урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p>${b('Урок 1')}<p></p><p>Желаю`,
      ]];
    case 'month-male-female-02':
      return [[
        '<p>Урок уже ждёт вас в Гармонизаторе на вкладке &quot;День&quot;.</p><p></p><p>До встречи',
        `<p>Нажмите кнопку ниже, чтобы открыть второй урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p>${b('Урок 2')}<p></p><p>До встречи`,
      ]];
    case 'month-male-female-03':
      return [[
        '<p>Урок ожидает вас в Гармонизаторе - на вкладке &quot;День&quot;.</p><p></p><p>До встречи',
        `<p>Нажмите кнопку ниже, чтобы открыть третий урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p>${b('Урок 3')}<p></p><p>До встречи`,
      ]];
    case 'month-male-female-04':
      return [[
        '<p>Урок ждёт вас в Гармонизаторе на вкладке &quot;День&quot;.</p><p></p><p>До встречи',
        `<p>Нажмите кнопку ниже, чтобы открыть четвёртый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p>${b('Урок 4')}<p></p><p>До встречи`,
      ]];
    case 'month-male-female-05':
      return [[
        '<p>Урок ждёт вас в Гармонизаторе, на вкладке &quot;День&quot;.</p><p></p><p>И, так как',
        `<p>Нажмите кнопку ниже, чтобы открыть пятый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p>${b('Урок 5')}<p></p><p>И, так как`,
      ]];
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
const course=JSON.parse(await readFile('content/courses/month-male-female.json','utf8'));
const HEADER=courseEmailHeaderHtml(course.emailHeader);

const lines=['-- Month M+Ж: CTA + GetCourse buttons (#de6f90); import HTML only.',''];

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

await writeFile(OUT,lines.join('\n')+'\n');
console.log('wrote',OUT);