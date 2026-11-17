import {describe,it,expect} from 'vitest';
import type {CourseView} from '@shared/courses';
import {showsOnDay,isCourseArchive,courseMetadata} from './state';
import {courseLessonCount} from './strings';
export const course:CourseView={id:'grant',slug:'pilot',title:'Pilot',mode:'test',startedAt:'2026-11-01T12:00:00Z',accessUntil:'2027-02-01T00:00:00Z',displayUntil:'2026-11-21T00:00:00Z',landingUrl:'https://example.test',state:'available',current:{id:'last',title:'Last',position:8,blocks:[{type:'text',markdown:'PRIVATE TEXT'},{type:'video',vimeoId:'12345678'}]},lessons:[{id:'last',title:'Last',position:8}],totalLessons:8,nextChangeAt:null};
describe('course display and archive',()=>{
 it('keeps the final released material current for its entire display window',()=>{
  const now=Date.parse(course.displayUntil)-1;
  expect(showsOnDay(course,now)).toBe(true);expect(isCourseArchive(course,now)).toBe(false);
 });
 it('switches to archive exactly when Day stops showing the final material',()=>{
  const now=Date.parse(course.displayUntil);
  expect(showsOnDay(course,now)).toBe(false);expect(isCourseArchive(course,now)).toBe(true);
 });
 it('never retains lesson text or video IDs in persisted metadata',()=>{
  const metadata=courseMetadata([course]);expect(metadata[0].current?.blocks).toEqual([]);
  expect(JSON.stringify(metadata)).not.toContain('PRIVATE TEXT');expect(JSON.stringify(metadata)).not.toContain('12345678');expect(course.current?.blocks).toHaveLength(2);
 });
 it('does not show expired or revoked access on Day',()=>{
  expect(showsOnDay({...course,state:'revoked'},Date.parse(course.startedAt))).toBe(false);
  expect(showsOnDay(course,Date.parse(course.accessUntil))).toBe(false);
 });
 it('localizes counts for partial and complete curricula',()=>{
  expect(courseLessonCount('ru',2,8)).toBe('2 из 8');expect(courseLessonCount('ru',8,8)).toBe('8 уроков');
  expect(courseLessonCount('ru',21,21)).toBe('21 урок');expect(courseLessonCount('en',2,8)).toBe('2 of 8');
 });
});
