import type {CourseView} from '@shared/courses';
export function showsOnDay(c:CourseView,now=Date.now()) {
  return c.state==='available'&&Date.parse(c.accessUntil)>now&&Date.parse(c.displayUntil)>now&&!!c.current;
}
/** Completion follows the three-day display window, not the final release. */
export function isCourseArchive(c:CourseView,now=Date.now()) {return Date.parse(c.displayUntil)<=now;}
/** Persist entitlement metadata only, never lesson text or video identifiers. */
export function courseMetadata(courses:CourseView[]):CourseView[] {
  return courses.map(c=>({...c,current:c.current?{...c.current,blocks:[]}:null}));
}
