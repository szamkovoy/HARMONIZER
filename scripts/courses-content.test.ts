import {readFile} from 'node:fs/promises';
import {URL} from 'node:url';
import {describe,expect,it} from 'vitest';
import {parseCourseReview} from './courses-content.mjs';
import {generateCourseImportSql} from './course-import-sql.mjs';
describe('approved month-health materials',()=>{
 it('preserves the authored program, ordered video blocks and both catalog bonuses',async()=>{
  const source=await readFile(new URL('../content/courses/month-health.review.md',import.meta.url),'utf8');
  const course=parseCourseReview(source);const imported=JSON.parse(await readFile(new URL('../content/courses/month-health.json',import.meta.url),'utf8'));
  expect(course).toEqual(imported);expect(course.lessons.map(l=>l.gapDays)).toEqual([0,2,7,3,4,3,4,3]);
  const videos=course.lessons.flatMap(l=>l.blocks).filter(b=>b.type==='video'&&'vimeoId' in b);
  expect(videos).toHaveLength(9);expect(new Set(videos.map(v=>'vimeoId' in v?v.vimeoId:null)).size).toBe(9);
  expect(videos.filter(v=>'practiceId' in v&&v.practiceId)).toHaveLength(2);
  expect(course.lessons[6].blocks.some(b=>'vimeoId' in b&&b.vimeoId==='1149520174')).toBe(true);
  expect(course.lessons[7].blocks.some(b=>'vimeoId' in b&&b.vimeoId==='1149520174')).toBe(false);
  for(const lesson of course.lessons){expect(lesson.email.markdown).not.toContain('Для вашей правки');expect(JSON.stringify(lesson.blocks)).not.toContain('Сверить с источником');}
 });
});

describe('another practicum with an independent completion letter',()=>{
 it('extracts seven real materials and eight letters without leaking pilot IDs or gaps',async()=>{
  const source=await readFile(new URL('./fixtures/course-completion.review.md',import.meta.url),'utf8');
  const c=parseCourseReview(source);
  expect(c.slug).toBe('fixture-completion');expect(c.lessons).toHaveLength(7);expect(c.completionEmail?.subject).toBe('Практикум завершён');
  expect(c.lessons.map(l=>l.gapDays)).toEqual([0,2,7,3,4,3,4]);
  expect(c.lessons[3].blocks).toEqual([{type:'text',markdown:'Текст до видео 4.'},{type:'video',vimeoId:'12345004',practiceId:'00000000-0000-4000-8000-000000000099'},{type:'text',markdown:'Текст после видео 4.'}]);
  expect(c.completionEmail?.markdown).not.toContain('Источники');expect(c.completionEmail?.markdown).not.toContain('Урок ждёт');
  expect(JSON.stringify(c)).not.toContain('month-health');expect(JSON.stringify(c)).not.toContain('1149520174');
 });
 it('requires explicit gaps and the approved three-day completion interval',async()=>{
  const source=await readFile(new URL('./fixtures/course-completion.review.md',import.meta.url),'utf8');
  expect(()=>parseCourseReview(source.replace('**Когда открывается:** через 7 дней',''))).toThrow();
  expect(()=>parseCourseReview(source.replace('через 3 дня после последнего урока','через 5 дней после последнего урока'))).toThrow();
  expect(()=>parseCourseReview(source.replace('**Код курса:** fixture-completion',''))).toThrow();
 });
});


it('rejects unsupported standalone introductory mail instead of silently dropping it',async()=>{
 const source=await readFile(new URL('./fixtures/course-completion.review.md',import.meta.url),'utf8');
 expect(()=>parseCourseReview(source+'\n## Вводное письмо\n\n### Письмо\n\n**Тема:** Введение\n\nТекст\n')).toThrow(/вводные/);
});

describe('optional course landing page',()=>{
 it.each(['','**Лендинг:** '])('imports a reviewed course without a landing URL (%s)',async replacement=>{
  const source=await readFile(new URL('./fixtures/course-completion.review.md',import.meta.url),'utf8');
  const course=parseCourseReview(source.replace(/^\*\*Лендинг:\*\* .*$/m,replacement));
  expect(course.landingUrl).toBe('');
  const sql=generateCourseImportSql(course);
  expect(sql).toContain(`'${course.kind}','',${course.accessDays},`);
  expect(course.lessons).toHaveLength(7);expect(course.completionEmail).toBeDefined();
 });
 it('accepts older JSON with the optional field omitted and retains a supplied HTTPS URL',async()=>{
  const source=await readFile(new URL('./fixtures/course-completion.review.md',import.meta.url),'utf8');
  const course=parseCourseReview(source);const {landingUrl,...withoutLanding}=course;
  expect(generateCourseImportSql(withoutLanding)).toContain(`'${course.kind}','',${course.accessDays},`);
  expect(generateCourseImportSql(course)).toContain(landingUrl);
 });
 it('still rejects a supplied invalid URL instead of silently substituting another page',async()=>{
  const source=await readFile(new URL('./fixtures/course-completion.review.md',import.meta.url),'utf8');
  expect(()=>parseCourseReview(source.replace(/^\*\*Лендинг:\*\* .*$/m,'**Лендинг:** http://example.test'))).toThrow(/HTTPS/);
  expect(()=>generateCourseImportSql({...parseCourseReview(source),landingUrl:'not-a-url'})).toThrow();
 });
});
