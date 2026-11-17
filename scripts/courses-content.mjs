import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

/** Author text is authoritative. Ignore only the review document's known annotations. */
export function parseCourseReview(source) {
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

/** Matches the existing image block's centered 504px content column. */
export function courseEmailHeaderHtml(header){
 if(!header)return '';
 const attr=s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
 return `<div style="margin:0px 0 24px;text-align:center;"><img src="${attr(header.src)}" alt="${attr(header.alt)}" width="504" height="195" style="width:100%;max-width:100%;height:auto;display:inline-block;border:0;" /></div>`;
}

if (process.argv[1]?.endsWith('/courses-content.mjs')) {
  const source = await readFile(new URL('../content/courses/month-health.review.md', import.meta.url), 'utf8');
  const course = parseCourseReview(source);
  await writeFile(new URL('../content/courses/month-health.json', import.meta.url), JSON.stringify(course,null,2)+'\n');
  console.log(`Сохранено ${course.lessons.length} уроков; авторский Markdown не изменён.`);
}
