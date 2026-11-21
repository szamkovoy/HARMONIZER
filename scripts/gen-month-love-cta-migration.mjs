/**
 * Month Love: import HTML + replace ONLY wait invitation + #569c19 button.
 */
import {readFile,writeFile} from 'node:fs/promises';
import {courseEmailHeaderHtml} from './courses-content.mjs';

const IMPORT_SQL='supabase/migrations/20261118080000_month_love_content.sql';
const OUT='supabase/migrations/20261121233000_month_love_lesson_letters_cta.sql';
const COLOR='#569c19';
const q=s=>`'${String(s).replaceAll("'","''")}'`;

const STEPS={
  'month-love-01':'9ced276a-d690-585e-a584-c4549476cc04',
  'month-love-02':'42bc1762-9a13-5963-bdd5-3ea0e5f950a7',
  'month-love-03':'dce9025b-79f7-52bb-b59c-6878efbe78b9',
  'month-love-04':'b3506cf1-55c7-5f48-9e64-a4f63327b1cf',
  'month-love-05':'e4d17696-cfb3-5b07-8946-db525d9a2919',
  'month-love-06':'8c6ef150-9141-5b93-a9a6-b9792090f84c',
  'month-love-07':'b3fded35-19a8-5972-8e91-9b5e85e78d75',
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
  return {htmlBody:htmlBody.value};
}

function button(label){
  return `<p style="text-align:center"><a href="{{course_lesson_url}}" target="_blank" style="border-style:solid;border-color:${COLOR};border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:${COLOR};mso-line-height-rule:exactly">${label}</a></p>`;
}

/** @returns {Array<[string,string]>} */
function patchesFor(lessonId){
  const b=button;
  switch(lessonId){
    case 'month-love-01':
      return [[
        '<p>Первый урок уже ждёт вас в Гармонизаторе - на вкладке &quot;День&quot;.</p><p></p><p>Желаю',
        `<p>Нажмите кнопку ниже, чтобы открыть первый (вводный) урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p>${b('Открыть урок 1')}<p></p><p>Желаю`,
      ]];
    case 'month-love-02':
      return [[
        '<p>Я надеюсь, что, пройдя первый урок, вы чётко сформулировали намерение на месяц, составили для себя личный план практик на каждый день, и уже приступили к их выполнению. А значит, вы готовы к первой глубокой исцеляющей практике. Урок уже ждёт вас в Гармонизаторе, на вкладке &quot;День&quot;.</p><p></p><p>До встречи',
        `<p>Я надеюсь, что, пройдя первый урок, вы чётко сформулировали намерение на месяц, составили для себя личный план практик на каждый день, и уже приступили к их выполнению. А значит, вы готовы к первой глубокой исцеляющей практике.</p><p></p><p>Нажмите кнопку ниже, чтобы открыть второй урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p>${b('Открыть урок 2')}<p></p><p>До встречи`,
      ]];
    case 'month-love-03':
      return [[
        '<p>Движемся дальше в направлении здоровья органов грудной клетки и гармоничного проявления состояний анахаты. Урок уже ждёт вас в Гармонизаторе на вкладке &quot;День&quot;.</p><p></p><p>До встречи',
        `<p>Движемся дальше в направлении здоровья органов грудной клетки и гармоничного проявления состояний анахаты.</p><p></p><p>Нажмите кнопку ниже, чтобы открыть третий урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p>${b('Открыть урок 3')}<p></p><p>До встречи`,
      ]];
    case 'month-love-04':
      return [['<p>Урок ждёт вас в Гармонизаторе на вкладке &quot;День&quot;.</p><p></p>',`<p>Нажмите кнопку ниже, чтобы открыть дополнительную практику в браузере, или посмотрите её в Гармонизаторе на вкладке «День».</p><p></p>${b('Открыть доп. урок')}<p></p>`]];
    case 'month-love-05':
      return [[
        'А сейчас пришло время четвертого урока. Он ждёт вас в Гармонизаторе - на вкладке &quot;День&quot;.</p><p></p><p>До встречи',
        'А сейчас пришло время четвертого урока.</p><p></p><p>Нажмите кнопку ниже, чтобы открыть четвёртый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p>'+b('Открыть урок 4')+'<p></p><p>До встречи',
      ]];
    case 'month-love-06':
      return [['<p>Урок ждёт вас в Гармонизаторе на вкладке &quot;День&quot;.</p><p></p>',`<p>Нажмите кнопку ниже, чтобы открыть дополнительную практику в браузере, или посмотрите её в Гармонизаторе на вкладке «День».</p><p></p>${b('Открыть доп. урок')}<p></p>`]];
    case 'month-love-07':
      return [['<p>Урок ждёт вас в Гармонизаторе на вкладке &quot;День&quot;.</p><p></p><p>',`<p>Нажмите кнопку ниже, чтобы открыть пятый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p>${b('Открыть урок 5')}<p></p><p>`]];
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
const course=JSON.parse(await readFile('content/courses/month-love.json','utf8'));
const HEADER=courseEmailHeaderHtml(course.emailHeader);

const lines=['-- Month Love: CTA + GetCourse buttons (#569c19); import HTML only.',''];

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