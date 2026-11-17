import {describe,it,expect} from 'vitest';
import {DateTime} from 'luxon';
import {buildCourseSchedule,courseMarkdownHtml} from './courseSchedule';
const lessons=[{id:'one',gapDays:0},{id:'two',gapDays:1},{id:'three',gapDays:1}];
describe('course calendar and rehearsal',()=>{
 it.each([[17,1,11],[18,1,12],[21,1,12],[21,2,12],[21,3,13]])('purchase hour %i, interval %i → November %i',(hour,gap,day)=>{
  const result=buildCourseSchedule([{id:'one',gapDays:0},{id:'two',gapDays:gap}],`2026-11-10T${hour}:00:00+03:00`,'Europe/Moscow');
  const second=DateTime.fromISO(result[1].opensAt).setZone('Europe/Moscow');
  expect(second.day).toBe(day);expect(second.hour).toBe(0);
  expect(DateTime.fromISO(result[1].mailAt).setZone('Europe/Moscow').hour).toBe(7);
 });
 it('keeps subsequent daily intervals after the late first transition',()=>{
  expect(buildCourseSchedule(lessons,'2026-11-10T21:00:00+03:00','Europe/Moscow').map(s=>DateTime.fromISO(s.opensAt).setZone('Europe/Moscow').day)).toEqual([10,12,13]);
 });
 it('uses calendar days across daylight saving changes',()=>{
  const r=buildCourseSchedule(lessons,'2026-03-28T12:00:00+01:00','Europe/Berlin');
  expect(r.map(x=>DateTime.fromISO(x.opensAt).setZone('Europe/Berlin').hour)).toEqual([12,0,0]);
  expect(Date.parse(r[2].opensAt)-Date.parse(r[1].opensAt)).toBe(23*3600_000);
 });
 it('opens each rehearsal lesson with its letter every two minutes',()=>{
  const r=buildCourseSchedule(lessons,'2026-11-10T21:00:00Z','Europe/Moscow',120);
  expect(r.map(s=>s.mailAt)).toEqual(r.map(s=>s.opensAt));expect(Date.parse(r[2].opensAt)-Date.parse(r[0].opensAt)).toBe(240000);
 });
 it('rejects unknown zones and invalid gaps instead of silently guessing',()=>{
  expect(()=>buildCourseSchedule(lessons,'2026-11-10T00:00:00Z','bad-zone')).toThrow();
  expect(()=>buildCourseSchedule([{id:'one',gapDays:0},{id:'two',gapDays:-1}],'2026-11-10T00:00:00Z','UTC')).toThrow();
 });
 it('escapes authored HTML while retaining links and emphasis',()=>{
  const html=courseMarkdownHtml('**Текст** <script>alert(1)</script>\n\n[Курс](https://zamkovoi.yoga/m2)');
  expect(html).not.toContain('<script>');expect(html).toContain('<strong>Текст</strong>');expect(html).toContain('href="https://zamkovoi.yoga/m2"');
 });
});

describe('authored email paragraph spacing',()=>{
 it('preserves exactly the authored blank lines and single signature line break',()=>{
  expect(courseMarkdownHtml('Здравствуйте, Сергей!\n\nТекст\n\n\nЖелаю вам плодотворных практик!\nСергей Замковой')).toBe('<p>Здравствуйте, Сергей!</p><p></p><p>Текст</p><p></p><p></p><p>Желаю вам плодотворных практик!<br>Сергей Замковой</p>');
 });
 it('handles Windows newlines without changing paragraph structure',()=>{
  expect(courseMarkdownHtml('A\r\n\r\nB\r\nC')).toBe('<p>A</p><p></p><p>B<br>C</p>');
 });
});
