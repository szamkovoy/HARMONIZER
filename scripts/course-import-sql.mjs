import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {courseMarkdownHtml} from '../_legacy_web/app/api/_utils/courseSchedule.ts';
import {courseEmailHeaderHtml,courseEmailImageHtml} from './courses-content.mjs';
import {prepareCourseLessonEmailHtml} from '../_legacy_web/shared_core/courseLessonEmail.ts';

export const courseStableId=name=>{const b=createHash('sha256').update(name).digest().subarray(0,16);b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const h=b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
const q=s=>`'${String(s).replaceAll("'","''")}'`;
const INLINE_IMAGE_TEXT_SPACER='<p>&nbsp;</p>';
export function generateCourseImportSql(course,{replaceEmails=false,replaceLessons=false}={}){
 if(course.kind==='intensive')throw new Error('Для ежедневного интенсива используйте scripts/intensive-import-sql.mjs');
 const landingUrl=course.landingUrl??'';
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(course.slug)||!course.title||!['practicum','intensive','course','masterclass'].includes(course.kind)||typeof landingUrl!=='string'||(landingUrl&&!/^https:\/\/[^\s]+$/.test(landingUrl)))throw new Error('Проверьте метаданные курса');
 for(const n of ['accessDays','dayCardExtraDays','webinarExtraDays'])if(!Number.isInteger(course[n])||course[n]<=0)throw new Error(`Проверьте ${n}`);
 if(!/^[a-f0-9]{64}$/.test(course.sourceHash))throw new Error('Нужен SHA-256 утверждённого авторского источника');
 if(!Array.isArray(course.lessons)||!course.lessons.length||course.lessons.length>500)throw new Error('Нужен непустой список учебных материалов');
 if(course.completionEmail&&course.dayCardExtraDays!==3)throw new Error('Завершающее письмо привязано к окончанию трёхдневного показа последнего урока');
 if(course.emailHeader&&(!/^https:\/\/[^\s]+$/.test(course.emailHeader.src)||course.emailHeader.type!=='image'))throw new Error('Нужна HTTPS-шапка image');
 const auto=courseStableId(`course:${course.slug}`);const ids=new Set();const assets=[];
 const rememberAsset=url=>{const path=emailAssetPath(url);if(path&&!assets.some(item=>item.path===path))assets.push({path,url});};
 if(course.emailHeader)rememberAsset(course.emailHeader.src);
 const lines=['-- Generated from approved author text. Starts no enrolments and sends no email.','begin;',
 `insert into public.email_automations(id,key,name,trigger_type,is_active) values('${auto}',${q('course_'+course.slug)},${q(course.title)},'course',false) on conflict(id) do nothing;`,
 `insert into public.courses(slug,title,kind,landing_url,access_days,day_card_extra_days,webinar_extra_days,automation_id,source_hash) values(${q(course.slug)},${q(course.title)},${q(course.kind)},${q(landingUrl)},${course.accessDays},${course.dayCardExtraDays},${course.webinarExtraDays},'${auto}',${q(course.sourceHash)}) on conflict(slug) do update set title=excluded.title,source_hash=excluded.source_hash;`];
 function letter(email,step,name,position,blockId,lessonId,lessonPosition){
  if(typeof email?.subject!=='string'||!email.subject.trim()||typeof email?.markdown!=='string'||!email.markdown.trim())throw new Error('Нужны тема и текст каждого письма');
  const markdown=email.markdown.replaceAll('{first_name}','{{name}}');
  const fragments=emailFragments(markdown);
  const textFragments=fragments.filter(item=>item.type==='text');
  const buttonFragment=textFragments.find(item=>item.markdown.includes('Нажмите кнопку ниже'))??textFragments.at(-1);
  let textCount=0;let imageCount=0;
  const blocks=[...(course.emailHeader?[course.emailHeader]:[])];
  const parts=[];
  for(const [fi,fragment] of fragments.entries()){
   if(fragment.type==='image'){
    if(!/^https:\/\/[^\s]+$/.test(fragment.src))throw new Error('Картинка письма должна быть HTTPS');
    rememberAsset(fragment.src);
    imageCount+=1;
    const size=localImageSize(fragment.src);
    const image={id:`${blockId}-image-${imageCount}`,type:'image',src:fragment.src,alt:fragment.alt,href:'',width:'100%',align:'center',marginTop:0,marginBottom:0,...(size?{naturalWidth:size.width,naturalHeight:size.height}:{})};
    blocks.push(image);parts.push(courseEmailImageHtml(image));
   }else{
    textCount+=1;
    let html=course.slug==='planet-love'?courseEmailMarkdownHtml(fragment.markdown):courseMarkdownHtml(fragment.markdown);
    if((course.slug==='make-dream'&&lessonPosition>=3)||course.slug==='planet-love'){
     if(fragments[fi+1]?.type==='image')html+=INLINE_IMAGE_TEXT_SPACER;
     if(fragments[fi-1]?.type==='image')html=INLINE_IMAGE_TEXT_SPACER+html;
    }
    if(lessonId&&fragment===buttonFragment)html=prepareCourseLessonEmailHtml(html,lessonId);
    blocks.push({id:textCount===1?blockId:`${blockId}-${textCount}`,type:'text',html,align:'left',fontFamily:'system',fontSize:'md',marginTop:0,marginBottom:0});
    parts.push(html);
   }
  }
  if(lessonId&&!buttonFragment){
   const html=prepareCourseLessonEmailHtml('',lessonId);
   blocks.push({id:blockId,type:'text',html,align:'left',fontFamily:'system',fontSize:'md',marginTop:0,marginBottom:0});
   parts.push(html);
  }
  const html=courseEmailHeaderHtml(course.emailHeader)+parts.join('');
  const update=replaceEmails?'do update set subject=excluded.subject,subject_i18n=excluded.subject_i18n,html_body=excluded.html_body,html_body_i18n=excluded.html_body_i18n,blocks_i18n=excluded.blocks_i18n':'do nothing';
  lines.push(`insert into public.email_automation_steps(id,automation_id,name,position,delay_hours,subject,subject_i18n,html_body,html_body_i18n,blocks_i18n) values('${step}','${auto}',${q(name)},${position},0,${q(email.subject)},${q(JSON.stringify({ru:email.subject}))}::jsonb,${q(html)},${q(JSON.stringify({ru:html}))}::jsonb,${q(JSON.stringify({ru:blocks}))}::jsonb) on conflict(id) ${update};`);
 }
 for(const [i,lesson] of course.lessons.entries()){
  if(typeof lesson.id!=='string'||!lesson.id.startsWith(course.slug+'-')||ids.has(lesson.id)||lesson.position!==i+1||!lesson.title||!Number.isInteger(lesson.gapDays)||lesson.gapDays<(i?1:0)||(!i&&lesson.gapDays!==0))throw new Error('Проверьте ID, порядок и интервалы уроков');
  ids.add(lesson.id);
  if(!Array.isArray(lesson.blocks)||!lesson.blocks.length||lesson.blocks.some(b=>b.type==='text'?typeof b.markdown!=='string'||!b.markdown.trim():b.type!=='video'||!/^\d{5,15}$/.test(b.vimeoId)||(b.practiceId&&!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(b.practiceId))))throw new Error('Проверьте текстовые и видеоблоки');
  const step=courseStableId(`course-mail:${lesson.id}`);letter(lesson.email,step,lesson.title,lesson.position,`${lesson.id}-text`,lesson.id,lesson.position);
  lines.push(`do $$begin if exists(select 1 from public.course_lessons where id=${q(lesson.id)} and course_slug<>${q(course.slug)}) then raise exception 'Lesson belongs to another course';end if;end$$;`);
  lines.push(`insert into public.course_lessons(id,course_slug,position,gap_days,title,blocks,email_step_id) values(${q(lesson.id)},${q(course.slug)},${lesson.position},${lesson.gapDays},${q(lesson.title)},${q(JSON.stringify(lesson.blocks))}::jsonb,'${step}') on conflict(id) ${replaceLessons?'do update set title=excluded.title,blocks=excluded.blocks,gap_days=excluded.gap_days':'do nothing'};`);
 }
 if(course.completionEmail){
  const step=courseStableId(`course-completion:${course.slug}`);
  letter(course.completionEmail,step,'Завершение практикума',course.lessons.length+1,`${course.slug}-completion-text`);
  lines.push(`do $$begin if exists(select 1 from public.courses where slug=${q(course.slug)} and (day_card_extra_days<>3 or (completion_email_step_id is not null and completion_email_step_id<>'${step}'::uuid))) then raise exception 'Completion configuration differs; review before replacing';end if;end$$;`);
  lines.push(`update public.courses set completion_email_step_id='${step}' where slug=${q(course.slug)};`);
 }
 for(const asset of assets)lines.push(`insert into public.email_assets(path,public_url) values(${q(asset.path)},${q(asset.url)}) on conflict(path) do update set public_url=excluded.public_url;`);
 lines.push('commit;');return lines.join('\n')+'\n';
}
const SPACE_LINE='§SPACE§';
/** A line that is only spaces is an author offset. Mail margins collapse an empty paragraph, so keep it as `&nbsp;`. */
function courseEmailMarkdownHtml(markdown){
 const marked=markdown.replace(/^[ \t]+$/gm,SPACE_LINE);
 return courseMarkdownHtml(marked)
  .replaceAll(`<p>${SPACE_LINE}</p>`,INLINE_IMAGE_TEXT_SPACER)
  .replaceAll(`<br>${SPACE_LINE}<br>`,`</p>${INLINE_IMAGE_TEXT_SPACER}<p>`)
  .replaceAll(`<br>${SPACE_LINE}`,`</p>${INLINE_IMAGE_TEXT_SPACER}`)
  .replaceAll(`${SPACE_LINE}<br>`,`${INLINE_IMAGE_TEXT_SPACER}<p>`)
  .replaceAll(SPACE_LINE,INLINE_IMAGE_TEXT_SPACER);
}
const IMAGE_LINE=/^!\[([^\]]*)\]\((https:\/\/[^)\s]+)\)$/;
function emailFragments(markdown){
 const fragments=[];let buf=[];
 const push=()=>{const text=buf.join('\n').trim();if(text)fragments.push({type:'text',markdown:text});buf=[];};
 for(const line of markdown.replace(/\r\n?/g,'\n').split('\n')){
  const image=line.match(IMAGE_LINE);
  if(image){push();fragments.push({type:'image',alt:image[1],src:image[2]});}
  else buf.push(line);
 }
 push();return fragments;
}
function emailAssetPath(url){const marker='/email-cdn/';const at=url.indexOf(marker);return at<0?null:url.slice(at+marker.length);}
function imageSize(buf){
 if(buf.length>24&&buf[0]===0x89&&buf[1]===0x50)return {width:buf.readUInt32BE(16),height:buf.readUInt32BE(20)};
 if(buf.length>4&&buf[0]===0xff&&buf[1]===0xd8){
  let offset=2;
  while(offset+8<buf.length){
   if(buf[offset]!==0xff)break;
   const marker=buf[offset+1];const length=buf.readUInt16BE(offset+2);
   if(marker>=0xc0&&marker<=0xc3)return {height:buf.readUInt16BE(offset+5),width:buf.readUInt16BE(offset+7)};
   offset+=2+length;
  }
 }
 return null;
}
function localImageSize(src){
 const name=decodeURIComponent(src.split('/').pop()?.split('?')[0]??'');
 if(!name||name.includes('..')||name.includes('/'))return null;
 const root=join(dirname(fileURLToPath(import.meta.url)),'../content/courses/assets');
 const files=[join(root,name)];
 if(existsSync(root))for(const entry of readdirSync(root,{withFileTypes:true}))if(entry.isDirectory())files.push(join(root,entry.name,name));
 for(const file of files){if(!existsSync(file))continue;const size=imageSize(readFileSync(file));if(size)return size;}
 return null;
}
if(process.argv[1]?.endsWith('/course-import-sql.mjs')){
 const input=process.argv.slice(2).find(a=>a.endsWith('.json'))||new URL('../content/courses/month-health.json',import.meta.url);
 const output=process.argv.slice(2).find(a=>a.endsWith('.sql'));if(!output)throw new Error('Укажите [курс.json] новый-файл.sql');
 const course=JSON.parse(await readFile(input,'utf8'));
 const sql=generateCourseImportSql(course,{replaceEmails:process.argv.includes('--replace-emails'),replaceLessons:process.argv.includes('--replace-lessons')});
 await writeFile(output,sql,{flag:'wx'});
 console.log(`Подготовлен импорт ${course.lessons.length} уроков и ${course.lessons.length+(course.completionEmail?1:0)} писем без запуска. Правки БД сохраняются по умолчанию; замена — только через --replace-emails / --replace-lessons.`);
}
