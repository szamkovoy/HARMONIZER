import { generateGeminiJson, getModelByHint } from "../../_utils/gemini";
import { errorResponse, json, requireAdmin } from "../../_utils/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

const TARGET_LOCALES = ["en", "de", "fr", "it", "es", "pt", "nl"] as const;
type TargetLocale = (typeof TARGET_LOCALES)[number];

const LANGUAGE_NAMES: Record<TargetLocale, string> = {
  en: "English",
  de: "German",
  fr: "French",
  it: "Italian",
  es: "Spanish",
  pt: "Portuguese",
  nl: "Dutch",
};

type TranslatePayload =
  | { type: "story"; ru_caption: string }
  | { type: "post"; ru_title: string; ru_body: string };

type StoryTranslations = Record<TargetLocale, string>;
type PostTranslations = Record<TargetLocale, { title: string; body: string }>;

function buildStoryPrompt(ruCaption: string): string {
  const langList = TARGET_LOCALES.map((l) => `"${l}": "${LANGUAGE_NAMES[l]}"`).join(", ");
  return `You are a professional translator. Translate the following Russian story caption into 7 languages.
Return ONLY a valid JSON object with locale codes as keys. No markdown, no explanation.

Russian caption:
${ruCaption}

Required JSON format (keys: ${TARGET_LOCALES.join(", ")}):
{
  "en": "...",
  "de": "...",
  "fr": "...",
  "it": "...",
  "es": "...",
  "pt": "...",
  "nl": "..."
}

Languages: ${langList}
Preserve line breaks (\\n) and URL formatting. Keep it natural and idiomatic.`;
}

function buildPostPrompt(ruTitle: string, ruBody: string): string {
  const langList = TARGET_LOCALES.map((l) => `"${l}": "${LANGUAGE_NAMES[l]}"`).join(", ");
  return `You are a professional translator. Translate the following Russian publication (title + body) into 7 languages.
Return ONLY a valid JSON object. No markdown, no explanation.

Russian title: ${ruTitle}

Russian body:
${ruBody}

Required JSON format (keys: ${TARGET_LOCALES.join(", ")}):
{
  "en": { "title": "...", "body": "..." },
  "de": { "title": "...", "body": "..." },
  "fr": { "title": "...", "body": "..." },
  "it": { "title": "...", "body": "..." },
  "es": { "title": "...", "body": "..." },
  "pt": { "title": "...", "body": "..." },
  "nl": { "title": "...", "body": "..." }
}

Languages: ${langList}
Preserve line breaks (\\n) and URL formatting. Keep it natural and idiomatic.`;
}

function validateStoryTranslations(raw: unknown): StoryTranslations {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid translation response: expected object");
  }
  const result = {} as StoryTranslations;
  for (const locale of TARGET_LOCALES) {
    const val = (raw as Record<string, unknown>)[locale];
    result[locale] = typeof val === "string" ? val.trim() : "";
  }
  return result;
}

function validatePostTranslations(raw: unknown): PostTranslations {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid translation response: expected object");
  }
  const result = {} as PostTranslations;
  for (const locale of TARGET_LOCALES) {
    const val = (raw as Record<string, unknown>)[locale];
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const v = val as Record<string, unknown>;
      result[locale] = {
        title: typeof v.title === "string" ? v.title.trim() : "",
        body: typeof v.body === "string" ? v.body.trim() : "",
      };
    } else {
      result[locale] = { title: "", body: "" };
    }
  }
  return result;
}

/** POST /api/admin/translate — translate story caption or post (title+body) into all 7 target locales. */
export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const payload = (await req.json()) as TranslatePayload;
    const model = getModelByHint("premium");

    if (payload.type === "story") {
      const { ru_caption } = payload;
      if (!ru_caption?.trim()) {
        return json({ error: "ru_caption обязателен" }, { status: 400 });
      }

      const { json: raw } = await generateGeminiJson<unknown>({
        prompt: buildStoryPrompt(ru_caption.trim()),
        model,
        temperature: 0.3,
        maxOutputTokens: 4000,
      });
      const translations = validateStoryTranslations(raw);
      return json({ translations });
    }

    if (payload.type === "post") {
      const { ru_title, ru_body } = payload;
      if (!ru_title?.trim()) {
        return json({ error: "ru_title обязателен" }, { status: 400 });
      }

      const { json: raw } = await generateGeminiJson<unknown>({
        prompt: buildPostPrompt(ru_title.trim(), (ru_body ?? "").trim()),
        model,
        temperature: 0.3,
        maxOutputTokens: 16000,
      });
      const translations = validatePostTranslations(raw);
      return json({ translations });
    }

    return json({ error: "Неизвестный type — ожидается story или post" }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
