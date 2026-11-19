"use client";
import {useLayoutEffect,useRef,useState} from 'react';
import {courseMarkdownHtml} from '../../../../api/_utils/courseSchedule';
import {isCourseUrl} from '@shared/courseInline';
import {lessonTextMarkdown} from './lessonText';

const button='rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-800 disabled:opacity-40';
export function LessonTextEditor({value,onChange,disabled=false}:{value:string;onChange:(value:string)=>void;disabled?:boolean}){
  const editor=useRef<HTMLDivElement>(null);const selection=useRef<Range|null>(null);
  const lastValue=useRef<string|null>(null);
  const [linkOpen,setLinkOpen]=useState(false);const [url,setUrl]=useState('');const [label,setLabel]=useState('');const [error,setError]=useState('');
  useLayoutEffect(()=>{
    if(value!==lastValue.current&&editor.current){editor.current.innerHTML=courseMarkdownHtml(value);lastValue.current=value;}
  },[value]);
  const remember=()=>{
    const current=window.getSelection();
    if(current?.rangeCount&&editor.current?.contains(current.anchorNode)&&editor.current.contains(current.focusNode)){
      const range=current.getRangeAt(0).cloneRange();
      // WebKit can anchor a selection at the END of the preceding paragraph,
      // although none of that paragraph is visibly selected. Keep link insertion
      // from consuming the empty paragraphs between that boundary and the text.
      if(!range.collapsed){
        const walker=document.createTreeWalker(editor.current,NodeFilter.SHOW_TEXT);
        const selected:Node[]=[];let node:Node|null;
        while((node=walker.nextNode())){
          if(!node.textContent||!range.intersectsNode(node))continue;
          if(node===range.startContainer&&range.startOffset===node.textContent.length)continue;
          if(node===range.endContainer&&range.endOffset===0)continue;
          selected.push(node);
        }
        const first=selected[0];const last=selected.at(-1);
        if(first&&first!==range.startContainer)range.setStart(first,0);
        if(last&&last!==range.endContainer)range.setEnd(last,last.textContent!.length);
      }
      selection.current=range;
    }
  };
  const flush=()=>{
    if(!editor.current)return;
    const next=lessonTextMarkdown(editor.current);lastValue.current=next;onChange(next);remember();
  };
  const restore=()=>{
    editor.current?.focus();const current=window.getSelection();
    if(selection.current&&editor.current?.contains(selection.current.commonAncestorContainer)){current?.removeAllRanges();current?.addRange(selection.current);}
  };
  const command=(name:string,arg?:string)=>{remember();restore();document.execCommand(name,false,arg);flush();};
  const openLink=()=>{
    remember();const selected=selection.current?.toString()??'';setLabel(selected);setUrl(isCourseUrl(selected)?selected:'');setError('');setLinkOpen(true);
  };
  const insertLink=()=>{
    const address=url.trim();if(!isCourseUrl(address)){setError('Введите полный адрес, начинающийся с https://');return;}
    const anchor=document.createElement('a');anchor.href=address;anchor.textContent=label.trim()||address;
    command('insertHTML',anchor.outerHTML);setLinkOpen(false);
  };
  return <div className="space-y-2">
    <div role="toolbar" aria-label="Форматирование текста урока" className="flex flex-wrap gap-2" onMouseDown={e=>e.preventDefault()}>
      <button type="button" className={button} disabled={disabled} aria-label="Жирный" onClick={()=>command('bold')}><strong>Ж</strong></button>
      <button type="button" className={button} disabled={disabled} aria-label="Курсив" onClick={()=>command('italic')}><em>К</em></button>
      <button type="button" className={button} disabled={disabled} aria-label="Зачёркнутый" onClick={()=>command('strikeThrough')}><s>Т</s></button>
      <button type="button" className={button} disabled={disabled} onClick={()=>command('formatBlock','h3')}>Заголовок</button>
      <button type="button" className={button} disabled={disabled} onClick={()=>command('formatBlock','p')}>Обычный текст</button>
      <button type="button" className={button} disabled={disabled} onClick={openLink}>Ссылка</button>
      <button type="button" className={button} disabled={disabled} onClick={()=>command('unlink')}>Убрать ссылку</button>
    </div>
    {linkOpen?<div role="group" aria-label="Вставка ссылки" className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
      <label className="block text-sm">Текст ссылки<input className="mt-1 w-full rounded-lg border p-2" value={label} onChange={e=>setLabel(e.target.value)} disabled={disabled}/></label>
      <label className="block text-sm">Адрес ссылки<input type="url" className="mt-1 w-full rounded-lg border p-2" placeholder="https://" value={url} onChange={e=>setUrl(e.target.value)} disabled={disabled}/></label>
      {error?<p role="alert" className="text-sm text-rose-700">{error}</p>:null}
      <div className="flex gap-2"><button type="button" className={button} disabled={disabled} onClick={insertLink}>Вставить ссылку</button><button type="button" className={button} onClick={()=>setLinkOpen(false)}>Отмена</button></div>
    </div>:null}
    <div ref={editor} role="textbox" aria-label="Текст блока" aria-multiline="true" aria-disabled={disabled} contentEditable={!disabled} suppressContentEditableWarning
      className="min-h-52 break-words rounded-xl border border-zinc-300 bg-white px-3 py-2 text-base leading-relaxed text-zinc-900 outline-none focus:border-emerald-600 [&_a]:text-emerald-700 [&_a]:underline [&_h3]:text-lg [&_h3]:font-semibold [&_p:empty]:min-h-[1.5em]"
      onInput={flush} onBlur={remember} onMouseUp={remember} onKeyUp={remember}
      onPaste={event=>{
        event.preventDefault();const html=event.clipboardData.getData('text/html');
        if(html){const parsed=new DOMParser().parseFromString(html,'text/html');document.execCommand('insertHTML',false,courseMarkdownHtml(lessonTextMarkdown(parsed.body)));}
        else document.execCommand('insertText',false,event.clipboardData.getData('text/plain'));
        flush();
      }}/>
    <p className="text-xs text-zinc-500">Выделите текст и выберите формат. HTTPS-адреса становятся ссылками при просмотре. Enter — новая строка; пустая строка разделяет абзацы.</p>
  </div>;
}
