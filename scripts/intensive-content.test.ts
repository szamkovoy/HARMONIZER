import {readFileSync} from 'node:fs';
import {describe,it,expect,vi} from 'vitest';
import {intensiveReview,parseIntensiveReview} from './intensive-content.mjs';
import {translateIntensive,validateIntensiveTranslation} from './intensive-translate.mjs';
import {generateIntensiveImportSql} from './intensive-import-sql.mjs';
const templates=JSON.parse(readFileSync('content/intensives/templates/ru.json','utf8'));
const raw=()=>({slug:'intensive-fixture',title:'Интенсив «Здоровье»',templateKey:'health',emailHeader:{src:'https://example.test/header.png',naturalWidth:600,naturalHeight:200},lessons:Array.from({length:30},(_,i)=>({vimeoId:String(100000+i),sourceUrl:`https://example.test/lesson/${i+1}`})),advice:Array.from({length:29},(_,i)=>({sourceNumber:i+1,markdown:`Совет ${i+1}.`,sourceUrl:`https://example.test/mail/${i+1}`}))});
const content=()=>parseIntensiveReview(intensiveReview(raw(),templates));
describe('intensive author review and machine import',()=>{
 it('retains the 30 videos in list order, 29 unique tips and the original letters',()=>{
  const parsed=content();expect(parsed.lessons).toHaveLength(30);
  expect(parsed.lessons.map((l:any)=>l.blocks[0].vimeoId)).toEqual(raw().lessons.map(l=>l.vimeoId));
  expect(parsed.lessons[29].blocks[1].markdown).toContain('### Что дальше?');
  expect(parsed.introEmail.ru.markdown).toBe(templates.programs.health.introEmail.markdown);
  expect(parsed.introEmail.ru.markdown).toContain('Каждый день в письме');
  expect(parseIntensiveReview(intensiveReview(raw(),templates).replace(/\n/g,'\r\n')).introEmail.ru.markdown).toBe(parsed.introEmail.ru.markdown);
  for(const program of Object.values(templates.programs) as any[])expect(program.introEmail.markdown.match(/^\*\*[1-7]\./gm)).toHaveLength(7);
 });
 it('rejects missing/repeated sources and advice instead of silently losing data',()=>{
  const repeated=raw();repeated.advice[1].markdown=repeated.advice[0].markdown;
  expect(()=>intensiveReview(repeated,templates)).toThrow('Повторяется');
  expect(()=>intensiveReview({...raw(),lessons:raw().lessons.slice(0,29)},templates)).toThrow('30');
  expect(()=>parseIntensiveReview(intensiveReview(raw(),templates)+'\n## Неизвестное письмо\nТекст\n')).toThrow('не должны теряться');
 });
 it('requires all eight locales and generates exactly two letters without starting a grant',async()=>{
  expect(()=>generateIntensiveImportSql(content())).toThrow('en');
  const translated=await translateIntensive(content(),{},async(locale:string,batch:Record<string,string>)=>Object.fromEntries(Object.entries(batch).map(([key,text])=>[key,text+' '+locale])));
  const sql=generateIntensiveImportSql(translated);
  expect(sql.match(/insert into public.email_automation_steps/g)).toHaveLength(2);
  expect(sql.match(/insert into public.course_lessons/g)).toHaveLength(30);
  expect(sql).not.toMatch(/start_course|start_intensive|insert into public.course_enrollments/);
  expect(sql).toContain('do nothing');expect(sql).toContain('Lesson belongs to another course');
 });
 it('reuses every cached fragment on repeat and keeps RU intact',async()=>{
  const cache={};const translate=vi.fn(async(locale:string,batch:Record<string,string>)=>Object.fromEntries(Object.entries(batch).map(([key,text])=>[key,text+' '+locale])));
  const ru=JSON.stringify(content().introEmail.ru);
  const result=await translateIntensive(content(),cache,translate);expect(JSON.stringify(result.introEmail.ru)).toBe(ru);
  expect(translate).toHaveBeenCalled();translate.mockClear();
  await translateIntensive(content(),cache,translate);expect(translate).not.toHaveBeenCalled();
 });
 it('retries only damaged translation fragments and preserves already validated cache entries',async()=>{
  let first=true;
  const translate=vi.fn(async(locale:string,batch:Record<string,string>)=>{
   const result=Object.fromEntries(Object.entries(batch).map(([key,text])=>[key,text+' '+locale]));
   if(first){first=false;result[Object.keys(batch)[0]]='';}return result;
  });
  await translateIntensive(content(),{},translate);
  expect(Object.keys(translate.mock.calls[1][1])).toHaveLength(1);
 });
 it('rejects translations that change URLs, variables or spacing',()=>{
  expect(()=>validateIntensiveTranslation('Текст {{name}} https://example.test/a','Text https://evil.test')).toThrow();
  expect(()=>validateIntensiveTranslation('Текст\nПодпись','Text signature')).toThrow();
 });
});
