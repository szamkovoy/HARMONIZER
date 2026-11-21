import { DateTime } from 'luxon';
import {courseInline,courseInlineHtml} from '../../../shared_core/courseInline.ts';

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

/** Only real lessons anchor access. Test emails accelerate independently of the real Day display window. */
export function courseRunDates(schedule:CourseScheduleItem[],zone:string,accessDays:number,displayDays:number,hasCompletion:boolean,test=false) {
 const last=DateTime.fromISO(schedule.at(-1)?.opensAt??'').setZone(zone);
 if(!last.isValid||!Number.isInteger(accessDays)||accessDays<=0||!Number.isInteger(displayDays)||displayDays<=0)throw new Error('Invalid course deadlines');
 const display=last.plus({days:displayDays});
 let completion=hasCompletion?(test?last.plus({seconds:120}):display.startOf('day').set({hour:7})):null;
 if(completion&&!test&&completion<display)completion=completion.plus({days:1});
 return {accessUntil:last.plus({days:accessDays}).toUTC().toISO()!,displayUntil:display.toUTC().toISO()!,completionMailAt:completion?.toUTC().toISO()??null};
}

/** Intensive lessons use buildCourseSchedule too; only the final access/mail boundaries differ. */
export function intensiveRunDates(schedule:CourseScheduleItem[],zone:string){
 const last=DateTime.fromISO(schedule.at(-1)?.opensAt??'').setZone(zone);
 if(!last.isValid||schedule.length!==30)throw new Error('Intensive requires 30 lessons');
 const end=last.startOf('day').plus({days:1}).toUTC().toISO()!;
 return {accessUntil:end,displayUntil:end,completionMailAt:last.startOf('day').set({hour:7}).toUTC().toISO()!};
}

/** Small authored Markdown subset; HTML is escaped, only HTTPS links are emitted. */
export function courseMarkdownHtml(markdown: string): string {
  const inline = (s: string) => courseInlineHtml(courseInline(s));
  // Explicit spacers survive the shared mail wrapper's zero paragraph margins.
  return markdown.replace(/\r\n?/g,'\n').trim().split(/(\n[ \t]*\n(?:[ \t]*\n)*)/).map(part => {
    if (/^\n[ \t]*\n/.test(part)) return '<p></p>'.repeat((part.match(/\n/g)?.length ?? 2)-1);
    return /^#{1,6} /.test(part) ? `<h3>${inline(part.replace(/^#{1,6} /,''))}</h3>` : `<p>${inline(part).replace(/\n/g,'<br>')}</p>`;
  }).join('');
}
