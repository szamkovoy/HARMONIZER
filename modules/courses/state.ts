import type {CourseView} from '@shared/courses';
export function showsOnDay(c:CourseView,now=Date.now()) {
  return c.state==='available'&&Date.parse(c.accessUntil)>now&&Date.parse(c.displayUntil)>now&&!!c.current&&!(c.kind==='intensive'&&!c.reviewAllLessons&&c.currentUntil&&Date.parse(c.currentUntil)<=now);
}
/** Completion follows the three-day display window, not the final release. */
export function isCourseArchive(c:CourseView,now=Date.now()) {return Date.parse(c.displayUntil)<=now;}
/** Persist entitlement metadata only, never lesson text or video identifiers. */
export function courseMetadata(courses:CourseView[]):CourseView[] {
  return courses.map(c=>({...c,current:c.current?{...c.current,blocks:[],blocksI18n:undefined}:null}));
}
export function localizeCourse(c:CourseView,locale:string):CourseView {
 return c.kind==='intensive'&&locale!=='ru'?{...c,title:c.titleI18n?.[locale]??c.titleI18n?.en??c.title}:c;
}
export function intensiveDayTitle(locale:string,position:number):string {
 const day:Record<string,string>={ru:'День',en:'Day',de:'Tag',fr:'Jour',it:'Giorno',es:'Día',pt:'Dia',nl:'Dag'};
 return `${day[locale]??day.en}: ${position}`;
}
