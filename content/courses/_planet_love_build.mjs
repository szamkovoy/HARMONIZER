import {readFileSync, writeFileSync} from 'node:fs';

const emails = JSON.parse(readFileSync(new URL('./_planet_love_emails_1.json', import.meta.url), 'utf8'));
const lessons = JSON.parse(readFileSync(new URL('./_planet_love_lessons.json', import.meta.url), 'utf8'));

const ORD = [
  'первый','второй','третий','четвёртый','пятый','шестой','седьмой','восьмой','девятый','десятый',
  'одиннадцатый','двенадцатый','тринадцатый','четырнадцатый','пятнадцатый','шестнадцатый',
  'дополнительный','семнадцатый','восемнадцатый',
];

const META = [
  {gap:0, delayId:947796, delay:'1 минута от текущего момента, без ожидания дня и часа', mailBlock:947688, mailId:914976, openBlock:947689, lessonId:52051538, button:'Перейти к уроку'},
  {gap:1, delayId:978977, delay:'1 день от текущего момента, без ожидания дня и часа', mailBlock:978978, mailId:937373, openBlock:947690, lessonId:55462527, button:'Перейти к уроку'},
  {gap:2, delayId:947708, delay:'2 дня от текущего момента, без ожидания дня и часа', mailBlock:947707, mailId:934839, openBlock:947691, lessonId:55462529, button:'Перейти к уроку'},
  {gap:1, delayId:947715, delay:'1 день от текущего момента, без ожидания дня и часа', mailBlock:947709, mailId:940256, openBlock:947692, lessonId:55840799, button:'Перейти к уроку'},
  {gap:3, delayId:947716, delay:'3 дня от текущего момента, без ожидания дня и часа', mailBlock:947710, mailId:940261, openBlock:947693, lessonId:55840800, button:'Перейти к уроку'},
  {gap:1, delayId:947717, delay:'1 день от текущего момента, без ожидания дня и часа', mailBlock:947711, mailId:940262, openBlock:947694, lessonId:55841059, button:'Перейти к уроку'},
  {gap:2, delayId:947718, delay:'2 дня от текущего момента, без ожидания дня и часа', mailBlock:947712, mailId:940264, openBlock:947695, lessonId:55841063, button:'Перейти к уроку'},
  {gap:1, delayId:947719, delay:'1 день от текущего момента, без ожидания дня и часа', mailBlock:947713, mailId:940265, openBlock:947696, lessonId:55841067, button:'Перейти к уроку'},
  {gap:3, delayId:947720, delay:'3 дня от текущего момента, без ожидания дня и часа', mailBlock:947714, mailId:940267, openBlock:947697, lessonId:55841070, button:'Перейти к уроку'},
  {gap:1, delayId:947730, delay:'1 день от текущего момента, без ожидания дня и часа', mailBlock:947722, mailId:940268, openBlock:947698, lessonId:55841073, button:'Перейти к уроку'},
  {gap:2, delayId:947731, delay:'2 дня от текущего момента, без ожидания дня и часа', mailBlock:947723, mailId:940270, openBlock:947699, lessonId:55841076, button:'Перейти к уроку'},
  {gap:1, delayId:947732, delay:'1 день от текущего момента, без ожидания дня и часа', mailBlock:947724, mailId:940271, openBlock:947700, lessonId:55841080, button:'Перейти к уроку'},
  {gap:3, delayId:947733, delay:'3 дня от текущего момента, без ожидания дня и часа', mailBlock:947725, mailId:940272, openBlock:947701, lessonId:55841089, button:'Перейти к уроку'},
  {gap:1, delayId:947734, delay:'1 день от текущего момента, без ожидания дня и часа', mailBlock:947726, mailId:940273, openBlock:947702, lessonId:55841090, button:'Перейти к уроку'},
  {gap:2, delayId:947735, delay:'2 дня от текущего момента, без ожидания дня и часа', mailBlock:947727, mailId:940275, openBlock:947703, lessonId:55841094, button:'Перейти к уроку'},
  {gap:1, delayId:947736, delay:'1 день от текущего момента, без ожидания дня и часа', mailBlock:947728, mailId:940277, openBlock:947704, lessonId:55841100, button:'Перейти к уроку'},
  {gap:1, delayId:947741, delay:'1 день от текущего момента, без ожидания дня и часа', mailBlock:1082539, mailId:1016212, openBlock:1082540, lessonId:66841075, button:'Перейти к уроку'},
  {gap:6, delayId:947737, delay:'6 дней от текущего момента, без ожидания дня и часа', mailBlock:947729, mailId:940289, openBlock:947721, lessonId:64223303, button:'Перейти к уроку'},
  {gap:3, delayId:11911792, delay:'3 дня от текущего момента, без ожидания дня и часа', mailBlock:11911793, mailId:6583380, openBlock:11911794, lessonId:231191876, button:'Перейти к практике...'},
];

