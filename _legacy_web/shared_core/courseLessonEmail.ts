export const COURSE_LESSON_URL_PLACEHOLDER='{{course_lesson_url}}';
export const COURSE_LESSON_INVITATION='Нажмите кнопку ниже, чтобы открыть урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».';
export function courseLessonBrowserUrl(enrollmentId:string,lessonId:string):string {
 const url=new URL('https://zamkovoi.yoga/cabinet/lesson.html');
 url.searchParams.set('enrollment',enrollmentId);url.searchParams.set('lesson',lessonId);
 return url.toString();
}
const escapeAttr=(s:string)=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
const escapeText=(s:string)=>escapeAttr(s).replaceAll('>','&gt;');
/** Caption and fill copied from the GetCourse letter of that lesson (2026-11-21). */
const LESSON_BUTTONS:Record<string,readonly [string,string]>={
 'month-freedom-01':['Урок 1','#6E9ECF'],'month-freedom-02':['Урок 2','#6E9ECF'],'month-freedom-03':['Урок 3','#6E9ECF'],'month-freedom-04':['Открыть доп. урок 1','#6E9ECF'],'month-freedom-05':['Урок 4','#6E9ECF'],'month-freedom-06':['Открыть доп. урок 2','#6E9ECF'],'month-freedom-07':['Урок 5','#6E9ECF'],
 'month-health-01':['Открыть урок 1','#569c19'],'month-health-02':['Открыть урок 2','#569c19'],'month-health-03':['Открыть урок 3','#569c19'],'month-health-04':['Открыть доп. урок...','#569c19'],'month-health-05':['Открыть урок 4','#569c19'],'month-health-06':['Открыть доп. урок...','#569c19'],'month-health-07':['Открыть урок 5','#569c19'],'month-health-08':['Посмотреть видео...','#569c19'],
 'month-holiness-01':['Урок 1','#bf56a5'],'month-holiness-02':['Урок 2','#bf56a5'],'month-holiness-03':['Урок 3','#bf56a5'],'month-holiness-04':['Открыть доп. урок 1','#bf56a5'],'month-holiness-05':['Урок 4','#bf56a5'],'month-holiness-06':['Открыть доп. урок 2','#bf56a5'],'month-holiness-07':['Урок 5','#bf56a5'],
 'month-love-01':['Открыть урок 1','#569c19'],'month-love-02':['Открыть урок 2','#569c19'],'month-love-03':['Открыть урок 3','#569c19'],'month-love-04':['Открыть доп. урок','#569c19'],'month-love-05':['Открыть урок 4','#569c19'],'month-love-06':['Открыть доп. урок','#569c19'],'month-love-07':['Открыть урок 5','#569c19'],
 'month-male-female-01':['Урок 1','#de6f90'],'month-male-female-02':['Урок 2','#de6f90'],'month-male-female-03':['Урок 3','#de6f90'],'month-male-female-04':['Урок 4','#de6f90'],'month-male-female-05':['Урок 5','#de6f90'],
 'month-pleasure-01':['Открыть урок 1','#fc38be'],'month-pleasure-02':['Открыть урок 2','#fc38be'],'month-pleasure-03':['Открыть урок 3','#fc38be'],'month-pleasure-04':['Открыть доп. урок','#fc38be'],'month-pleasure-05':['Открыть урок 4','#fc38be'],'month-pleasure-06':['Открыть доп. урок','#fc38be'],'month-pleasure-07':['Открыть урок 5','#fc38be'],
 'month-strength-01':['Открыть урок 1','#F89C26'],'month-strength-02':['Открыть урок 2','#F89C26'],'month-strength-03':['Открыть урок 3','#F89C26'],'month-strength-04':['Открыть доп. урок','#F89C26'],'month-strength-05':['Открыть урок 4','#F89C26'],'month-strength-06':['Открыть доп. урок','#F89C26'],'month-strength-07':['Открыть урок 5','#F89C26'],
 'month-wisdom-01':['Урок 1','#156abf'],'month-wisdom-02':['Урок 2','#156abf'],'month-wisdom-03':['Урок 3','#156abf'],'month-wisdom-04':['Открыть доп. урок 1','#156abf'],'month-wisdom-05':['Урок 4','#156abf'],'month-wisdom-06':['Открыть доп. урок 2','#156abf'],'month-wisdom-07':['Урок 5','#156abf'],
 'yoga-health-01':['Перейти к уроку','#EC543F'],'yoga-health-02':['Перейти к уроку','#EC543F'],'yoga-health-03':['Перейти к уроку','#EC543F'],'yoga-health-04':['Перейти к уроку','#EC543F'],'yoga-health-05':['Перейти к уроку','#EC543F'],'yoga-health-06':['Перейти к уроку','#EC543F'],'yoga-health-07':['Перейти к уроку','#EC543F'],'yoga-health-08':['Перейти к уроку','#EC543F'],'yoga-health-09':['Перейти к уроку','#EC543F'],'yoga-health-10':['Перейти к уроку','#EC543F'],'yoga-health-11':['Перейти к уроку','#EC543F'],'yoga-health-12':['Перейти к уроку','#EC543F'],'yoga-health-13':['Перейти к уроку','#EC543F'],'yoga-health-14':['Перейти к уроку','#EC543F'],'yoga-health-15':['Перейти к уроку','#EC543F'],'yoga-health-16':['Перейти к уроку','#EC543F'],'yoga-health-17':['Перейти к уроку','#EC543F'],'yoga-health-18':['Перейти к уроку','#EC543F'],
 'yoga-femininity-01':['Перейти к уроку','#24bd96'],'yoga-femininity-02':['Перейти к уроку','#24bd96'],'yoga-femininity-03':['Перейти к уроку','#24bd96'],'yoga-femininity-04':['Ваша ссылка на урок','#24bd96'],'yoga-femininity-05':['Перейти к уроку','#24bd96'],'yoga-femininity-06':['Перейти к уроку','#24bd96'],'yoga-femininity-07':['Перейти к уроку','#24bd96'],'yoga-femininity-08':['Перейти к уроку','#24bd96'],'yoga-femininity-09':['Перейти к уроку','#24bd96'],'yoga-femininity-10':['Перейти к уроку','#24bd96'],'yoga-femininity-11':['Перейти к уроку','#24bd96'],'yoga-femininity-12':['Перейти к уроку','#24bd96'],'yoga-femininity-13':['Перейти к уроку','#24bd96'],
};
const DEFAULT_BUTTON:readonly [string,string]=['Открыть урок','#569c19'];
function buttonOf(lessonId?:string):readonly [string,string] {
 const found=lessonId?LESSON_BUTTONS[lessonId]:undefined;
 return found&&/^#[0-9a-fA-F]{6}$/.test(found[1])?found:DEFAULT_BUTTON;
}
/** GetCourse bulletproof button: the border is the padding, so mail clients keep the fill. */
export function courseLessonButtonHtml(href=COURSE_LESSON_URL_PLACEHOLDER,lessonId?:string):string {
 const [label,color]=buttonOf(lessonId);
 return `<p style="text-align:center"><a href="${escapeAttr(href)}" target="_blank" style="border-style:solid;border-color:${color};border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:${color};mso-line-height-rule:exactly">${escapeText(label)}</a></p>`;
}
const DAY_QUOTE='(?:[«»„“"]|&quot;|&#34;|&laquo;|&raquo;)';
const OLD_DAY_INVITATION=new RegExp('(?:Первый |Третий )?(?:[Уу]рок(?: \\d+)?|Видео|Данная практика) (?:уже )?(?:ждёт вас|ожидает вас|доступен (?:вам|Вам))(?: в Гармонизаторе[^<.!?]*'+DAY_QUOTE+'День'+DAY_QUOTE+'| во вкладке '+DAY_QUOTE+'День'+DAY_QUOTE+' Гармонизатора)|Он уже доступен вам во вкладке '+DAY_QUOTE+'День'+DAY_QUOTE+' Гармонизатора| - который уже доступен Вам во вкладке '+DAY_QUOTE+'День'+DAY_QUOTE+' Гармонизатора| Этот урок уже доступен во вкладке '+DAY_QUOTE+'День'+DAY_QUOTE+' Гармонизатора\\.');
const CALL_TO_ACTION=new RegExp('Нажмите кнопку ниже, чтобы открыть [\\s\\S]+?вкладке '+DAY_QUOTE+'День'+DAY_QUOTE+'\\.');
const EDITOR_BLANK_SPACER='<p style="margin:0;padding:0;line-height:1.55;height:1.55em;font-size:16px !important;font-family:Arial,Helvetica,sans-serif;">&nbsp;</p>';
function leadingBlankParagraphLength(html:string):number {
  const match=/^<p\b[^>]*>\s*(?:<br\s*\/?>|&nbsp;|\u00a0|\s)*<\/p>/i.exec(html);
  return match?match[0].length:0;
}
/** One visual blank line = a single `<p></p>`, not `<p></p>` plus editor `&nbsp;` spacer. */
export function normalizeCourseLessonButtonSpacing(html:string):string {
  return html
    .replaceAll(`</a></p><p></p>${EDITOR_BLANK_SPACER}`,`</a></p><p></p>`)
    .replaceAll(`</a></p>${EDITOR_BLANK_SPACER}`,`</a></p><p></p>`);
}
/**
 * Adapt only the old lesson invitation. A call to action that already names
 * the lesson stays as written. One blank line above the button, and one below
 * when the letter does not already have it.
 */
