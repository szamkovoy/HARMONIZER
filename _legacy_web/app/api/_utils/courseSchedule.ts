import { DateTime } from 'luxon';

export type CourseScheduleItem = { lessonId: string; opensAt: string; mailAt: string };
export function buildCourseSchedule(lessons: {id: string; gapDays: number}[], start: string, zone: string, testSeconds?: number): CourseScheduleItem[] {
  const purchase = DateTime.fromISO(start, {zone});
  if (!purchase.isValid || !DateTime.now().setZone(zone).isValid) throw new Error('Invalid course date or timezone');
  if (testSeconds != null && (!Number.isInteger(testSeconds) || testSeconds < 60)) throw new Error('Invalid test interval');
  let previous = purchase;
  return lessons.map((lesson, index) => {
    if (!Number.isInteger(lesson.gapDays) || lesson.gapDays < (index ? 1 : 0)) throw new Error('Invalid lesson interval');
    const instant = testSeconds != null ? purchase.plus({seconds: index*testSeconds}) : index===0 ? purchase : previous.startOf('day').plus({days: lesson.gapDays + (index===1 && lesson.gapDays===1 && purchase.hour>=18 ? 1 : 0)});
    previous = instant;
    return { lessonId: lesson.id, opensAt: instant.toUTC().toISO()!, mailAt: (testSeconds != null || index===0 ? instant : instant.set({hour:7})).toUTC().toISO()! };
  });
}

const escape = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
/** Small authored Markdown subset; HTML is escaped, only HTTPS links are emitted. */
export function courseMarkdownHtml(markdown: string): string {
  const inline = (s: string) => escape(s).replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)|(?<!["(])(https:\/\/[^\s<]+)/g, (_,label,url,bare) => `<a href="${url||bare}">${label||bare}</a>`).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
  // Explicit spacers survive the shared mail wrapper's zero paragraph margins.
  return markdown.replace(/\r\n?/g,'\n').trim().split(/(\n[ \t]*\n(?:[ \t]*\n)*)/).map(part => {
    if (/^\n[ \t]*\n/.test(part)) return '<p></p>'.repeat((part.match(/\n/g)?.length ?? 2)-1);
    return /^#{1,6} /.test(part) ? `<h3>${inline(part.replace(/^#{1,6} /,''))}</h3>` : `<p>${inline(part).replace(/\n/g,'<br>')}</p>`;
  }).join('');
}