const TITLES = {
  52051538: 'Урок 1: Любовь божественная и любовь человеческая',
  55462527: 'Урок 2: Оживление грудной клетки',
  55462529: 'Урок 3: Сердце как исцеляющий философский камень',
  55840799: 'Урок 4: Пранаяма гармонизации анахаты',
  55840800: 'Урок 5: Полюбите свою игру',
  55841059: 'Урок 6: Асаны на проработку грудного отдела позвоночника',
  55841063: 'Урок 7: Гармонизация родовой истории',
  55841067: 'Урок 8: Пранаяма для очищения эмоциональной сферы',
  55841070: 'Урок 9: Мужские и женские чакры, тантра',
  55841073: 'Урок 10: Асаны на проработку плечевого пояса',
  55841076: 'Урок 11: Рыхлость и ригидность чакр. Пранаяма на разлепливание чакр.',
  55841080: 'Урок 12: Пранаяма и медитация на расширение поля анахаты',
  55841089: 'Урок 13: Прошлые жизни и параллельные вселенные',
  55841090: 'Урок 14: Продвинутая практика асан',
  55841094: 'Урок 15: Динамическая пранаяма',
  55841100: 'Урок 16: Законы Анахаты',
  66841075: 'Доп. урок: Как научиться медитировать',
  64223303: 'Урок 17: Ещё одна пранаяма',
  231191876: 'Урок 18: Практика исполнения желаний',
};

function dayWord(n) {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return 'день';
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return 'дня';
  return 'дней';
}
function pad(n) { return String(n).padStart(2, '0'); }
function isName(s) { return s.trim() === 'Сергей Замковой'; }
function blankKind(p) {
  if (p.trim()) return null;
  if (/[ ]/.test(p) && !p.includes('\n')) return 'space';
  return 'empty';
}
function renderParas(paras) {
  const items = paras.map(p => p.replace(/\u00a0/g, ' '));
  while (items.length && blankKind(items.at(-1))) items.pop();
  while (items.length && blankKind(items[0]) === 'empty') items.shift();
  let md = '';
  const ensureNl = () => { if (md && !md.endsWith('\n')) md += '\n'; };
  for (let i = 0; i < items.length; i++) {
    const p = items[i];
    const kind = blankKind(p);
    if (kind === 'space') { ensureNl(); md += ' \n'; continue; }
    if (kind === 'empty') { ensureNl(); md += '\n'; continue; }
    let lead = 0, trail = 0;
    const lm = p.match(/^\n+/); if (lm) lead = lm[0].length;
    if (!(items[i + 1] && isName(items[i + 1]))) {
      const tm = p.match(/\n+$/); if (tm) trail = tm[0].length;
    }
    const core = p.replace(/^\n+|\n+$/g, '');
    ensureNl();
    if (lead) md += '\n'.repeat(lead);
    md += core;
    if (trail) { md += '\n'; md += '\n'.repeat(trail); }
  }
  return md.replace(/^\n+/, '').replace(/\s+$/, '');
}
function invitation(i) {
  const word = ORD[i];
  return `Нажмите кнопку ниже, чтобы открыть ${word} урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».`;
}
function renderEmail(email, i) {
  const parts = email.parts;
  const chunks = [];
  let imageSeen = false;
  for (const part of parts) {
    if (part.type === 'image') {
      chunks.push(' ');
      chunks.push(`![фото письма](${part.src})`);
      chunks.push(' ');
      imageSeen = true;
      if (i !== 0) {
        chunks.push(invitation(i));
        chunks.push('');
      }
      continue;
    }
    let paras = part.paras.slice();
    if (i === 0) {
      paras = paras.map(p => /Нажмите кнопку,\s*чтобы его\s*посмотреть/.test(p) ? invitation(0) : p);
    }
    const text = renderParas(paras);
    if (text) chunks.push(text);
  }
  if (!imageSeen) throw new Error('Нет фото в письме ' + (i + 1));
  return chunks.join('\n').replace(/(вкладке «День»\.)\n(?!\n)/, '$1\n\n');
}
function stripYouTube(paras) {
  const out = [];
  for (let i = 0; i < paras.length; i++) {
    const t = paras[i];
    if (/лучшем качестве/i.test(t) || /покрашен лоб|видео\s*блог/i.test(t)) {
      while (i + 1 < paras.length) {
        const n = paras[i + 1];
        if (!n.trim() || /youtu(\.be|be\.com)/i.test(n) || /^https?:\/\//i.test(n.trim())) { i++; continue; }
        break;
      }
      continue;
    }
    if (/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)/i.test(t.trim())) continue;
    out.push(t);
  }
  return out;
}
function renderLesson(lesson, index) {
  const blocks = [];
  for (const block of lesson.blocks) {
    if (block.type === 'video') {
      blocks.push(`**Видео:** https://player.vimeo.com/video/${block.vimeo}`);
      continue;
    }
    if (block.type === 'image') continue;
    let paras = stripYouTube(block.paras);
    if (lesson.id === 55841100) {
      const at = paras.findIndex(p => /благодарственных писем/.test(p));
      if (at >= 0) paras = paras.slice(0, at + 1);
    }
    if (lesson.id === 231191876) {
      paras = paras.map(p => /две другие практики исполнения желаний/.test(p)
        ? 'Получить две другие практики исполнения желаний вы можете, перейдя по ссылке - https://zamkovoi.ru/3z2/'
        : p);
    }
    const text = renderParas(paras);
    if (text) blocks.push(text);
  }
  return blocks.join('\n\n');
}