export function prepareCourseLessonEmailHtml(html:string,lessonId?:string):string {
 if(html.includes(COURSE_LESSON_URL_PLACEHOLDER))return normalizeCourseLessonButtonSpacing(html);
 const paragraphs=/<p\b[^>]*>[\s\S]*?<\/p>/gi;
 let match:RegExpExecArray|null;
 let inserted=false;
 let result='';
 let cursor=0;
 while((match=paragraphs.exec(html))){
  const start=match.index;
  const end=start+match[0].length;
  result+=html.slice(cursor,start);
  const rewritten=match[0].replace(OLD_DAY_INVITATION,COURSE_LESSON_INVITATION);
  const actionable=rewritten!==match[0]||CALL_TO_ACTION.test(rewritten)||rewritten.includes(COURSE_LESSON_INVITATION);
  if(!inserted&&actionable){
   inserted=true;
   const after=html.slice(end);
   const blank=leadingBlankParagraphLength(after);
   const button=courseLessonButtonHtml(COURSE_LESSON_URL_PLACEHOLDER,lessonId);
   result+=rewritten+'<p></p>'+button+(blank?after.slice(0,blank):'<p></p>');
   cursor=end+blank;
   paragraphs.lastIndex=cursor;
   continue;
  }
  result+=match[0];
  cursor=end;
 }
 result+=html.slice(cursor);
 const out=inserted?result:result+'<p></p>'+courseLessonButtonHtml(COURSE_LESSON_URL_PLACEHOLDER,lessonId)+'<p></p>';
 return normalizeCourseLessonButtonSpacing(out);
}
export function personalizeCourseLessonEmail(html:string,enrollmentId:string,lessonId:string):string {
 const prepared=prepareCourseLessonEmailHtml(html);
 const generic=courseLessonButtonHtml();
 const specific=courseLessonButtonHtml(courseLessonBrowserUrl(enrollmentId,lessonId),lessonId);
 return prepared.includes(generic)?prepared.replaceAll(generic,specific):prepared.replaceAll(COURSE_LESSON_URL_PLACEHOLDER,escapeAttr(courseLessonBrowserUrl(enrollmentId,lessonId)));
}
