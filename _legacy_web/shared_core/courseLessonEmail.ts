export const COURSE_LESSON_URL_PLACEHOLDER='{{course_lesson_url}}';
export const COURSE_LESSON_INVITATION='Нажмите на кнопку, чтобы открыть урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».';
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
 'month-health-01':['Открыть урок 1','#569c19'],'month-health-02':['Открыть урок 2','#569c19'],'month-health-03':['Открыть урок 3','#569c19'],'month-health-04':['Открыть доп. урок...','#569c19'],'month-health-05':['Открыть урок 4','#569c19'],'month-health-06':['Открыть доп. урок...','#569c19'],'month-health-07':['Открыть урок 5','#569c19'],'month-health-08':['Посмотреть видео...','#FF8262'],
 'month-holiness-01':['Урок 1','#bf56a5'],'month-holiness-02':['Урок 2','#bf56a5'],'month-holiness-03':['Урок 3','#bf56a5'],'month-holiness-04':['Открыть доп. урок 1','#bf56a5'],'month-holiness-05':['Урок 4','#bf56a5'],'month-holiness-06':['Открыть доп. урок 2','#bf56a5'],'month-holiness-07':['Урок 5','#bf56a5'],
 'month-love-01':['Урок 1','#199c68'],'month-love-02':['Урок 2','#569c19'],'month-love-03':['Урок 3','#569c19'],'month-love-04':['Открыть доп. урок','#569c19'],'month-love-05':['Урок 4','#569c19'],'month-love-06':['Открыть доп. урок','#569c19'],'month-love-07':['Урок 5','#569c19'],
 'month-male-female-01':['Урок 1','#D46A6A'],'month-male-female-02':['Урок 2','#D46A6A'],'month-male-female-03':['Урок 3','#D46A6A'],'month-male-female-04':['Урок 4','#D46A6A'],'month-male-female-05':['Урок 5','#D46A6A'],
 'month-pleasure-01':['Открыть урок 1','#fc38be'],'month-pleasure-02':['Открыть урок 2','#fc38be'],'month-pleasure-03':['Открыть урок 3','#fc38be'],'month-pleasure-04':['Открыть доп. урок','#fc38be'],'month-pleasure-05':['Открыть урок 4','#fc38be'],'month-pleasure-06':['Открыть доп. урок','#fc38be'],'month-pleasure-07':['Открыть урок 5','#fc38be'],
 'month-strength-01':['Открыть урок 1','#199c68'],'month-strength-02':['Урок 2','#65a336'],'month-strength-03':['Урок 3','#65a336'],'month-strength-04':['Открыть доп. урок','#65a336'],'month-strength-05':['Урок 4','#65a336'],'month-strength-06':['Открыть доп. урок','#65a336'],'month-strength-07':['Урок 5','#65a336'],
 'month-wisdom-01':['Урок 1','#6E9ECF'],'month-wisdom-02':['Урок 2','#6E9ECF'],'month-wisdom-03':['Урок 3','#6E9ECF'],'month-wisdom-04':['Открыть доп. урок 1','#6E9ECF'],'month-wisdom-05':['Урок 4','#6E9ECF'],'month-wisdom-06':['Открыть доп. урок 2','#6E9ECF'],'month-wisdom-07':['Урок 5','#6E9ECF'],
 'yoga-health-01':['Перейти к уроку','#EC543F'],'yoga-health-02':['Перейти к уроку','#EC543F'],'yoga-health-03':['Перейти к уроку','#EC543F'],'yoga-health-04':['Перейти к уроку','#EC543F'],'yoga-health-05':['Перейти к уроку','#EC543F'],'yoga-health-06':['Перейти к уроку','#EC543F'],'yoga-health-07':['Перейти к уроку','#EC543F'],'yoga-health-08':['Перейти к уроку','#EC543F'],'yoga-health-09':['Перейти к уроку','#EC543F'],'yoga-health-10':['Перейти к уроку','#EC543F'],'yoga-health-11':['Перейти к уроку','#EC543F'],'yoga-health-12':['Перейти к уроку','#EC543F'],'yoga-health-13':['Перейти к уроку','#EC543F'],'yoga-health-14':['Перейти к уроку','#EC543F'],'yoga-health-15':['Перейти к уроку','#EC543F'],'yoga-health-16':['Перейти к уроку','#EC543F'],'yoga-health-17':['Перейти к уроку','#EC543F'],'yoga-health-18':['Перейти к уроку','#EC543F'],
};
const DEFAULT_BUTTON:readonly [string,string]=['Открыть урок','#569c19'];
function buttonOf(lessonId?:string):readonly [string,string] {
 const found=lessonId?LESSON_BUTTONS[lessonId]:undefined;
 return found&&/^#[0-9a-fA-F]{6}$/.test(found[1])?found:DEFAULT_BUTTON;
}
/** GetCourse bulletproof button: the border is the padding, so mail clients keep the fill. */
export function courseLessonButtonHtml(href=COURSE_LESSON_URL_PLACEHOLDER,lessonId?:string):string {
 const [label,color]=buttonOf(lessonId);
 return `<p style="margin:16px 0;text-align:center"><a href="${escapeAttr(href)}" target="_blank" style="border-style:solid;border-color:${color};border-width:6px 20px;display:inline-block;border-radius:4px;font-size:18px;font-family:Helvetica,Arial,sans-serif;font-weight:normal;color:#ffffff;text-decoration:none;background:${color};mso-line-height-rule:exactly">${escapeText(label)}</a></p>`;
}
/** Adapt only the old lesson invitation; the rest of the author's letter is untouched. */
export function prepareCourseLessonEmailHtml(html:string):string {
 if(html.includes(COURSE_LESSON_URL_PLACEHOLDER))return html;
 const quote='(?:[«»„“"]|&quot;|&#34;|&laquo;|&raquo;)';
 const invitation=new RegExp('(?:Первый |Третий )?(?:[Уу]рок(?: \\d+)?|Видео|Данная практика) (?:уже )?(?:ждёт вас|ожидает вас|доступен вам) (?:в Гармонизаторе[^<.!?]*'+quote+'День'+quote+'|во вкладке '+quote+'День'+quote+' Гармонизатора)\\.');
 let inserted=false;
 const result=html.replace(/<p\b[^>]*>[\s\S]*?<\/p>/gi,paragraph=>{
  if(inserted)return paragraph;
  if(!invitation.test(paragraph)&&!paragraph.includes(COURSE_LESSON_INVITATION))return paragraph;
  inserted=true;
  return paragraph.replace(invitation,COURSE_LESSON_INVITATION)+courseLessonButtonHtml();
 });
 return inserted?result:result+courseLessonButtonHtml();
}
export function personalizeCourseLessonEmail(html:string,enrollmentId:string,lessonId:string):string {
 const prepared=prepareCourseLessonEmailHtml(html);
 const generic=courseLessonButtonHtml();
 const specific=courseLessonButtonHtml(courseLessonBrowserUrl(enrollmentId,lessonId),lessonId);
 return prepared.includes(generic)?prepared.replaceAll(generic,specific):prepared.replaceAll(COURSE_LESSON_URL_PLACEHOLDER,escapeAttr(courseLessonBrowserUrl(enrollmentId,lessonId)));
}
