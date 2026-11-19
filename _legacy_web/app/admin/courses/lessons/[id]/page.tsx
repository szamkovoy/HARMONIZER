"use client";
import Link from 'next/link';
import {useParams} from 'next/navigation';
import {useEffect,useState} from 'react';
import type {CourseBlock} from '@shared/courses';
import {adminFetch} from '../../../_lib/adminApi';
import {courseMarkdownHtml} from '../../../../api/_utils/courseSchedule';
import {LessonTextEditor} from './LessonTextEditor';
type Lesson={id:string;title:string;blocks:CourseBlock[]};
type Course={title:string;automation_id:string};
const input='w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-zinc-900';
const button='rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 disabled:opacity-40';
export default function CourseLessonEditor(){
 const {id}=useParams<{id:string}>();const [lesson,setLesson]=useState<Lesson|null>(null);const [course,setCourse]=useState<Course|null>(null);
 const [title,setTitle]=useState('');const [blocks,setBlocks]=useState<CourseBlock[]>([]);const [editing,setEditing]=useState(false);const [saving,setSaving]=useState(false);const [error,setError]=useState('');const [saved,setSaved]=useState(false);
 useEffect(()=>{let live=true;void adminFetch<{lesson:Lesson;course:Course}>(`/api/admin/courses/lessons/${encodeURIComponent(id)}`).then(r=>{if(live){setLesson(r.lesson);setTitle(r.lesson.title);setCourse(r.course);}}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[id]);
 const edit=()=>{if(!lesson)return;setBlocks(lesson.blocks.map(b=>({...b})));setEditing(true);setSaved(false);setError('');};
 const change=(i:number,b:CourseBlock)=>setBlocks(old=>old.map((v,j)=>j===i?b:v));
 const move=(i:number,delta:number)=>setBlocks(old=>{const next=[...old];[next[i],next[i+delta]]=[next[i+delta],next[i]];return next;});
 const save=async(nameOnly=false)=>{setSaving(true);setError('');try{const r=await adminFetch<{lesson:Lesson}>(`/api/admin/courses/lessons/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({title,...(nameOnly?{}:{blocks})})});setLesson(r.lesson);setTitle(r.lesson.title);setEditing(false);setSaved(true);}catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить');}finally{setSaving(false);}};
 return <div className="mx-auto max-w-3xl space-y-5 p-4">
 {course?<Link className="text-emerald-700 underline" href={`/admin/email/automations/${course.automation_id}`}>← {course.title}: письма</Link>:null}
 {error?<p role="alert" className="text-rose-700">{error}</p>:null}
 {!lesson?<p>Загружаем урок…</p>:<>
 <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold text-zinc-900">{editing?'Редактирование урока':'Урок курса'}</h1>{!editing?<button className={button} onClick={edit}>Редактировать</button>:null}</div>
 {saved?<p role="status" className="text-emerald-700">Урок сохранён. Изменения появятся в приложении при обновлении курса.</p>:null}
 <label className="block space-y-2"><span>Название урока</span><input className={input} value={title} onChange={e=>{setTitle(e.target.value);setSaved(false);}} maxLength={500} disabled={saving}/><span className="block text-xs text-zinc-500">Название в приложении. Сохраняется отдельно от темы и названия письма.</span></label>
 {!editing&&title!==lesson.title?<div className="flex gap-3"><button className={button} disabled={saving||!title.trim()} onClick={()=>void save(true)}>{saving?'Сохраняем…':'Сохранить название'}</button><button className={button} disabled={saving} onClick={()=>{setTitle(lesson.title);setError('');}}>Отмена</button></div>:null}
 {editing?<div className="space-y-4">
 {blocks.map((b,i)=><section key={i} className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4">
 <div className="flex flex-wrap items-center gap-2"><strong className="mr-auto">{i+1}. {b.type==='text'?'Текст':'Видео Vimeo'}</strong>
 <button aria-label="Переместить выше" className={button} disabled={i===0||saving} onClick={()=>move(i,-1)}>↑</button><button aria-label="Переместить ниже" className={button} disabled={i===blocks.length-1||saving} onClick={()=>move(i,1)}>↓</button><button className={button} disabled={saving} onClick={()=>setBlocks(v=>v.filter((_,j)=>j!==i))}>Удалить</button></div>
 {b.type==='text'?<LessonTextEditor value={b.markdown} onChange={markdown=>change(i,{...b,markdown})} disabled={saving}/>:<label className="block space-y-2"><span>Ссылка Vimeo или ID видео</span><input className={input} value={b.vimeoId} onChange={e=>change(i,{...b,vimeoId:e.target.value})}/></label>}
 </section>)}
 <div className="flex flex-wrap gap-2"><button className={button} disabled={saving} onClick={()=>setBlocks(v=>[...v,{type:'text',markdown:''}])}>Добавить текст</button><button className={button} disabled={saving} onClick={()=>setBlocks(v=>[...v,{type:'video',vimeoId:''}])}>Добавить видео</button></div>
 <div className="flex gap-3"><button className="rounded-xl bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-40" disabled={saving} onClick={()=>void save()}>{saving?'Сохраняем…':'Сохранить'}</button><button className={button} disabled={saving} onClick={()=>{setEditing(false);setTitle(lesson.title);setError('');}}>Отмена</button></div>
 </div>:<div className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-5">{lesson.blocks.map((b,i)=>b.type==='text'?<div key={i} className="space-y-3 text-base leading-relaxed [&_a]:text-emerald-700 [&_a]:underline [&_h3]:text-xl [&_h3]:font-semibold [&_p:empty]:h-3" dangerouslySetInnerHTML={{__html:courseMarkdownHtml(b.markdown)}}/>:<iframe key={`${b.vimeoId}-${i}`} className="aspect-video w-full rounded-xl" src={`https://player.vimeo.com/video/${encodeURIComponent(b.vimeoId)}`} title={`${lesson.title}: видео ${i+1}`} allow="fullscreen; picture-in-picture" allowFullScreen/>)}</div>}
 </>}
 </div>;
}
