#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const scrapePath = path.join(root, "content/courses/.yoga-health-scrape.json");
const outPath = path.join(root, "content/courses/yoga-health.review.md");

const { mailings, lessons } = JSON.parse(fs.readFileSync(scrapePath, "utf8"));

const GAP_DAYS = [1, 2, 1, 3, 1, 2, 1, 3, 1, 2, 1, 3, 1, 2, 1, 7, 3];
const LESSON_IDS = [
  41817529, 41817565, 41841901, 41920158, 42042358, 42049031, 42054149,
  42058305, 42064063, 42064093, 42133070, 42134533, 42515210, 42515211,
  42515212, 42515214, 44215106, 231186403,
];
const MAILING_IDS = [
  772509, 772546, 772631, 782283, 782290, 782293, 782297, 782301, 782309,
  783719, 783732, 783738, 783751, 783764, 783776, 783829, 783845, 6583391,
];
const BLOCK_MAILING = [
  677081, 752852, 752885, 764449, 764452, 764453, 764455, 764456, 764458,
  765947, 765948, 765949, 765950, 765951, 765952, 765953, 765954, 11911760,
];
const BLOCK_LESSON = [
  752707, 752709, 752711, 752714, 752716, 752719, 752721, 752722, 752723,
  752725, 752727, 752730, 752733, 752736, 752737, 752738, 765946, 11911761,
];
const DELAY_BLOCK = [
  null, 752854, 752888, 764462, 764463, 764464, 764466, 764468, 764469,
  765956, 765957, 765958, 765959, 765960, 765961, 765962, 918839, 11911757,
];

const schedule = Array.from({ length: 18 }, (_, i) => {
  let cumulative = 0;
  if (i > 0) for (let j = 0; j < i; j++) cumulative += GAP_DAYS[j];
  const when =
    i === 0
      ? "сразу"
      : `через ${GAP_DAYS[i - 1]} ${GAP_DAYS[i - 1] === 1 ? "день" : GAP_DAYS[i - 1] < 5 ? "дня" : "дней"}`;
  return { when, day: cumulative };
});

const lines = [];
lines.push("# Йога и здоровье — программа для авторской проверки");
lines.push("");
lines.push("**Код курса:** yoga-health");
lines.push("**Название курса:** Йога и здоровье");
lines.push("**Тип:** course");
lines.push("**Лендинг:** https://zamkovoi.yoga/yoga1/");
lines.push("**Доступ после последнего урока:** 90 дней");
lines.push("**Показ последнего урока:** 3 дня");
lines.push("**Вебинарный пропуск после последнего урока:** 5 дней");
lines.push(
  "**Шапка писем:** content/courses/assets/yoga-health-email.png (при внедрении — HTTPS URL email CDN)",
);
lines.push("**Размер шапки:** 600×228");
lines.push("");
lines.push(
  "Исходная воронка: [Йога и Здоровье, процесс 55462](https://sergei.zamkovoi.ru/pl/tasks/mission/process?id=55462). Сверка: 20 ноября 2026. Этап А; импорт и тест не запущены.",
);
lines.push("");
lines.push(
  "18 учебных материалов и **18 писем** (по письму на каждый урок). **Отдельного завершающего письма без урока нет** — курс заканчивается уроком 18 и письмом к нему; через 3 дня после открытия последнего урока карточка исчезает с «Дня», доступ сохраняется во «Профиле» 90 дней.",
);
lines.push("");
lines.push(
  "Письма: вместо кнопки GetCourse — фраза о вкладке «День» (с точкой в конце). Видео — **Vimeo**; уроки 1 и 5 без «Дополнительно». Абзацы и тайминги выверены по разметке страниц GetCourse.",
);
lines.push("");
lines.push("| № | Тип | Интервал после предыдущего | День | Название | Письмо |");
lines.push("|---|---|---|---|---|---|");
for (let i = 0; i < 18; i++) {
  const shortTitle = lessons[i].title.split(":").slice(1).join(":").trim() || lessons[i].title;
  const when =
    i === 0 ? "Сразу" : `${GAP_DAYS[i - 1]} ${GAP_DAYS[i - 1] === 1 ? "день" : GAP_DAYS[i - 1] < 5 ? "дня" : "дней"}`;
  lines.push(
    `| ${String(i + 1).padStart(2, "0")} | Урок | ${when} | D${schedule[i].day} | ${shortTitle.slice(0, 48)} | Да |`,
  );
}
lines.push("");
lines.push("---");
lines.push("");

