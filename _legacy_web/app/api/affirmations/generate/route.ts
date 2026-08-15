import { generateGeminiText, getModelByHint } from "@legacy/app/api/_utils/gemini";
import { reportRouteError } from "@legacy/app/api/_utils/monitoring";
import { languageNameFor, resolveResponseLocale } from "@legacy/app/api/_utils/contentLocales";
import { getActivePrompt, renderPrompt } from "@legacy/app/api/_utils/prompts";
import {
  createServiceSupabase,
  errorResponse,
  json,
  requireUserId,
} from "@legacy/app/api/_utils/supabase";
import {
  AFFIRMATION_GENERATE_PROMPT_KEY,
  AFFIRMATION_GENERATE_TEMPLATE,
  AFFIRMATION_REFINEMENT_PROMPT,
  AFFIRMATION_REFINEMENT_PROMPT_KEY,
  formatAffirmationHistoryBlock,
  parseAffirmationLines,
} from "../prompts";

export const runtime = "nodejs";

type HistoryTurn = {
  role: "user" | "assistant";
  content: string;
};

type GenerateBody = {
  message?: string;
  history?: HistoryTurn[];
  userName?: string | null;
  responseLocale?: string | null;
};

async function loadGenerateTemplate(
  db: ReturnType<typeof createServiceSupabase>,
): Promise<{
  template: string;
  modelHint: string | null;
  temperature: number;
  maxOutputTokens: number;
}> {
  try {
    const row = await getActivePrompt(db, AFFIRMATION_GENERATE_PROMPT_KEY);
    return {
      template: row.template,
      modelHint: row.model_hint,
      temperature: row.temperature ?? 0.75,
      maxOutputTokens: row.max_output_tokens ?? 900,
    };
  } catch {
    return {
      template: AFFIRMATION_GENERATE_TEMPLATE,
      modelHint: "standard",
      temperature: 0.75,
      maxOutputTokens: 900,
    };
  }
}

async function loadRefinementText(
  db: ReturnType<typeof createServiceSupabase>,
): Promise<string> {
  try {
    const row = await getActivePrompt(db, AFFIRMATION_REFINEMENT_PROMPT_KEY);
    return row.template.trim();
  } catch {
    return AFFIRMATION_REFINEMENT_PROMPT;
  }
}

export async function POST(req: Request) {
  const db = createServiceSupabase();
  let userId: string | null = null;
  try {
    userId = await requireUserId(req);
    const body = (await req.json()) as GenerateBody;
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message || message.length < 12) {
      return json({ error: "Нужен более подробный рассказ." }, { status: 400 });
    }
    if (message.length > 8000) {
      return json({ error: "Слишком длинный текст." }, { status: 400 });
    }

    const history = Array.isArray(body.history)
      ? body.history
          .filter(
            (t): t is HistoryTurn =>
              !!t &&
              (t.role === "user" || t.role === "assistant") &&
              typeof t.content === "string" &&
              t.content.trim().length > 0,
          )
          .slice(-8)
          .map((t) => ({ role: t.role, content: t.content.trim().slice(0, 6000) }))
      : [];

    const { data: userRow } = await db
      .from("users")
      .select("locale, display_name")
      .eq("id", userId)
      .maybeSingle();
    const locale = resolveResponseLocale(userRow?.locale ?? null, body?.responseLocale);
    const languageName = languageNameFor(locale);
    const userName =
      (typeof body.userName === "string" && body.userName.trim()) ||
      (typeof userRow?.display_name === "string" ? userRow.display_name.trim() : "") ||
      null;

    const gen = await loadGenerateTemplate(db);
    const refinementBlock =
      history.length > 0 ? await loadRefinementText(db) : "";

    const prompt = renderPrompt(gen.template, {
      language_name: languageName,
      user_name_block: userName
        ? `Имя пользователя (если уместно): ${userName}.`
        : "",
      history_block: formatAffirmationHistoryBlock(history),
      user_message: message,
      refinement_block: refinementBlock,
    });

    const model = getModelByHint(gen.modelHint ?? "standard");
    const { text, modelUsed } = await generateGeminiText({
      model,
      temperature: gen.temperature,
      maxOutputTokens: gen.maxOutputTokens,
      prompt,
    });

    const options = parseAffirmationLines(text);
    if (options.length < 3) {
      return json({ error: "Модель вернула слишком мало вариантов." }, { status: 502 });
    }

    return json({
      options,
      modelUsed,
      responseLocale: locale,
    });
  } catch (error) {
    await reportRouteError(error, {
      db,
      endpoint: "affirmations/generate",
      userId,
      payload: { feature: "affirmations_generate" },
    });
    return errorResponse(error);
  }
}
