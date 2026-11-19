import {describe,it,expect} from 'vitest';
import {courseInline,courseInlineHtml,escapeCourseText,escapeCourseUrl} from './courseInline';
const render=(text:string)=>courseInlineHtml(courseInline(text));
describe('shared lesson inline formatting',()=>{
 it('combines emphasis and named links in either order',()=>{
   expect(render('**_Жирный курсив_** и ~~старое~~')).toBe('<strong><em>Жирный курсив</em></strong> и <s>старое</s>');
   expect(render('[**Описание**](https://zamkovoi.yoga/mmz/)')).toBe('<a href="https://zamkovoi.yoga/mmz/"><strong>Описание</strong></a>');
 });
 it('auto-links addresses with underscores, queries and balanced parentheses',()=>{
   expect(render('https://example.org/a_b?q=1&x=2')).toBe('<a href="https://example.org/a_b?q=1&amp;x=2">https://example.org/a_b?q=1&amp;x=2</a>');
   expect(render('[Курс](https://example.org/a_(b))')).toBe('<a href="https://example.org/a_(b)">Курс</a>');
 });
 it('escapes literal punctuation and never nests anchors in a URL label',()=>{
   const label='https://example.org/a_b';
   expect(render(`[${escapeCourseText(label)}](${escapeCourseUrl(label)})`)).toBe(`<a href="${label}">${label}</a>`);
   expect(render(escapeCourseText('**обычный** _текст_ [скобки]'))).toBe('**обычный** _текст_ [скобки]');
 });
 it('escapes HTML and rejects unsafe and malformed links',()=>{
   expect(render('[нажмите](javascript:alert(1)) <img src=x onerror=alert(1)>')).not.toMatch(/<a|<img/);
   expect(render('[нажмите](https://example.org/"onmouseover="x)')).not.toContain('<a');
 });
});
