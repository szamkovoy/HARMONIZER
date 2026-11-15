/**
 * Общее тело писем об оплате (отказ первой оплаты, отказ продления, конец 30 дней):
 * приветствие (с именем, если оно известно), строка «Вы оплачивали: …», текст,
 * кнопка и подпись автора. Отступы — пустыми абзацами: шаблон писем обнуляет margin у <p>,
 * а пустой абзац превращает в строку-разделитель.
 */
import { htmlToPlaintext } from "../_utils/marketingMail";
import type { PayPageCopy } from "./payPageCopy";
import { plainLetterToHtml } from "./widgetFulfillment";

const SPACER = "<p></p>";

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

/** Имя из формы или профиля: одна строка, без переносов, не длиннее 60 знаков. */
export function letterName(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
}

/** «Здравствуйте!» → «Здравствуйте, Сергей!»; приветствие без «!» в конце не трогаем. */
export function greetingWithName(greeting: string, name: string): string {
  if (!name) return greeting;
  const match = greeting.match(/^(.*?)(\s?!)$/);
  return match ? `${match[1]}, ${name}${match[2]}` : greeting;
}

export function buildPayLetterBody(params: {
  copy: PayPageCopy;
  /** Текст письма с уже подставленными {tier}/{date}; первый абзац — приветствие. */
  text: string;
  buttonLabel: string;
  buttonUrl: string;
  buttonColor: string;
  /** Имя получателя для приветствия. */
  name?: string | null;
  /** Название покупки в именительном падеже — строкой «Вы оплачивали: …» после приветствия. */
  product?: string | null;
}): { bodyHtml: string; text: string } {
  const paragraphs = params.text.replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
  const greeting = greetingWithName(paragraphs[0] ?? "", letterName(params.name));
  const product = (params.product ?? "").replace(/\s+/g, " ").trim();
  const productLine = product ? params.copy.paidForLine.replace("{product}", product) : "";
  const letterText = [greeting, productLine, ...paragraphs.slice(1)].filter(Boolean).join("\n\n");

  const button = `<p><a href="${escapeAttr(params.buttonUrl)}" style="display:inline-block;padding:12px 22px;background:${params.buttonColor};color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">${escapeText(params.buttonLabel)}</a></p>`;
  const letter = plainLetterToHtml(letterText);
  const signature = plainLetterToHtml(params.copy.letterSignature);
  const bodyHtml = [letter, SPACER, button, SPACER, signature].join("\n");
  const text = [htmlToPlaintext(letter), params.buttonUrl, htmlToPlaintext(signature)].join("\n\n");
  return { bodyHtml, text };
}
