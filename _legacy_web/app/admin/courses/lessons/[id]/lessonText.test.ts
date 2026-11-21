import {describe,it,expect} from 'vitest';
import {lessonTextMarkdown} from './lessonText';
import {courseMarkdownHtml} from '../../../../api/_utils/courseSchedule';

// Small DOM-shaped fixtures; browser selection/commands are checked separately in WebKit.
function element(tag:string,children:(Node|string)[]=[],href=''):HTMLElement {
  const node={nodeType:1,nodeName:tag,tagName:tag,childNodes:[] as Node[],parentElement:null as HTMLElement|null,
    style:{fontWeight:'',fontStyle:'',textDecoration:''},getAttribute:(name:string)=>name==='href'?href:null,
    closest(name:string):HTMLElement|null{return tag.toLowerCase()===name?this as unknown as HTMLElement:this.parentElement?.closest(name)??null;}};
  node.childNodes=children.map(child=>{
    const next=typeof child==='string'?{nodeType:3,nodeName:'#text',textContent:child,childNodes:[]}:child;
    (next as unknown as {parentElement:unknown}).parentElement=node;return next as Node;
  });
  return node as unknown as HTMLElement;
}
describe('visual lesson editor serialization',()=>{
 it('retains blank paragraphs and single line breaks after an edit',()=>{
   const root=element('DIV',[element('P',['Здравствуйте!']),element('P'),element('P',['Текст']),element('P'),element('P'),element('P',['Подпись',element('BR'),'Сергей'])]);
   expect(lessonTextMarkdown(root)).toBe('Здравствуйте!\n\nТекст\n\n\nПодпись\nСергей');
 });
 it('retains marks, named links and typed URLs with underscores',()=>{
   const root=element('DIV',[element('P',[element('B',[element('I',['Выделено'])]),' ',element('A',['описание'],'https://example.org/a_b'),' https://example.org/c_d'])]);
   expect(courseMarkdownHtml(lessonTextMarkdown(root))).toBe('<p><strong><em>Выделено</em></strong> <a href="https://example.org/a_b">описание</a> <a href="https://example.org/c_d">https://example.org/c_d</a></p>');
 });
 it('keeps a heading separate from adjacent text and handles placeholder BRs',()=>{
   const root=element('DIV',[element('P',['До']),element('H3',['Заголовок']),element('P',[element('BR')]),element('P',['После'])]);
   expect(courseMarkdownHtml(lessonTextMarkdown(root))).toContain('<h3>Заголовок</h3>');
   expect(lessonTextMarkdown(root)).toContain('После');
   expect(lessonTextMarkdown(element('DIV',[element('H3',['Заголовок']),element('P'),element('P',['Текст'])]))).toBe('### Заголовок\n\nТекст');
 });
 it('discards executable clipboard nodes, unsafe links and unsupported HTML',()=>{
   const root=element('DIV',[element('P',[element('SCRIPT',['alert(1)']),element('A',['Текст'],'javascript:alert(1)'),element('IMG')])]);
   expect(lessonTextMarkdown(root)).toBe('Текст');
 });
});
