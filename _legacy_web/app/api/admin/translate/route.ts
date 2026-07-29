import { generateGeminiJson, getModelByHint } from "../../_utils/gemini";
import { LANGUAGE_NAMES, type AppContentLocale } from "../../_utils/contentLocales";
import { errorResponse, json, requireAdmin } from "../../_utils/supabase";

export const runtime = "nodejs";
/** Multi-locale post translate can take several LLM rounds. */
export const maxDuration = 180;

const STORY_TARGET_LOCALES = ["en", "de", "fr", "it", "es", "pt", "nl"] as const;
const POST_LOCALES = ["ru", "en", "de", "fr", "it", "es", "pt", "nl"] as const;
type StoryTargetLocale = (typeof STORY_TARGET_LOCALES)[number];
type PostLocale = (typeof POST_LOCALES)[number];

/** Chunk size keeps each Gemini call under typical timeout for long bodies. */
const POST_TRANSLATE_CHUNK = 3;
const POST_TRANSLATE_TIMEOUT_MS = 90_000;

type TranslatePayload =
  | { type: "story"; ru_caption: string }
  | {
      type: "post";
      /** @deprecated prefer source_title + source_locale */
      ru_title?: string;
      ru_body?: string;
      source_locale?: AppContentLocale;
      source_title?: string;
      source_body?: string;
      /** Locales to fill (may include ru). Default = all except source. */
      fill_locales?: PostLocale[];
    };

type StoryTranslations = Record<StoryTargetLocale, string>;
type PostTranslations = Record<string, { title: string; body: string }>;

function buildStoryPrompt(ruCaption: string): string {
  const langList = STORY_TARGET_LOCALES.map((l) => `"${l}": "${LANGUAGE_NAMES[l]}"`).join(", ");
  return `You are a professional translator. Translate the following Russian story caption into 7 languages.
Return ONLY a valid JSON object with locale codes as keys. No markdown, no explanation.

Russian caption:
${ruCaption}

Required JSON format (keys: ${STORY_TARGET_LOCALES.join(", ")}):
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

function buildPostPrompt(
  sourceLocale: AppContentLocale,
  sourceTitle: string,
  sourceBody: string,
  fillLocales: readonly PostLocale[],
): string {
  const sourceName = LANGUAGE_NAMES[sourceLocale];
  const langList = fillLocales.map((l) => `"${l}": "${LANGUAGE_NAMES[l]}"`).join(", ");
  const keys = fillLocales.join(", ");
  const example = fillLocales.map((l) => `  "${l}": { "title": "...", "body": "..." }`).join(",\n");
  return `You are a professional translator. Translate the following video publication (title + body) from ${sourceName} into the listed languages.
Return ONLY a valid JSON object. No markdown, no explanation.

Source language: ${sourceName}
Title: ${sourceTitle}

Body:
${sourceBody}

Required JSON format (keys: ${keys}):
{
${example}
}

Languages: ${langList}
Preserve line breaks (\\n) and URL formatting. Keep it natural and idiomatic.`;
}

function validateStoryTranslations(raw: unknown): StoryTranslations {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid translation response: expected object");
  }
  const result = {} as StoryTranslations;
  for (const locale of STORY_TARGET_LOCALES) {
    const val = (raw as Record<string, unknown>)[locale];
    result[locale] = typeof val === "string" ? val.trim() : "";
  }
  return result;
}

function validatePostTranslations(raw: unknown, fillLocales: readonly PostLocale[]): PostTranslations {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid translation response: expected object");
  }
  const result: PostTranslations = {};
  for (const locale of fillLocales) {
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

function resolvePostFillLocales(
  sourceLocale: AppContentLocale,
  requested: PostLocale[] | undefined,
): PostLocale[] {
  const base = (
    requested?.length
      ? requested.filter((l): l is PostLocale => (POST_LOCALES as readonly string[]).includes(l))
      : [...POST_LOCALES]
  ).filter((l) => l !== sourceLocale);
  // Non-RU source must never fill Russian (product rule for video translate).
  if (sourceLocale === "ru") return base;
  return base.filter((l) => l !== "ru");
}

async function translatePostInChunks(
  sourceLocale: AppContentLocale,
  sourceTitle: string,
  sourceBody: string,
  fillLocales: readonly PostLocale[],
  model: string,
): Promise<PostTranslations> {
  const merged: PostTranslations = {};
  for (let i = 0; i < fillLocales.length; i += POST_TRANSLATE_CHUNK) {
    const chunk = fillLocales.slice(i, i + POST_TRANSLATE_CHUNK);
    const { json: raw } = await generateGeminiJson<unknown>({
      prompt: buildPostPrompt(sourceLocale, sourceTitle, sourceBody, chunk),
      model,
      temperature: 0.3,
      maxOutputTokens: 8000,
      timeoutMs: POST_TRANSLATE_TIMEOUT_MS,
    });
    Object.assign(merged, validatePostTranslations(raw, chunk));
  }
  return merged;
}

/** POST /api/admin/translate — story caption or post title+body into target locales. */
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
        timeoutMs: POST_TRANSLATE_TIMEOUT_MS,
      });
      const translations = validateStoryTranslations(raw);
      return json({ translations });
    }

    if (payload.type === "post") {
      const sourceTitle = (payload.source_title ?? payload.ru_title ?? "").trim();
      const sourceBody = (payload.source_body ?? payload.ru_body ?? "").trim();
      const sourceLocale = (payload.source_locale ?? "ru") as AppContentLocale;
      if (!sourceTitle) {
        return json({ error: "Заголовок для перевода обязателен" }, { status: 400 });
      }

      const fillLocales = resolvePostFillLocales(sourceLocale, payload.fill_locales);
      if (fillLocales.length === 0) {
        return json({ translations: {} as PostTranslations });
      }

      const translations = await translatePostInChunks(
        sourceLocale,
        sourceTitle,
        sourceBody,
        fillLocales,
        model,
      );
      return json({ translations });
    }

    return json({ error: "Неизвестный type — ожидается story или post" }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