let day = 0;
const rows = META.map((m, i) => {
  if (i) day += m.gap;
  const lesson = lessons.find(x => x.id === m.lessonId);
  const title = TITLES[m.lessonId];
  return {i, day, title, short: title.replace(/^Урок \d+: |^Доп\. урок: /, '').slice(0, 48)};
});

const lines = [];
lines.push('# Планета любви — программа для авторской проверки');
lines.push('');
lines.push('**Код курса:** planet-love');
lines.push('**Название курса:** Планета любви');
lines.push('**Тип:** course');
lines.push('**Доступ после последнего урока:** уточнить');
lines.push('**Показ последнего урока:** 3 дня');
lines.push('**Вебинарный пропуск после последнего урока:** 5 дней');
lines.push('**Шапка писем:** content/courses/assets/planet-love-email.png');
lines.push('**Размер шапки:** 600×382');
lines.push('');
lines.push('Исходная воронка: [Планета Любви, процесс 76024](https://sergei.zamkovoi.ru/pl/tasks/mission/process?id=76024). Сверка: 24 ноября 2026. Этап А, до авторской правки.');
lines.push('');
lines.push('19 учебных материалов и **19 писем** (по письму на каждый материал). Отдельного завершающего письма без урока нет. В нумерации GetCourse это уроки 1–16, затем дополнительный урок о медитации, затем уроки 17 и 18. Группы «Йога_4» и «Йога_4_прошли» на сроки не влияют и в программу не входят. Изолированный блок «Приветствие на курсе» (рассылка 914951) ни с чем не соединён и не отправляется.');
lines.push('');
lines.push('Пауза перед первым уроком в GetCourse — **1 минута**. По вашему указанию урок и письмо открываются сразу после покупки, не через минуту. Дальше уроки открываются в местную полночь, письма уходят в 07:00 того же дня. Перед вторым уроком интервал **1 день**: покупка до 18:00 — ближайшая полночь, покупка в 18:00 или позже — следующая полночь. Остальные интервалы считаются от предыдущего материала и не сдвигаются. Дни в таблице — если покупка до 18:00. Последний материал тогда на D35.');
lines.push('');
lines.push('В каждом письме GetCourse сверху стоит прежняя шапка. В тело письма она не копируется: шапка одна на весь курс, файл выше, по центру, 600×382. Внутри письма, на своём месте, остаётся фотография. Перед ней и после неё — строка, в которой один пробел: так в письме остаётся отступ. Кнопка во всех письмах — заливка #199c68. Подпись «Перейти к уроку», в письме практики исполнения желаний — «Перейти к практике...». Фраза про кнопку есть только в первом письме; в остальных кнопка стояла без неё. На её место поставлено принятое приглашение. Подпись «Сергей Замковой» перенесена на следующую строку, без пустой строки перед именем.');
lines.push('');
lines.push('Фразы «в лучшем качестве это видео вы можете посмотреть в Ютубе» и ссылки под ними в уроки не входят. В уроке 7 убраны также фраза про покрашенный лоб и ссылка на видеоблог.');
lines.push('');
lines.push('| № | Тип | Интервал после предыдущего | День | Название | Письмо |');
lines.push('|---|---|---|---|---|---|');
for (const row of rows) {
  const m = META[row.i];
  const kind = row.i === 16 ? 'Доп. урок' : 'Урок';
  const gap = row.i === 0 ? 'Сразу' : `${m.gap} ${dayWord(m.gap)}`;
  lines.push(`| ${pad(row.i + 1)} | ${kind} | ${gap} | D${row.day} | ${row.short} | Да |`);
}
lines.push('');
lines.push('---');
lines.push('');

