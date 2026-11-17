import {readFile} from 'node:fs/promises';
import {URL} from 'node:url';
import {describe,expect,it} from 'vitest';
import {parseCourseReview} from './courses-content.mjs';
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
