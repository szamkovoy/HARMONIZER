/**
 * Builds content/courses/tantra-mystery.review.md from extracted JSON.
 * Input: content/courses/_tantra_mystery_extract.json (browser extraction)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const inPath = join(root, 'content/courses/_tantra_mystery_extract.json');
const outPath = join(root, 'content/courses/tantra-mystery.review.md');

const LESSON_TRIM = [
  { endAtVideo: 3, stopPhrase: 'Ниже в блоке "Задание"' },
  { endPhrase: 'в таком случае сделайте сколько хотите' },
  { endPhrase: 'И только когда он успокоится, переходи к следующей асане.', keepAfter: ['вебинар'] },
  { endPhrase: 'и повтори каждую асану дважды' },
  { endPhrase: 'Если они теряются, ты будешь создавать себе препятствия на пути развития.' },
  { endAtVideo: 4, stopPhrase: 'Задание' },
  { endPhrase: 'Не забудь предварительно выполнить суставную гимнастику и вращения тазом.' },
  { endAtVideo: 2 },
  { endAtVideo: 2 },
  { endPhrase: 'продемонстрированной мной в предыдущем уроке.' },
  { endPhrase: 'не забудь прокачиваться.' },
  { endPhrase: 'Поблагодари себя, и всех, кто тебе помогал на пути.' },
];

const GAPS = [0, 2, 2, 3, 2, 2, 3, 2, 2, 3, 2, 2];
const HOURS = ['1 мин (техн.)', '48 ч', '48 ч', '72 ч', '48 ч', '48 ч', '72 ч', '48 ч', '48 ч', '72 ч', '48 ч', '48 ч'];

function normalizeHeaderLine(text) {
  const t = text.trim();
  if (/^<b>[А-ЯЁA-Z0-9\s\-–—:]+<\/b>$/i.test(t.replace(/\s+/g, ' '))) {
    const inner = t.replace(/<\/?b>/gi, '').trim();
    if (inner === inner.toUpperCase() && /[А-ЯA-Z]/.test(inner)) return `**${inner}**`;
  }
  if (t === t.toUpperCase() && /[А-ЯA-Z]{3,}/.test(t) && t.length < 80) return `**${t}**`;
  return null;
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function includesFold(hay, needle) {
  return hay.toLowerCase().includes(needle.toLowerCase());
}

function nodesToMarkdown(nodes, lessonIndex) {
  const rule = LESSON_TRIM[lessonIndex];
  const out = [];
  let videoCount = 0;
  let tailVideoCount = 0;
  let stopped = false;
  let afterMain = false;
  const keepAfter = rule.keepAfter || [];

  for (const n of nodes) {
    if (stopped && !afterMain) {
      if (keepAfter.length && n.t === 'p') {
        const plain = stripHtml(n.html || n.txt || '');
        if (keepAfter.some((k) => plain.toLowerCase().startsWith(k.toLowerCase()))) afterMain = true;
      }
      if (!afterMain) continue;
    }

    if (n.t === 'v') {
      if (rule.endAtVideo && !afterMain && videoCount >= rule.endAtVideo) break;
      if (afterMain && tailVideoCount >= 1) break;
      videoCount += 1;
      if (afterMain) tailVideoCount += 1;
      if (out.length && out[out.length - 1] !== '') out.push('');
      out.push(`**Видео:** https://player.vimeo.com/video/${n.id}`);
      if (rule.endAtVideo && !afterMain && videoCount >= rule.endAtVideo) break;
      continue;
    }

    const plain = stripHtml(n.html || n.txt || '');
    if (!plain || /^Урок \d+$/.test(plain)) continue;
    if (/^(Предыдущий урок|Следующий урок|Введение|Недоступен)/.test(plain)) continue;
    if (/^Опишите свой опыт|^Опиши что нового|^Например, предлагаю вам следующие асаны/i.test(plain)) break;
    if (rule.stopPhrase && includesFold(plain, rule.stopPhrase)) break;
    if (/^Задание$/i.test(plain.trim())) break;

    const header = normalizeHeaderLine(n.html || plain);
    if (header) {
      const prevIsVideo = out.length > 0 && out[out.length - 1].startsWith('**Видео:**');
      if (out.length && (prevIsVideo || !out[out.length - 1].startsWith('**'))) out.push('');
      out.push(header);
      continue;
    }

    if (rule.endPhrase && includesFold(plain, rule.endPhrase)) {
      out.push(plain);
      stopped = true;
      if (!keepAfter.length) break;
      continue;
    }

    const isListContinuation =
      /^-\s/.test(plain) &&
      out.length &&
      (out[out.length - 1].startsWith('- ') || out[out.length - 1].startsWith('**ПАССИВНАЯ'));
    if (isListContinuation) {
      out.push(plain);
    } else if (/^- /.test(plain)) {
      out.push(plain);
    } else {
      if (out.length && !out[out.length - 1].startsWith('**') && !out[out.length - 1].startsWith('- ')) out.push('');
      out.push(plain);
    }
  }

  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .trim();
}

function cleanEmailText(text) {
  return text
    .replace(/\{имя\}|\[имя\]|\{\{name\}\}|\{first_name\}/gi, '{first_name}')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .map((l) => l.replace(/\s*Перейти к уроку\s*/gi, ' ').trim())
    .filter(
      (l) =>
        l &&
        !/^Посмотреть урок$/i.test(l) &&
        !/^Перейти к уроку$/i.test(l) &&
        !/^https?:\/\//i.test(l),
    )
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function adaptEmailText(text, lessonNum) {
  const ordinals = [
    'первый',
    'второй',
    'третий',
    'четвёртый',
    'пятый',
    'шестой',
    'седьмой',
    'восьмой',
    'девятый',
    'десятый',
    'одиннадцатый',
    'двенадцатый',
  ];
  const ord = ordinals[lessonNum - 1] || `${lessonNum}`;
  let body = cleanEmailText(text);

  const cta = `Нажмите кнопку ниже, чтобы открыть ${ord} урок в браузере, или посмотрите его в Гармонизаторе на вкладке «День».`;

  if (!body.includes('Гармонизаторе на вкладке')) {
    body = `${body}\n\n${cta}`;
  }
  return body;
}

