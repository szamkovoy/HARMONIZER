import {readFile,writeFile} from 'node:fs/promises';
import {courseStableId} from './course-import-sql.mjs';
import {courseEmailHeaderHtml} from './courses-content.mjs';
import {intensiveLocales} from './intensive-content.mjs';
import {courseMarkdownHtml} from '../_legacy_web/app/api/_utils/courseSchedule.ts';
const q=value=>`'${String(value).replaceAll("'","''")}'`;
const json=value=>q(JSON.stringify(value))+'::jsonb';
export function generateIntensiveImportSql(course,{replaceEmails=false,replaceLessons=false}={}){
 if(course.kind!=='intensive'||!/^intensive-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(course.slug)||!course.title||!/^([0-9a-f]{64})$/.test(course.sourceHash))throw new Error('Проверьте код, тип, название и hash источника');
 if(!Array.isArray(course.lessons)||course.lessons.length!==30)throw new Error('Нужны 30 уроков');
 if(!course.emailHeader||!/^https:\/\/[^\s]+$/.test(course.emailHeader.src))throw new Error('Нужна шапка писем с email CDN');
 const ids=new Set();
 for(const [i,lesson] of course.lessons.entries()){
  if(lesson.position!==i+1||lesson.id!==`${course.slug}-${String(i+1).padStart(2,'0')}`||ids.has(lesson.id)||lesson.gapDays!==(i?1:0))throw new Error('Проверьте порядок и интервалы дней');ids.add(lesson.id);
  for(const locale of intensiveLocales){
   const blocks=locale==='ru'?lesson.blocks:lesson.blocksI18n?.[locale];
   if(!Array.isArray(blocks)||blocks.length!==2||blocks[0].type!=='video'||!/^\d{5,15}$/.test(blocks[0].vimeoId)||blocks[0].vimeoId!==lesson.blocks?.[0]?.vimeoId||blocks[1].type!=='text'||!blocks[1].markdown?.trim())throw new Error(`Нет текста/видео дня ${i+1} на ${locale}`);
  }
 }
 const auto=courseStableId(`course:${course.slug}`);const intro=courseStableId(`intensive-intro:${course.slug}`);const closing=courseStableId(`intensive-completion:${course.slug}`);
 const lines=['-- Approved intensive content only. No start, mail or sales activation.','begin;',
 `insert into public.email_automations(id,key,name,trigger_type,is_active) values('${auto}',${q('course_'+course.slug)},${q(course.title)},'course',false) on conflict(id) do nothing;`];
 for(const [position,name,id,email] of [[1,'Вводное письмо',intro,course.introEmail],[2,'Заключительное письмо',closing,course.completionEmail]]){
  const subject={},html={},blocks={};
  for(const locale of intensiveLocales){
   const copy=email?.[locale];if(!copy?.subject?.trim()||!copy?.markdown?.trim()||!course.titleI18n?.[locale]?.trim())throw new Error(`Не заполнены письмо/название на ${locale}`);
   const body=courseMarkdownHtml(copy.markdown);subject[locale]=copy.subject;html[locale]=courseEmailHeaderHtml(course.emailHeader)+body;
   blocks[locale]=[course.emailHeader,{id:`${course.slug}-${position}-text`,type:'text',html:body,align:'left',fontFamily:'system',fontSize:'md',marginTop:0,marginBottom:0}];
  }
  lines.push(`insert into public.email_automation_steps(id,automation_id,name,position,delay_hours,subject,subject_i18n,html_body,html_body_i18n,blocks_i18n) values('${id}','${auto}',${q(name)},${position},0,${q(subject.ru)},${json(subject)},${q(html.ru)},${json(html)},${json(blocks)}) on conflict(id) ${replaceEmails?'do update set subject=excluded.subject,subject_i18n=excluded.subject_i18n,html_body=excluded.html_body,html_body_i18n=excluded.html_body_i18n,blocks_i18n=excluded.blocks_i18n':'do nothing'};`);
 }
 lines.push(`insert into public.courses(slug,title,title_i18n,kind,landing_url,access_days,day_card_extra_days,webinar_extra_days,automation_id,intro_email_step_id,completion_email_step_id,source_hash) values(${q(course.slug)},${q(course.title)},${json(course.titleI18n)},'intensive','',1,1,1,'${auto}','${intro}','${closing}',${q(course.sourceHash)}) on conflict(slug) do update set source_hash=excluded.source_hash;`);
 lines.push(`do $$begin if not exists(select 1 from public.courses where slug=${q(course.slug)} and kind='intensive' and automation_id='${auto}' and intro_email_step_id='${intro}' and completion_email_step_id='${closing}' and access_days=1 and day_card_extra_days=1) then raise exception 'Existing product differs; do not overwrite';end if;end$$;`);
 lines.push(`do $$begin if exists(select 1 from public.course_lessons where id in (${course.lessons.map(l=>q(l.id)).join(',')}) and course_slug<>${q(course.slug)}) then raise exception 'Lesson belongs to another course';end if;end$$;`);
 for(const lesson of course.lessons){
  lines.push(`insert into public.course_lessons(id,course_slug,position,gap_days,title,blocks,blocks_i18n,email_step_id) values(${q(lesson.id)},${q(course.slug)},${lesson.position},${lesson.gapDays},${q(lesson.title)},${json(lesson.blocks)},${json(lesson.blocksI18n)},null) on conflict(id) ${replaceLessons?'do update set blocks=excluded.blocks,blocks_i18n=excluded.blocks_i18n':'do nothing'};`);
 }
 lines.push('commit;');return lines.join('\n')+'\n';
}
if(process.argv[1]?.endsWith('/intensive-import-sql.mjs')){
 const [input,output,...flags]=process.argv.slice(2);if(!input||!output)throw new Error('tsx scripts/intensive-import-sql.mjs course.json new-migration.sql [--replace-emails] [--replace-lessons]');
 const sql=generateIntensiveImportSql(JSON.parse(await readFile(input,'utf8')),{replaceEmails:flags.includes('--replace-emails'),replaceLessons:flags.includes('--replace-lessons')});
 await writeFile(output,sql,{flag:'wx'});console.log('SQL готов: 30 дней, два письма, восемь локалей. Запуска и отправки нет.');
}
