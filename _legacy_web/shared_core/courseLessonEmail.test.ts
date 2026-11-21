import {describe,expect,it} from 'vitest';
import {courseMarkdownHtml} from '../app/api/_utils/courseSchedule';
import {COURSE_LESSON_INVITATION,COURSE_LESSON_URL_PLACEHOLDER,courseLessonBrowserUrl,courseLessonButtonHtml,normalizeCourseLessonButtonSpacing,personalizeCourseLessonEmail,prepareCourseLessonEmailHtml} from './courseLessonEmail';
describe('Russian lesson email link',()=>{
 it.each(['Урок ждёт вас в Гармонизаторе, на вкладке «День».','Первый урок уже ждёт вас в Гармонизаторе - на вкладке „День“.','Урок уже доступен вам во вкладке "День" Гармонизатора.','Данная практика ждёт вас в Гармонизаторе, на вкладке "День".','Видео ждёт вас в Гармонизаторе, на вкладке «День».'])( 'adapts only the invitation: %s',sentence=>{
  const author=courseMarkdownHtml('Авторское начало. '+sentence+'\n\nЗдоровья!\nСергей Замковой');
  const result=prepareCourseLessonEmailHtml(author);
  expect(result).toContain('Авторское начало. '+COURSE_LESSON_INVITATION);
  expect(result).toContain('<p>Здоровья!<br>Сергей Замковой</p>');
  expect(result.match(/Открыть урок/g)).toHaveLength(1);
  expect(prepareCourseLessonEmailHtml(result)).toBe(result);
 });
 it('inserts the grant-specific HTTPS URL once, and keeps all other links',()=>{
  const html=prepareCourseLessonEmailHtml('<p><a href="https://example.test/">Описание</a></p>');
  const result=personalizeCourseLessonEmail(html,'grant-1','month-01');
  expect(result).toContain('https://zamkovoi.yoga/cabinet/lesson.html?enrollment=grant-1&amp;lesson=month-01');
  expect(result).toContain('background:#569c19');
  expect(result).not.toContain(COURSE_LESSON_URL_PLACEHOLDER);expect(result).toContain('href="https://example.test/"');
  expect(courseLessonBrowserUrl('another-grant','month-01')).not.toBe(courseLessonBrowserUrl('grant-1','month-01'));
 });
 it('keeps a numbered call to action and one blank line on each side of the button',()=>{
  const html=courseMarkdownHtml('Далее нужно будет начать движение.\n\nНажмите кнопку ниже, чтобы открыть третий урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».\n\nНового знания!\nСергей Замковой');
  const result=prepareCourseLessonEmailHtml(html);
  const button=courseLessonButtonHtml();
  expect(result).toContain('чтобы открыть третий урок в браузере');
  expect(result).not.toContain('уже готов');
  expect(result).not.toContain('уже доступен');
  expect(result).toContain('«День».</p><p></p>'+button+'<p></p>');
  expect(result).toContain('<p>Нового знания!<br>Сергей Замковой</p>');
  expect(result.match(/\{\{course_lesson_url\}\}/g)).toHaveLength(1);
  expect(prepareCourseLessonEmailHtml(result)).toBe(result);
 });
 it('adds one blank line above and below the button when the letter has neither',()=>{
  const html='<p>Нажмите кнопку ниже, чтобы открыть второй урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p>Здоровья!</p>';
  const result=prepareCourseLessonEmailHtml(html);
  expect(result).toBe('<p>Нажмите кнопку ниже, чтобы открыть второй урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».</p><p></p>'+courseLessonButtonHtml()+'<p></p><p>Здоровья!</p>');
 });
 it('drops a stacked editor spacer so only one blank line sits below the button',()=>{
  const spacer='<p style="margin:0;padding:0;line-height:1.55;height:1.55em;font-size:16px !important;font-family:Arial,Helvetica,sans-serif;">&nbsp;</p>';
  const html='<p>Призыв.</p><p></p>'+courseLessonButtonHtml()+spacer+'<p>Дальше.</p>';
  expect(normalizeCourseLessonButtonSpacing(html)).toBe('<p>Призыв.</p><p></p>'+courseLessonButtonHtml()+'<p></p><p>Дальше.</p>');
 });
 it('keeps the GetCourse caption and fill of that exact letter',()=>{
  const male=personalizeCourseLessonEmail('<p>Текст</p>','grant-1','month-male-female-05');
  expect(male).toContain('>Урок 5</a>');expect(male).toContain('background:#de6f90');expect(male).not.toContain('Открыть урок');
  const yoga=personalizeCourseLessonEmail('<p>Текст</p>','grant-1','yoga-health-03');
  expect(yoga).toContain('>Перейти к уроку</a>');expect(yoga).toContain('background:#EC543F');
  const health=personalizeCourseLessonEmail('<p>Текст</p>','grant-1','month-health-08');
  expect(health).toContain('>Посмотреть видео...</a>');expect(health).toContain('background:#569c19');
  const pleasure=personalizeCourseLessonEmail('<p>Текст</p>','grant-1','month-pleasure-02');
  expect(pleasure).toContain('>Открыть урок 2</a>');expect(pleasure).toContain('background:#fc38be');
  const strength=personalizeCourseLessonEmail('<p>Текст</p>','grant-1','month-strength-03');
  expect(strength).toContain('>Открыть урок 3</a>');expect(strength).toContain('background:#F89C26');
  const love=personalizeCourseLessonEmail('<p>Текст</p>','grant-1','month-love-04');
  expect(love).toContain('>Открыть доп. урок</a>');expect(love).toContain('background:#569c19');
  const freedom=personalizeCourseLessonEmail('<p>Текст</p>','grant-1','month-freedom-03');
  expect(freedom).toContain('>Урок 3</a>');expect(freedom).toContain('background:#6E9ECF');
  const wisdom=personalizeCourseLessonEmail('<p>Текст</p>','grant-1','month-wisdom-05');
  expect(wisdom).toContain('>Урок 4</a>');expect(wisdom).toContain('background:#156abf');
  const holiness=personalizeCourseLessonEmail('<p>Текст</p>','grant-1','month-holiness-02');
  expect(holiness).toContain('>Урок 2</a>');expect(holiness).toContain('background:#bf56a5');
 });
});
