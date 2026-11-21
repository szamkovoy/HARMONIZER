/**
 * Month Strength lesson letters: restore import HTML, replace ONLY the old
 * «ждёт на вкладке День» invitation + insert GetCourse button (#F89C26).
 * Does not re-render markdown (preserves section layout from import).
 */
import {readFile,writeFile} from 'node:fs/promises';
import {courseEmailHeaderHtml} from './courses-content.mjs';

const IMPORT_SQL='supabase/migrations/20261118060000_month_strength_content.sql';
const OUT='supabase/migrations/20261121232000_month_strength_lesson_letters_cta_fixup.sql';
const COLOR='#F89C26';
const q=s=>`'${String(s).replaceAll("'","''")}'`;

const STEPS={
  'month-strength-01':'f3b42871-fc01-5aa4-a8b4-44b0e6e0cc65',
  'month-strength-02':'09f5c757-1e24-5cc9-8a19-e1246d4f08da',
  'month-strength-03':'28f85d5c-7162-5544-b7ed-43a2e5bad7a2',
  'month-strength-04':'b52b80a0-67b9-5e76-9cc6-e4887b467ff1',
  'month-strength-05':'b52798a7-f3e2-5f9a-a21c-c4985eb9275a',
  'month-strength-06':'84a93dad-88bd-589c-a284-f66d491759f7',
  'month-strength-07':'6bdc99e1-38eb-5ca1-aa0c-3774974b4724',
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
  const htmlBody=parseQuoted(line,pos);
  pos=htmlBody.end;
  if(!line.slice(pos).startsWith(',\'{"ru"'))throw new Error('html_body_i18n');
  const comma=line.indexOf(',',pos);
  pos=comma+1;
  const htmlBodyI18n=parseQuoted(line,pos);
  pos=htmlBodyI18n.end;
  pos=line.indexOf(',',pos)+1;
  const blocksI18n=parseQuoted(line,pos);
  return {
    htmlBody:htmlBody.value,
    htmlBodyI18n:JSON.parse(htmlBodyI18n.value),
    blocksI18n:JSON.parse(blocksI18n.value),
  };
}

function button(label){
  return `<p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:${COLOR};border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:${COLOR};mso-line-height-rule:exactly">${label}</a></p>`;
}

/** @returns {Array<[string,string]>} */
function patchesFor(lessonId){
  const b=button;
  switch(lessonId){
    case 'month-strength-01':
      return [['<p>Урок уже ждёт вас в Гармонизаторе, на вкладке „День“.</p>',`<p>Нажмите кнопку ниже, чтобы открыть первый (вводный) урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p>${b('Открыть урок 1')}<p></p>`]];
    case 'month-strength-02':
      return [['<p>Урок уже ждёт вас в Гармонизаторе, на вкладке „День“.</p><p></p>',`<p>Нажмите кнопку ниже, чтобы открыть второй урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p>${b('Открыть урок 2')}<p></p>`]];
    case 'month-strength-03':
      return [[
        '<p>Движемся дальше в направлении здоровья органов ЖКТ и гармоничного проявления состояний третьей чакры. Третий урок уже ждёт вас в Гармонизаторе, на вкладке &quot;День“.</p><p></p><p>До встречи',
        `<p>Движемся дальше в направлении здоровья органов ЖКТ и гармоничного проявления состояний третьей чакры.</p><p></p><p>Нажмите кнопку ниже, чтобы открыть третий урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p>${b('Открыть урок 3')}<p></p><p>До встречи`,
      ]];
    case 'month-strength-04':
      return [['<p>Урок уже ждёт вас в Гармонизаторе, на вкладке &quot;День“.</p><p></p>',`<p>Нажмите кнопку ниже, чтобы открыть дополнительную практику в браузере, или посмотрите её в Гармонизаторе на вкладке «День».</p><p></p>${b('Открыть доп. урок')}<p></p>`]];
    case 'month-strength-05':
      return [['<p>Урок уже ждёт вас в Гармонизаторе, на вкладке „День“.</p><p></p>',`<p>Нажмите кнопку ниже, чтобы открыть четвёртый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p>${b('Открыть урок 4')}<p></p>`]];
    case 'month-strength-06':
      return [['<p>Урок уже ждёт вас в Гармонизаторе, на вкладке „День“.</p><p></p>',`<p>Нажмите кнопку ниже, чтобы открыть дополнительную практику в браузере, или посмотрите её в Гармонизаторе на вкладке «День».</p><p></p>${b('Открыть доп. урок')}<p></p>`]];
    case 'month-strength-07':
      return [['<p>Урок уже ждёт вас в Гармонизаторе, на вкладке „День“.</p><p></p><p>',`<p>Нажмите кнопку ниже, чтобы открыть пятый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p>${b('Открыть урок 5')}<p></p><p>`]];
    default:
      throw new Error(lessonId);
  }
}

function applyPatches(html,lessonId){
  let out=html;
  for(const [from,to] of patchesFor(lessonId)){
    if(!out.includes(from))throw new Error(`${lessonId}: missing fragment ${from.slice(0,60)}…`);
    out=out.replace(from,to);
  }
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
const course=JSON.parse(await readFile('content/courses/month-strength.json','utf8'));
const HEADER=courseEmailHeaderHtml(course.emailHeader);

const lines=[
  '-- Month Strength: restore import letter HTML; CTA + #F89C26 button only.',
  '-- Reverts over-broad 20261121231000 markdown re-render.',
  '',
];

for(const [lessonId,stepId] of Object.entries(STEPS)){
  const imp=parseImportStep(sql,stepId);
  const bodyFromImport=stripHeader(imp.htmlBody);
  const body=applyPatches(bodyFromImport,lessonId);
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