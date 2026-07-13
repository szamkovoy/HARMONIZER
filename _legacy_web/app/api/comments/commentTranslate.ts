import { generateGeminiJson, getModelByHint } from "../_utils/gemini";
import { LANGUAGE_NAMES, type AppContentLocale } from "../_utils/contentLocales";
import { ALL_CONTENT_LOCALES } from "../../../../modules/i18n/localeCodes";

const COMMENT_LOCALES = ALL_CONTENT_LOCALES;

export function countPostTitleLocales(post: {
  title: string | null;
  title_i18n?: Record<string, string> | null;
}): number {
  let count = 0;
  if ((post.title ?? "").trim()) count += 1;
  for (const locale of COMMENT_LOCALES) {
    if (locale === "ru") continue;
    if ((post.title_i18n?.[locale] ?? "").trim()) count += 1;
  }
  return count;
}

function buildCommentPrompt(
  sourceLocale: AppContentLocale,
  sourceBody: string,
  fillLocales: readonly AppContentLocale[],
): string {
  const sourceName = LANGUAGE_NAMES[sourceLocale];
  const langList = fillLocales.map((l) => `"${l}": "${LANGUAGE_NAMES[l]}"`).join(", ");
  const keys = fillLocales.join(", ");
  const example = fillLocales.map((l) => `  "${l}": "..."`).join(",\n");
  return `You are a professional translator. Translate the following short user comment from ${sourceName} into the listed languages.
Return ONLY a valid JSON object with locale codes as keys and translated comment strings as values. No markdown, no explanation.

Source language: ${sourceName}
Comment:
${sourceBody}

Required JSON format (keys: ${keys}):
{
${example}
}

Languages: ${langList}
Keep the tone natural and idiomatic. Preserve URLs and line breaks.`;
}

/** Translate a comment into the given locales (one LLM call). */
export async function translateCommentBody(
  sourceLocale: AppContentLocale,
  sourceBody: string,
  fillLocales: readonly AppContentLocale[],
): Promise<Record<string, string>> {
  if (fillLocales.length === 0) return {};
  const model = getModelByHint("standard");
  const { json: raw } = await generateGeminiJson<unknown>({
    prompt: buildCommentPrompt(sourceLocale, sourceBody, fillLocales),
    model,
    temperature: 0.3,
    maxOutputTokens: 4000,
  });
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const locale of fillLocales) {
    const val = (raw as Record<string, unknown>)[locale];
    if (typeof val === "string" && val.trim()) out[locale] = val.trim();
  }
  return out;
}

export { COMMENT_LOCALES };