for (let i = 0; i < META.length; i++) {
  const m = META[i];
  const email = emails.find(x => x.id === m.mailId);
  const lesson = lessons.find(x => x.id === m.lessonId);
  if (!email) throw new Error('Нет письма ' + m.mailId);
  if (!lesson) throw new Error('Нет урока ' + m.lessonId);
  const title = TITLES[m.lessonId];
  const when = i === 0 ? 'сразу' : `через ${m.gap} ${dayWord(m.gap)}`;
  lines.push(`## ${pad(i + 1)}. ${title}`);
  lines.push('');
  lines.push(`**Когда открывается:** ${when}`);
  lines.push('');
  lines.push('### Письмо');
  lines.push('');
  lines.push(`**Тема:** ${email.subject}`);
  lines.push('');
  lines.push(renderEmail(email, i));
  lines.push('');
  if (i === 0) {
    lines.push('> **Для вашей правки:** В письме остались недельная сетка «4 урока в неделю», отправка «в то же время, что это письмо», «день 2 — завтра» и 4 субботних вебинара. В Гармонизаторе первый урок открывается сразу, остальные в местную полночь, письма уходят в 07:00. Если покупка в 18:00 или позже, второй урок открывается не в ближайшую полночь, а в следующую. Текст не переписывал.');
    lines.push('');
  }
  if (i === 15) {
    lines.push('> **Для вашей правки:** После слов о намерении не забрасывать практику в письме идёт перечень других практикумов и курсов со ссылками. Оставлен как в письме.');
    lines.push('');
  }
  lines.push('### Урок');
  lines.push('');
  lines.push(`**Название страницы:** ${title}`);
  lines.push('');
  lines.push(renderLesson(lesson, i));
  lines.push('');
  if (m.lessonId === 55841100) {
    lines.push('> **Для вашей правки:** После задания про благодарственные письма на странице есть просьба прислать видеоотзыв. Этот фрагмент не перенесён. Под ним картинка https://fs-thb01.getcourse.ru/fileservice/file/thumbnail/h/89202f0165f7dd69315c5c9b3a37f0fa.jpg/s/f1200x/a/20752/sc/149 . В урок её не вставил: страница урока в Гармонизаторе показывает текст и видео. Если картинка нужна, скажите.');
    lines.push('');
  }
  lines.push('### Источники переноса');
  lines.push('');
  lines.push(`- Письмо: [${m.mailId}](https://sergei.zamkovoi.ru/notifications/control/mailings/update/id/${m.mailId}) (блок ${m.mailBlock})`);
  lines.push(`- Урок: [${m.lessonId}](https://sergei.zamkovoi.ru/teach/control/lesson/view/id/${m.lessonId}) (выдача ${m.openBlock})`);
  lines.push(`- Пауза перед выдачей: блок ${m.delayId}, ${m.delay}.`);
  lines.push(`- Кнопка письма: «${m.button}», заливка #199c68.`);
  lines.push('');
  lines.push('---');
  lines.push('');
}

lines.push('## Что проверить');
lines.push('');
lines.push('- Срок доступа после последнего урока в воронке не задан. В письмах он тоже не назван. Для предыдущих курсов йоги вы подтверждали 90 дней. Здесь поле оставлено пустым по смыслу: в шапке стоит «уточнить». Напишите число, и я подставлю его перед внедрением.');
lines.push('- Дополнительный урок «Как научиться медитировать» стоит в воронке между уроком 16 и уроком 17: через 1 день после 16-го, затем через 6 дней урок 17 и через 3 дня урок 18. Вы описали его как ещё один «семнадцатый» («После заключительного урока»). Я включил его отдельным материалом, а «Прошла неделя» оставил уроком 17. Если дополнительный урок не нужен в программе, напишите.');
lines.push('- Перед фотографией в письме и после неё стоит строка с одним пробелом. При внедрении отступ нужно сохранить: сейчас генератор писем добавляет такую строку автоматически только у курса «Осуществи мечту».');
lines.push('- Лендинг в программу не ставил.');
lines.push('');

writeFileSync(new URL('./planet-love.review.md', import.meta.url), lines.join('\n'));
console.log('materials', META.length, 'emails', emails.length, 'lessons', lessons.length);
