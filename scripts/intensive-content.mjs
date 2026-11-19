import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

export const intensiveLocales=['ru','en','de','fr','it','es','pt','nl'];
const hash=s=>createHash('sha256').update(s).digest('hex');
export function validateIntensiveExtraction(raw){
 if(!raw||!/^intensive-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw.slug)||!raw.title||!raw.templateKey)throw new Error('Укажите slug intensive-…, title и templateKey');
 if(!Array.isArray(raw.lessons)||raw.lessons.length!==30||raw.lessons.some(l=>!/^\d{5,15}$/.test(l.vimeoId)||!/^https:\/\//.test(l.sourceUrl)))throw new Error('Нужны 30 видео в порядке списка с исходными URL');
 if(new Set(raw.lessons.map(l=>l.sourceUrl)).size!==30)throw new Error('Страницы уроков повторяются');
 if(!Array.isArray(raw.advice)||raw.advice.length!==29||raw.advice.some(a=>!a.markdown?.trim()||!/^https:\/\//.test(a.sourceUrl)))throw new Error('Нужны 29 непустых советов с исходными URL');
 if(new Set(raw.advice.map(a=>a.sourceNumber)).size!==29||raw.advice.some(a=>!Number.isInteger(a.sourceNumber)||a.sourceNumber<1||a.sourceNumber>29))throw new Error('Нужны советы из писем Практика 1–29, без повторений');
 if(new Set(raw.advice.map(a=>a.markdown.replace(/\s+/g,' ').trim())).size!==29)throw new Error('Повторяется текст совета');
 return raw;
}
export function intensiveReview(raw,templates){
 validateIntensiveExtraction(raw);const emails=templates.programs[raw.templateKey];if(!emails)throw new Error('Неизвестный шаблон писем');
 const advice=[...raw.advice].sort((a,b)=>a.sourceNumber-b.sourceNumber);
 const last=templates.lastLesson.replace(/^ЧТО ДАЛЬШЕ\?\s*/,'').trim();
 const mail=(title,email)=>`## ${title}\n\n**Тема:** ${email.subject}\n\n${email.markdown}\n`;
 return `# ${raw.title}\n\n**Код интенсива:** ${raw.slug}\n**Шаблон писем:** ${raw.templateKey}\n**Шапка писем:** ${raw.emailHeader?.src??'НЕ УКАЗАНА'}\n**Размер шапки:** ${raw.emailHeader?.naturalWidth??0}×${raw.emailHeader?.naturalHeight??0}\n\nВидео идут в порядке списка GetCourse. Советы не повторяются. Дневные интервалы фиксированы, источники сохранены для точечной проверки.\n\n`+
 mail('Вводное письмо',emails.introEmail)+'\n'+mail('Заключительное письмо',emails.completionEmail)+'\n'+raw.lessons.map((lesson,i)=>{
  const content=i===29?`### Что дальше?\n\n${last}`:`### Совет дня:\n\n${advice[i].markdown.trim()}`;
  return `## ${String(i+1).padStart(2,'0')}. День ${i+1}\n\n**Источник видео:** ${lesson.sourceUrl}\n**Видео:** https://player.vimeo.com/video/${lesson.vimeoId}\n${i<29?`**Источник совета:** ${advice[i].sourceUrl}\n`:''}\n### Текст урока\n\n${content}\n`;
 }).join('\n');
}
export function parseIntensiveReview(source){
 const sourceHash=hash(source);source=source.replace(/\r\n?/g,'\n');
 const value=name=>source.match(new RegExp('^\\*\\*'+name+':\\*\\* (.+)$','m'))?.[1]?.trim();
 const slug=value('Код интенсива');const title=source.match(/^# (.+)$/m)?.[1];
 if(!slug||!/^intensive-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||!title)throw new Error('Не указано название или код интенсива');
 const sections=[...source.matchAll(/^## (.+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)];
 if(sections.length!==32||sections.filter(([,name])=>name==='Вводное письмо').length!==1||sections.filter(([,name])=>name==='Заключительное письмо').length!==1)throw new Error('Ожидаются 30 дней и ровно два письма; неизвестные секции не должны теряться');
 const email=name=>{const body=sections.find(([,heading])=>heading===name)?.[2];const subject=body?.match(/^\*\*Тема:\*\* (.+)$/m)?.[1];const markdown=body?.replace(/^\*\*Тема:\*\* .+\n?/m,'').trim();if(!subject||!markdown)throw new Error('Нет '+name);return {ru:{subject,markdown}};};
 const lessons=sections.filter(([,heading])=>/^\d{2}\. /.test(heading)).map(([,heading,body],i)=>{
  const number=Number(heading.slice(0,2));const vimeoId=body.match(/^\*\*Видео:\*\* https:\/\/player\.vimeo\.com\/video\/(\d+)$/m)?.[1];
  const markdown=body.split('### Текст урока\n')[1]?.trim();
  if(number!==i+1||!vimeoId||!/^\d{5,15}$/.test(vimeoId)||!markdown)throw new Error('Проверьте порядок, видео и текст дня '+number);
  return {id:`${slug}-${String(number).padStart(2,'0')}`,position:number,gapDays:i?1:0,title:`День: ${number}`,blocks:[{type:'video',vimeoId},{type:'text',markdown}],blocksI18n:{}};
 });
 if(lessons.length!==30)throw new Error('Интенсив содержит ровно 30 дней');
 const header=value('Шапка писем');const dims=value('Размер шапки')?.match(/^(\d+)[x×](\d+)$/);
 if(!header||!/^https:\/\/[^\s]+$/.test(header)||!dims||Number(dims[1])<1||Number(dims[2])<1)throw new Error('Перед импортом разместите приложенную шапку на email CDN и укажите размер');
 return {version:1,kind:'intensive',slug,title,titleI18n:{ru:title},templateKey:value('Шаблон писем'),sourceHash,accessDays:1,dayCardExtraDays:1,webinarExtraDays:1,
  emailHeader:{id:`${slug}-header`,type:'image',src:header,alt:title,width:'100%',align:'center',naturalWidth:Number(dims[1]),naturalHeight:Number(dims[2]),marginTop:0,marginBottom:24},
  introEmail:email('Вводное письмо'),completionEmail:email('Заключительное письмо'),lessons};
}
if(process.argv[1]?.endsWith('/intensive-content.mjs')){
 const [action,input,output]=process.argv.slice(2);if(!['review','parse'].includes(action)||!input||!output)throw new Error('intensive-content.mjs review raw.json review.md | parse review.md course.json');
 const source=await readFile(input,'utf8');
 const result=action==='review'?intensiveReview(JSON.parse(source),JSON.parse(await readFile(new URL('../content/intensives/templates/ru.json',import.meta.url),'utf8'))):JSON.stringify(parseIntensiveReview(source),null,2)+'\n';
 await writeFile(output,result,{flag:action==='review'?'wx':'w'});console.log(action==='review'?'Подготовлен авторский Markdown: 30 дней и два письма.':'Подготовлен JSON: 30 дней и два RU-письма; перед импортом заполните переводы.');
}
