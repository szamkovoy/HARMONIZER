/**
 * Общее тело писем об оплате (отказ первой оплаты, отказ продления, конец 30 дней):
 * текст, кнопка с отступами сверху и снизу, подпись автора.
 */
import { htmlToPlaintext } from "../_utils/marketingMail";
import type { PayPageCopy } from "./payPageCopy";
import { plainLetterToHtml } from "./widgetFulfillment";

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

export function buildPayLetterBody(params: {
  copy: PayPageCopy;
  /** Текст письма с уже подставленными {tier}/{date}. */
  text: string;
  buttonLabel: string;
  buttonUrl: string;
  buttonColor: string;
}): { bodyHtml: string; text: string } {
  const button = `<p style="margin:28px 0;"><a href="${escapeAttr(params.buttonUrl)}" style="display:inline-block;padding:12px 22px;background:${params.buttonColor};color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">${escapeText(params.buttonLabel)}</a></p>`;
  const letter = plainLetterToHtml(params.text);
  const signature = plainLetterToHtml(params.copy.letterSignature);
  const bodyHtml = [letter, button, signature].join("\n");
  const text = [htmlToPlaintext(letter), params.buttonUrl, htmlToPlaintext(signature)].join("\n\n");
  return { bodyHtml, text };
}
