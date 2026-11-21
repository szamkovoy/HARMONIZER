import {describe,expect,it} from 'vitest';
import {courseMarkdownHtml} from '../app/api/_utils/courseSchedule';
import {COURSE_LESSON_INVITATION,COURSE_LESSON_URL_PLACEHOLDER,courseLessonBrowserUrl,personalizeCourseLessonEmail,prepareCourseLessonEmailHtml} from './courseLessonEmail';
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
 it('keeps the GetCourse caption and fill of that exact letter',()=>{
  const male=personalizeCourseLessonEmail('<p>Текст</p>','grant-1','month-male-female-05');
  expect(male).toContain('>Урок 5</a>');expect(male).toContain('background:#D46A6A');expect(male).not.toContain('Открыть урок');
  const yoga=personalizeCourseLessonEmail('<p>Текст</p>','grant-1','yoga-health-03');
  expect(yoga).toContain('>Перейти к уроку</a>');expect(yoga).toContain('background:#EC543F');
  const health=personalizeCourseLessonEmail('<p>Текст</p>','grant-1','month-health-08');
  expect(health).toContain('>Посмотреть видео...</a>');expect(health).toContain('background:#FF8262');
 });
});