function lessonTitleFromSubject(n, subject) {
  const m = subject.match(/Урок\s+\d+\s*-\s*(.+)/i);
  const name = m ? m[1].trim() : `Урок ${n}`;
  return `Урок ${n}: ${name}`;
}

function gapLabel(d) {
  if (d === 0) return 'сразу';
  const word = d === 1 ? 'день' : d >= 2 && d <= 4 ? 'дня' : 'дней';
  return `через ${d} ${word}`;
}

const data = JSON.parse(readFileSync(inPath, 'utf8'));

let day = 0;
const table = [];
for (let i = 0; i < 12; i++) {
  const gap = GAPS[i];
  if (i === 0) day = 0;
  else day += gap;
  table.push({
    n: i + 1,
    gap,
    day,
    title: lessonTitleFromSubject(i + 1, data.mailings[i].subject),
    hours: HOURS[i],
  });
}

let md = `# Тантра — мистерия взаимоотношений — программа для авторской проверки

**Код курса:** tantra-mystery
**Название курса:** Тантра - мистерия взаимоотношений
**Тип:** practicum
**Доступ после последнего урока:** уточнить у автора
**Показ последнего урока:** 3 дня
**Вебинарный пропуск после последнего урока:** 5 дней
**Шапка писем:** content/courses/assets/tantra-mystery-email.jpg
**Размер шапки:** 1000×371
**Лендинг:** https://zamkovoi.yoga/tantra12

Исходная воронка: [Тантра — мистерия взаимоотношений, процесс 24610](https://sergei.zamkovoi.ru/pl/tasks/mission/process?id=24610). Сверка: 23 ноября 2026. Этап А, до авторской правки.

12 учебных материалов и **12 писем** (по письму на каждый урок). Отдельного завершающего письма без урока в воронке нет. После урока 12 — операции с группами (не переносятся).

Паузы в GetCourse (от текущего момента): ${HOURS.join(', ')}. В Гармонизаторе для календаря: gap_days ${GAPS.join(', ')} → дни ${table.map((r) => 'D' + r.day).join(', ')}.

Кнопка писем в исходнике: заливка \`#24bd96\` (по поручению Сергея).

| № | Тип | Интервал (календарь) | Фактическая пауза GC | День | Название | Письмо |
|---|---|---|---|---|---|---|
${table.map((r) => `| ${String(r.n).padStart(2, '0')} | Урок | ${r.gap === 0 ? 'Сразу' : `+${r.gap} дн.`} | ${r.hours} | D${r.day} | ${r.title} | Да |`).join('\n')}

---

`;

for (let i = 0; i < 12; i++) {
  const L = data.lessons[i];
  const M = data.mailings[i];
  const n = i + 1;
  const fullTitle = lessonTitleFromSubject(n, M.subject);
  const gapLine = gapLabel(GAPS[i]);
  const lessonMd = nodesToMarkdown(L.nodes, i);
  const emailMd = adaptEmailText(M.text, n);

  md += `## ${String(n).padStart(2, '0')}. ${fullTitle}

**Когда открывается:** ${gapLine}

### Письмо

**Тема:** ${M.subject}

${emailMd}

### Урок

**Название страницы:** ${fullTitle}

${lessonMd}

### Источники переноса

- Письмо: [${M.id}](https://sergei.zamkovoi.ru/notifications/control/mailings/update/id/${M.id}) (блок ${M.blockId}). Кнопка \`#24bd96\`.
- Урок: [${L.id}](https://sergei.zamkovoi.ru/teach/control/lesson/view/id/${L.id}) (выдача ${L.accessBlockId}).
- Пауза: блок ${L.delayBlockId}, настройка: ${HOURS[i]}.

---

`;
}

md += `## Вопросы для авторской проверки

1. **Срок доступа после последнего урока** — в шапке оставлено «уточнить у автора»; для импорта нужно число дней (в письме 1 упоминается год после окончания — это не переносится буквально).
2. **Письма 1–12** — в текстах сохранены блоки про «4 недели / три урока в неделю» и «4 клубных вебинара»; в воронке фактически 12 уроков с паузами 48/72 ч. Нужна ли авторская правка этих абзацев?
3. **Урок 3** — проверьте фрагмент «ВЕБИНАР» и второе видео.
4. **Календарные gap_days** — GetCourse: 48/72 ч от момента выдачи; в таблице — 2/3 календарных дня для Гармонизатора (полночь / 07:00). Подтвердите.

## Исключено из переноса

- Операции добавления/удаления групп после урока 12.
- Формы заданий, комментарии учеников, блоки «Задание» ниже среза по инструкции Сергея.
`;

writeFileSync(outPath, md, 'utf8');
console.log('Wrote', outPath);