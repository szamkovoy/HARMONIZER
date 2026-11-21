import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

/** Author text is authoritative. Ignore only the review document's known annotations. */
function parseLegacyCourseReview(source) {
  const headerSrc=source.match(/^\*\*Шапка писем:\*\* (https:\/\/\S+)$/m)?.[1];
  const chunks = [...source.matchAll(/^## (\d{2})\. (.+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)];
  const gaps = [0, 2, 7, 3, 4, 3, 4, 3];
  const practices = { '1133027002': 'cf3c9776-32c8-4c4b-a408-8a0f28843d59', '1146135755': '3ff9bbf1-692c-4647-aafd-f726fab2ac10' };
  const lessons = chunks.map(([,number,heading,body], i) => {
    const letter = body.split('### Письмо\n')[1]?.split('### Урок\n')[0];
    const lesson = body.split('### Урок\n')[1];
    if (!letter || !lesson) throw new Error(`Missing letter/lesson: ${number}`);
    const subject = letter.match(/^\*\*Тема:\*\* (.+)$/m)?.[1];
    const emailMarkdown = letter.replace(/^\s*\*\*Тема:\*\* .+\n/m, '').split(/\n> \*\*Для вашей правки:/)[0].trim();
    const title = lesson.match(/^\*\*Название страницы:\*\* (.+)$/m)?.[1] || heading;
    const clean = lesson.split('\nСверить с источником:')[0].replace(/^\*\*Название страницы:\*\* .+\n/m, '')
      .replace(/^\*(?:Перед основным видео|После видео дополнительного|Этот видимый блок)[^\n]*\n?/gm, '').trim();
    const blocks = []; let previous = 0;
    const videos = [...clean.matchAll(/^\*\*(?:Второе видео|Видео):\*\*[^\n]*https:\/\/player\.vimeo\.com\/video\/(\d+)[^\n]*$/gm)];
    for (const match of videos) {
      const text = clean.slice(previous, match.index).trim();
      if (text) blocks.push({ type: 'text', markdown: text });
      blocks.push({ type: 'video', vimeoId: match[1], ...(practices[match[1]] ? { practiceId: practices[match[1]] } : {}) });
      previous = match.index + match[0].length;
    }
    const tail = clean.slice(previous).trim();
    if (tail) blocks.push({ type: 'text', markdown: tail });
    if (!subject || !emailMarkdown || !videos.length) throw new Error(`Incomplete material ${number}`);
    const writtenGap = body.match(/\*\*Когда открывается:\*\* через (\d+)/)?.[1];
    return { id: `month-health-${number}`, position: i+1, gapDays: i===0 ? 0 : Number(writtenGap ?? gaps[i]), title, blocks, email: { subject, markdown: emailMarkdown } };
  });
  if (lessons.length !== 8) throw new Error(`Expected 8 materials, got ${lessons.length}`);
  if (lessons.flatMap(l=>l.blocks).filter(b=>b.vimeoId==='1149520174').length!==1) throw new Error('Approved continuation video must occur once');
  return { version: 1, slug: 'month-health', kind: 'practicum', title: 'Месяц здоровья', landingUrl: 'https://zamkovoi.yoga/m1', accessDays: 90, dayCardExtraDays: 3, webinarExtraDays: 5,
    ...(headerSrc?{emailHeader:{id:'course-month-health-header',type:'image',src:headerSrc,alt:'Месяц здоровья',width:'100%',naturalWidth:600,naturalHeight:232,align:'center',marginTop:0,marginBottom:24}}:{}),
    sourceHash: createHash('sha256').update(source).digest('hex'), lessons };
}

/** Generic author document. No pilot IDs, gaps or bonus mappings leak into another course. */
export function parseCourseReview(rawSource){
 const source=rawSource.replace(/\r\n?/g,'\n');
 const sourceHash=createHash('sha256').update(rawSource).digest('hex');
 const value=name=>source.match(new RegExp('^\\*\\*'+name+':\\*\\* (.+)$','m'))?.[1]?.trim();
 const slug=value('Код курса');
 if(!slug){
  if(!source.startsWith('# Месяц здоровья — уроки и письма'))throw new Error('Укажите **Код курса:** и метаданные нового курса');
  return {...parseLegacyCourseReview(source),sourceHash};
 }
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug==='month-health')throw new Error('Нужен уникальный код нового курса, отличный от month-health');
 const required=name=>{const v=value(name);if(!v)throw new Error(`Не указано поле «${name}»`);return v;};
 const days=name=>{const v=required(name);if(!/^\d+(?: (?:день|дня|дней))?$/.test(v)||Number(v.split(' ')[0])<=0)throw new Error(`Некорректное число дней: ${name}`);return Number(v.split(' ')[0]);};
 const title=required('Название курса');const kind=required('Тип');
 if(kind==='intensive')throw new Error('Ежедневные интенсивы переносите отдельным scripts/intensive-content.mjs; этот механизм сохраняет накопительные курсы');
 if(!['practicum','intensive','course','masterclass'].includes(kind))throw new Error('Тип: practicum, intensive, course или masterclass');
 const landingUrl=value('Лендинг')??'';if(landingUrl&&!/^https:\/\/[^\s]+$/.test(landingUrl))throw new Error('Лендинг должен быть HTTPS URL');
 const clean=text=>text.split(/\n(?:### Источники переноса|Сверить с источником:|> \*\*Для вашей правки:)/)[0].trim();
 const email=text=>{
  const subject=text?.match(/^\*\*Тема:\*\* (.+)$/m)?.[1];
  const markdown=clean((text??'').replace(/^\*\*Тема:\*\* .+\n?/m,''));
  if(!subject||!markdown)throw new Error('Нужны тема и полный текст письма');return {subject,markdown};
 };
 if([...source.matchAll(/^## ([^\n]+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)].some(([,name,body])=>!/^\d{2}\. /.test(name)&&name!=='Завершающее письмо'&&/^### Письмо$/m.test(body)))throw new Error('Отдельные вводные или промежуточные письма требуют отдельной поддержки; не теряйте их при импорте');
 const lessons=[...source.matchAll(/^## (\d{2})\. (.+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)].map(([,number,heading,body],i)=>{
  if(Number(number)!==i+1)throw new Error('Материалы должны идти последовательно 01, 02, …');
  const gap=body.match(/^\*\*Когда открывается:\*\* (.+)$/m)?.[1];
  const gapDays=i===0&&gap==='сразу'?0:Number(gap?.match(/^через (\d+) (?:день|дня|дней)(?: после предыдущего материала)?$/)?.[1]);
  if(!Number.isInteger(gapDays)||gapDays<(i?1:0)||(!i&&gapDays!==0))throw new Error(`Явно укажите интервал материала ${number} в календарных днях`);
  const letter=body.split('### Письмо\n')[1]?.split('### Урок\n')[0];
  const rawLesson=body.split('### Урок\n')[1];if(rawLesson==null)throw new Error(`Нет урока ${number}`);
  const lessonTitle=rawLesson.match(/^\*\*Название страницы:\*\* (.+)$/m)?.[1]??heading;
  const text=clean(rawLesson.replace(/^\*\*Название страницы:\*\* .+\n?/m,''));
  const blocks=[];let previous=0;
  for(const m of text.matchAll(/^\*\*(?:Второе видео|Видео):\*\*[^\n]*https:\/\/player\.vimeo\.com\/video\/(\d+)[^\n]*$/gm)){
   const paragraph=text.slice(previous,m.index).replace(/\s+$/,'');if(paragraph.trim())blocks.push({type:'text',markdown:paragraph});
   const practiceId=m[0].match(/practiceId=([0-9a-f-]{36})/i)?.[1];
   if(m[0].includes('practiceId=')&&!practiceId)throw new Error(`Проверьте practiceId в материале ${number}`);
   blocks.push({type:'video',vimeoId:m[1],...(practiceId?{practiceId}:{})});previous=m.index+m[0].length;
  }
  const tail=text.slice(previous).replace(/\s+$/,'');if(tail.trim())blocks.push({type:'text',markdown:tail});
  if(!blocks.length)throw new Error(`Пустой урок ${number}`);
  if(/\*\*(?:Второе видео|Видео):\*\*/.test(blocks.filter(b=>b.type==='text').map(b=>b.markdown).join('')))throw new Error(`Проверьте ссылку player.vimeo.com/video в материале ${number}`);
  return {id:`${slug}-${number}`,position:i+1,gapDays,title:lessonTitle,blocks,email:email(letter)};
 });
 if(!lessons.length)throw new Error('Нет учебных материалов');
 const closing=[...source.matchAll(/^## Завершающее письмо\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)];
 if(closing.length>1)throw new Error('Поддержано одно завершающее письмо');
 const displayDays=days('Показ последнего урока');
 let completionEmail;
 if(closing.length){
  const section=closing[0][1];
  if(!/^\*\*Когда отправляется:\*\* через 3 дня после последнего урока$/m.test(section)||displayDays!==3||/^### Урок$/m.test(section))throw new Error('Завершающее письмо: через 3 дня после последнего урока, без секции урока');
  completionEmail=email(section.split('### Письмо\n')[1]);
 }
 const src=value('Шапка писем');if(src&&!/^https:\/\/[^\s]+$/.test(src))throw new Error('Перед импортом разместите картинку через email CDN и укажите HTTPS URL шапки');
 const dimensions=value('Размер шапки')?.match(/^(\d+)\s*[x×]\s*(\d+)$/);
 const emailHeader=src?{id:`course-${slug}-header`,type:'image',src,alt:title,width:'100%',align:'center',marginTop:0,marginBottom:24,...(dimensions?{naturalWidth:Number(dimensions[1]),naturalHeight:Number(dimensions[2])}:{})}:null;
 return {version:1,slug,kind,title,landingUrl,accessDays:days('Доступ после последнего урока'),dayCardExtraDays:displayDays,webinarExtraDays:days('Вебинарный пропуск после последнего урока'),...(emailHeader?{emailHeader}:{}),sourceHash,lessons,...(completionEmail?{completionEmail}:{})};
}

/** Centered existing 504px email column; retain the supplied image's own ratio. */
export function courseEmailHeaderHtml(header){
 if(!header)return '';
 const attr=s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
 const height=header.naturalWidth>0&&header.naturalHeight>0?` height="${Math.round(504*header.naturalHeight/header.naturalWidth)}"`:'';
 return `<div style="margin:0px 0 24px;text-align:center;"><img src="${attr(header.src)}" alt="${attr(header.alt)}" width="504"${height} style="width:100%;max-width:100%;height:auto;display:inline-block;border:0;" /></div>`;
}

if (process.argv[1]?.endsWith('/courses-content.mjs')) {
  const input=process.argv.slice(2).find(a=>a.endsWith('.md'));
  const output=process.argv.slice(2).find(a=>a.endsWith('.json'))||(input?input.replace(/(?:\.review)?\.md$/,'.json'):new URL('../content/courses/month-health.json',import.meta.url));
  const source = await readFile(input||new URL('../content/courses/month-health.review.md', import.meta.url), 'utf8');
  const course = parseCourseReview(source);
  await writeFile(output, JSON.stringify(course,null,2)+'\n');
  console.log(`Сохранено ${course.lessons.length} уроков и ${course.lessons.length+(course.completionEmail?1:0)} писем; авторский Markdown не изменён.`);
}