for (let i = 0; i < 18; i++) {
  const n = String(i + 1).padStart(2, "0");
  const lesson = lessons[i];
  const mailing = mailings[i];
  lines.push(`## ${n}. ${lesson.title}`);
  lines.push("");
  lines.push(`**Когда открывается:** ${schedule[i].when}`);
  lines.push("");
  lines.push("### Письмо");
  lines.push("");
  lines.push(`**Тема:** ${mailing.subject}`);
  lines.push("");
  lines.push(mailing.text);
  if (i === 0) {
    lines.push("");
    lines.push(
      "> **Для вашей правки:** В исходнике — недельная сетка из 4×7 дней, письма со ссылкой на урок и 4 вебинара. Нужна адаптация под календарь D0…D35, открытие уроков в полночь и письма в 07:00.",
    );
    lines.push(
      "> **Для вашей правки:** Сохранён текст про вебинары GetCourse — проверьте формулировки под Гармонизатор.",
    );
  }
  lines.push("");
  lines.push("### Урок");
  lines.push("");
  lines.push(`**Название страницы:** ${lesson.title}`);
  lines.push("");
  lines.push(lesson.body);
  lines.push("");
  lines.push("### Источники переноса");
  lines.push("");
  const delay =
    i === 0
      ? "нет (урок и письмо сразу после покупки; в GetCourse письмо шло перед выдачей)"
      : `задержка idS ${DELAY_BLOCK[i]}: ${GAP_DAYS[i - 1]} дн., от текущего момента`;
  lines.push(
    `- Письмо: [${MAILING_IDS[i]}](https://sergei.zamkovoi.ru/notifications/control/mailings/update/id/${MAILING_IDS[i]}) (блок ${BLOCK_MAILING[i]})`,
  );
  lines.push(
    `- Урок: [${LESSON_IDS[i]}](https://sergei.zamkovoi.ru/teach/control/lesson/view/id/${LESSON_IDS[i]}) (выдача ${BLOCK_LESSON[i]})`,
  );
  lines.push(`- Интервал до открытия: ${delay}`);
  if (i === 16) {
    lines.push(
      "- Между уроками 16→17 в исходнике 7 дней (4 дня + перевод в группу «Йога_1_прошли» + 3 дня); группы в Гармонизатор не переносятся.",
    );
  }
  lines.push("");
  if (i < 17) {
    lines.push(
      `**До следующего материала:** ${GAP_DAYS[i]} ${GAP_DAYS[i] === 1 ? "день" : GAP_DAYS[i] < 5 ? "дня" : "дней"}.`,
    );
    lines.push("");
    lines.push("---");
    lines.push("");
  }
}

lines.push("## Вопросы и исключения");
lines.push("");
lines.push("- **Доступ 90 дней** — по вашему указанию.");
lines.push("- **Интервал 16→17 (7 дней)** сохранён по графу GetCourse.");
lines.push("- Рекламные ветки и изолированные блоки приветствия **не включены**.");
lines.push(
  "- Урок 17 в письме — «неделя после окончания» vs календарный D32; при правке согласуйте формулировку.",
);
lines.push("- Урок 18: ссылка https://zamkovoi.ru/3z2/ — проверьте актуальность.");

fs.writeFileSync(outPath, `${lines.join("\n")}\n`);
console.log("Wrote", outPath);