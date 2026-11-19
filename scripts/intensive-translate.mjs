import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {intensiveLocales} from './intensive-content.mjs';

const digest=text=>createHash('sha256').update('intensive-v1\n'+text).digest('hex');
const pieces=text=>text.split(/(\n[ \t\u00a0]*\n(?:[ \t\u00a0]*\n)*)/);
const separators=text=>/^\n[ \t\u00a0]*\n/.test(text);
const names={en:'English',de:'German',fr:'French',it:'Italian',es:'Spanish',pt:'Portuguese',nl:'Dutch'};
const urls=text=>(text.match(/https:\/\/[^\s)<>]+/g)??[]).sort();
const placeholders=text=>(text.match(/\{\{[^}]+\}\}/g)??[]).sort();
export function validateIntensiveTranslation(source,target){
 if(typeof target!=='string'||!target.trim()||JSON.stringify(urls(source))!==JSON.stringify(urls(target))||JSON.stringify(placeholders(source))!==JSON.stringify(placeholders(target))||(source.match(/\n/g)??[]).length!==(target.match(/\n/g)??[]).length||(source.match(/\*\*/g)??[]).length!==(target.match(/\*\*/g)??[]).length)throw new Error('Перевод изменил ссылки, переменные, выделение или переводы строк');
 return target;
}
/** Paragraph hashes shared by all seven imports avoid translating repeated email copy again. */
export async function translateIntensive(course,cache,translateBatch,saveCache=async()=>{}){
 const source=[course.title,course.introEmail.ru.subject,course.introEmail.ru.markdown,course.completionEmail.ru.subject,course.completionEmail.ru.markdown,...course.lessons.map(l=>l.blocks[1].markdown)];
 const unique=new Map();for(const text of source)for(const part of pieces(text))if(part&&!separators(part))unique.set(digest(part),part);
 for(const locale of intensiveLocales.filter(l=>l!=='ru')){
  const entries=cache[locale]??={};let batch={};let size=0;
  const flush=async()=>{
   if(!Object.keys(batch).length)return;
   let pending=batch;
   for(let attempt=0;attempt<2&&Object.keys(pending).length;attempt++){
    const result=await translateBatch(locale,pending,attempt);const invalid={};
    for(const [key,text] of Object.entries(pending)){
     try{entries[key]=validateIntensiveTranslation(text,result?.[key]);}catch{invalid[key]=text;}
    }
    await saveCache(cache);pending=invalid;
   }
   if(Object.keys(pending).length)throw new Error(`Перевод ${locale}: ${Object.keys(pending).length} фрагментов не сохранили формат после повтора; исправные уже в кэше`);
   batch={};size=0;
  };
  for(const [key,text] of unique){
   if(entries[key]){validateIntensiveTranslation(text,entries[key]);continue;}
   if(size+text.length>10000)await flush();batch[key]=text;size+=text.length;
  }
  await flush();
  const translated=text=>pieces(text).map(part=>!part||separators(part)?part:entries[digest(part)]).join('');
  course.titleI18n[locale]=translated(course.title);
  for(const field of ['introEmail','completionEmail'])course[field][locale]={subject:translated(course[field].ru.subject),markdown:translated(course[field].ru.markdown)};
  for(const lesson of course.lessons)lesson.blocksI18n[locale]=[{...lesson.blocks[0]},{type:'text',markdown:translated(lesson.blocks[1].markdown)}];
 }
 return course;
}
export function createIntensiveTranslator(){
 const key=process.env.I18N_TRANSLATE_API_KEY??process.env.DEEPSEEK_API_KEY;
 const model=process.env.I18N_TRANSLATE_MODEL??process.env.AI_MODEL_STANDARD??process.env.AI_MODEL_PREMIUM;
 const url=process.env.I18N_TRANSLATE_API_URL??`${(process.env.DEEPSEEK_BASE_URL??'https://api.deepseek.com').replace(/\/$/,'')}/v1/chat/completions`;
 if(!key||!model)throw new Error('Настройте I18N_TRANSLATE_API_* либо DEEPSEEK_API_KEY и AI_MODEL_STANDARD; секреты в чат не выводить');
 return async(locale,batch,attempt=0)=>{
  console.log(`${locale}: перевод ${Object.keys(batch).length} новых фрагментов`);
  const result=await fetch(url,{method:'POST',signal:AbortSignal.timeout(180000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify({model,temperature:0.2,messages:[
   {role:'system',content:`Translate these Russian yoga intensive texts faithfully into ${names[locale]}. Preserve meaning and author voice, do not shorten or correct claims or add advice. Preserve Markdown, all URLs, {{placeholders}}, numbered headings, and the EXACT number and positions of line breaks. Each JSON value is a standalone paragraph or title. Return only a JSON object with exactly the original keys.${attempt?' The previous output changed protected formatting. Copy URLs and placeholders verbatim, preserve every ** marker and newline, and do not append punctuation to URLs.':''}`},
   {role:'user',content:JSON.stringify(batch)}]})});
  if(!result.ok)throw new Error(`Перевод: HTTP ${result.status}`);
  const data=await result.json();const text=data.choices?.[0]?.message?.content??'';
  return JSON.parse(text.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim());
 };
}
async function atomic(path,data){const temp=path+'.'+process.pid+'.'+Math.random().toString(36).slice(2)+'.tmp';await mkdir(dirname(path),{recursive:true});await writeFile(temp,JSON.stringify(data,null,2)+'\n');await rename(temp,path);}
if(process.argv[1]?.endsWith('/intensive-translate.mjs')){
 const input=process.argv[2];if(!input)throw new Error('node --env-file=.env.local scripts/intensive-translate.mjs course.json [cache-directory]');
 const course=JSON.parse(await readFile(input,'utf8'));const translate=createIntensiveTranslator();
 // Separate files per paragraph allow parallel course imports to share the cache safely.
 const dir=resolve(process.argv[3]??'content/intensives/translations');await mkdir(dir,{recursive:true});const cache={};
 const texts=[course.title,course.introEmail.ru.subject,course.introEmail.ru.markdown,course.completionEmail.ru.subject,course.completionEmail.ru.markdown,...course.lessons.map(l=>l.blocks[1].markdown)];
 for(const locale of intensiveLocales.filter(l=>l!=='ru')){
  cache[locale]={};for(const part of new Set(texts.flatMap(pieces).filter(p=>p&&!separators(p)))){
   const id=digest(part);try{const value=JSON.parse(await readFile(resolve(dir,locale,id+'.json'),'utf8'));cache[locale][id]=validateIntensiveTranslation(part,value.text);}catch(error){if(error.code!=='ENOENT')throw error;}
  }
 }
 const saved=new Set();for(const [locale,entries] of Object.entries(cache))for(const key of Object.keys(entries))saved.add(locale+'/'+key);
 const result=await translateIntensive(course,cache,translate,async current=>{
  for(const [locale,entries] of Object.entries(current))for(const [key,text] of Object.entries(entries))if(!saved.has(locale+'/'+key)){
   await atomic(resolve(dir,locale,key+'.json'),{text});saved.add(locale+'/'+key);
  }
 });
 await atomic(input,result);console.log('Готовы восемь локалей. Авторский Markdown не изменён; повторяющиеся фрагменты сохранены в общем кэше.');
}
