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


describe('letter images',()=>{
 it('keeps one text block when a letter has no inline image',async()=>{
  const source=await readFile(new URL('./fixtures/course-completion.review.md',import.meta.url),'utf8');
  const sql=generateCourseImportSql(parseCourseReview(source));
  expect(sql.match(/"type":"image"/g)).toHaveLength(8);
  expect(sql).not.toContain('email_assets');
 });
 it('stores an inline letter image as its own block between the surrounding text',()=>{
  const src='https://harmonizer.zamkovoi.yoga/email-cdn/email-assets/courses/fixture-image/letter.jpg';
  const course={version:1,slug:'fixture-image',kind:'course',title:'Картинка',landingUrl:'',accessDays:90,dayCardExtraDays:3,webinarExtraDays:5,sourceHash:'a'.repeat(64),lessons:[{id:'fixture-image-01',position:1,gapDays:0,title:'День 1',blocks:[{type:'text',markdown:'Текст урока'}],email:{subject:'Тема',markdown:`До картинки\n\n![картинка письма](${src})\n\nНажмите кнопку ниже, чтобы открыть первый урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».\n\nПосле картинки`}}]};
  const sql=generateCourseImportSql(course);
  expect(sql).toContain('"type":"image"');expect(sql).toContain(src);expect(sql).not.toContain('![');
  expect(sql).toContain('email-assets/courses/fixture-image/letter.jpg');
  expect(sql.indexOf('До картинки')).toBeLessThan(sql.indexOf(src));
  expect(sql.indexOf(src)).toBeLessThan(sql.indexOf('После картинки'));
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
