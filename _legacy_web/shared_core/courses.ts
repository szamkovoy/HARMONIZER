export type CourseBlock = {type:'text'; markdown:string} | {type:'video'; vimeoId:string; practiceId?:string};
export type CourseLesson = {id:string; position:number; title:string; blocks:CourseBlock[]};
export type CourseView = {
 id:string; slug:string; title:string; mode:'normal'|'test'; startedAt:string;
 accessUntil:string; displayUntil:string; landingUrl:string;
 state:'available'|'expired'|'revoked'; current:CourseLesson|null;
 lessons:{id:string;position:number;title:string}[]; nextChangeAt:string|null;
};
