import {describe,it,expect} from 'vitest';
import {validateCourseLesson,vimeoIdFromInput} from './courseLessonEditor';
describe('lesson editing',()=>{
 it.each(['123456789','https://vimeo.com/123456789','https://player.vimeo.com/video/123456789?h=abcdef'])('accepts Vimeo input %s',value=>expect(vimeoIdFromInput(value)).toBe('123456789'));
 it.each(['javascript:alert(1)','https://evil.test/123456789','http://vimeo.com/123456789','https://vimeo.com/channels/123456789'])('rejects invalid or foreign video %s',value=>expect(()=>vimeoIdFromInput(value)).toThrow());
 it('keeps authored text and block order, retains a practice association only for unchanged video',()=>{
  const old=[{type:'video' as const,vimeoId:'123456789',practiceId:'practice'}];
  const result=validateCourseLesson({title:' Lesson ',blocks:[{type:'text',markdown:'A\n\nB'},{type:'video',vimeoId:'https://vimeo.com/123456789'},{type:'video',vimeoId:'987654321',practiceId:'practice'}]},old);
  expect(result).toEqual({title:'Lesson',blocks:[{type:'text',markdown:'A\n\nB'},old[0],{type:'video',vimeoId:'987654321'}]});
 });
 it.each([{title:'',blocks:[]},{title:'Lesson',blocks:[{type:'text',markdown:''}]},{title:'Lesson',blocks:[{type:'html',html:'<script>'}]}])('rejects incomplete or unsupported blocks',body=>expect(()=>validateCourseLesson(body,[])).toThrow());
});
