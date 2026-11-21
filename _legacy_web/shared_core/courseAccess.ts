import type {CourseView} from './courses';
import {courseStrings} from './courseStrings';

/** One access boundary and one notice for Profile and the standalone lesson. */
export function hasCourseAccess(course:Pick<CourseView,'state'|'accessUntil'>,now=Date.now()):boolean {
 return course.state==='available'&&Date.parse(course.accessUntil)>now;
}

export function courseAccessNotice(course:Pick<CourseView,'startedAt'|'accessUntil'|'timezone'>,locale:string) {
 const strings=courseStrings(locale);
 const options=course.timezone?{timeZone:course.timezone}:undefined;
 const dates=`${new Date(course.startedAt).toLocaleDateString(locale,options)} — ${new Date(course.accessUntil).toLocaleDateString(locale,options)}`;
 return {title:strings.expired,period:`${strings.period}: ${dates}`,message:strings.repeat};
}
