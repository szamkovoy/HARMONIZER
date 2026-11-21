/**
 * Month Holiness: import HTML + replace ONLY wait invitation + #bf56a5 button.
 */
import {readFile,writeFile} from 'node:fs/promises';
import {courseEmailHeaderHtml} from './courses-content.mjs';

const IMPORT_SQL='supabase/migrations/20261118170000_month_holiness_content.sql';
const OUT='supabase/migrations/20261122020000_month_holiness_lesson_letters_cta.sql';
const COLOR='#bf56a5';
const q=s=>`'${String(s).replaceAll("'","''")}'`;

const STEPS={
  'month-holiness-01':'a9cb4a45-5762-5ce9-8eb8-5bedb43ab6b7',
  'month-holiness-02':'678e59e7-6875-5fb5-b705-552f0acad4a8',
  'month-holiness-03':'65d7df5b-db13-5433-b399-2b3064abccf0',
  'month-holiness-04':'5a095cb3-1c0b-57e6-b06a-16d4ed722e73',
  'month-holiness-05':'2d7cb280-d7c1-545e-8b15-ba3264929461',
  'month-holiness-06':'4d843a2a-5915-55dd-8993-f2025c8d55b0',
  'month-holiness-07':'2c19d6e9-be1a-5035-9af5-8d02e4a8a31b',
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
    case 'month-holiness-01':
      return [[
        '<p>Первый урок ждёт вас в Гармонизаторе на вкладке &quot;День&quot;.</p><p></p><p>Желаю',
        `<p>Нажмите кнопку ниже, чтобы открыть первый (вводный) урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p>${b('Урок 1')}<p></p><p>Желаю`,
      ]];
    case 'month-holiness-02':
      return [[
        '<p>Урок ждёт вас в Гармонизаторе на вкладке &quot;День&quot;.</p><p></p><p>До встречи',
        `<p>Нажмите кнопку ниже, чтобы открыть второй урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p>${b('Урок 2')}<p></p><p>До встречи`,
      ]];
    case 'month-holiness-03':
      return [[
        '<p>Урок ждёт вас в Гармонизаторе - на вкладке &quot;День&quot;.</p><p></p><p>До встречи',
        `<p>Нажмите кнопку ниже, чтобы открыть третий урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p>${b('Урок 3')}<p></p><p>До встречи`,
      ]];
    case 'month-holiness-04':
      return [[
        '<p>Урок ждёт вас в Гармонизаторе, на вкладке &quot;День&quot;.</p><p></p>',
        `<p>Нажмите кнопку ниже, чтобы открыть дополнительную практику в браузере, или посмотрите её в Гармонизаторе на вкладке «День».</p><p></p>${b('Открыть доп. урок 1')}<p></p>`,
      ]];
    case 'month-holiness-05':
      return [[
        '<p>Урок ждёт вас в Гармонизаторе на вкладке „День“.</p><p></p><p>До встречи',
        `<p>Нажмите кнопку ниже, чтобы открыть четвёртый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p>${b('Урок 4')}<p></p><p>До встречи`,
      ]];
    case 'month-holiness-06':
      return [[
        '<p>Данная практика ждёт вас в Гармонизаторе, на вкладке &quot;День&quot;.</p><p></p>',
        `<p>Нажмите кнопку ниже, чтобы открыть дополнительную практику в браузере, или посмотрите её в Гармонизаторе на вкладке «День».</p><p></p>${b('Открыть доп. урок 2')}<p></p>`,
      ]];
    case 'month-holiness-07':
      return [[
        '<p>Урок уже ждёт вас в Гармонизаторе - на вкладке „День“.</p><p></p><p>',
        `<p>Нажмите кнопку ниже, чтобы открыть пятый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p>${b('Урок 5')}<p></p><p>`,
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
const course=JSON.parse(await readFile('content/courses/month-holiness.json','utf8'));
const HEADER=courseEmailHeaderHtml(course.emailHeader);

const lines=['-- Month Holiness: CTA + GetCourse buttons (#bf56a5); import HTML only.',''];

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