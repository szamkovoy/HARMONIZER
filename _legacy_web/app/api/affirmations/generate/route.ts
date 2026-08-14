import { generateGeminiText, getModelByHint } from "@legacy/app/api/_utils/gemini";
import { reportRouteError } from "@legacy/app/api/_utils/monitoring";
import { languageNameFor, resolveResponseLocale } from "@legacy/app/api/_utils/contentLocales";
import {
  createServiceSupabase,
  errorResponse,
  json,
  requireUserId,
} from "@legacy/app/api/_utils/supabase";
import {
  AFFIRMATION_REFINEMENT_PROMPT,
  AFFIRMATION_SYSTEM_PROMPT,
  parseAffirmationLines,
} from "./prompts";

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

function buildPrompt(input: {
  message: string;
  history: HistoryTurn[];
  userName: string | null;
  languageName: string;
}): string {
  const parts: string[] = [
    `OUTPUT LANGUAGE: ${input.languageName}.`,
    `Write every affirmation entirely in ${input.languageName}.`,
    "",
    AFFIRMATION_SYSTEM_PROMPT,
  ];
  if (input.userName) {
    parts.push("", `Имя пользователя (если уместно): ${input.userName}.`);
  }
  for (const turn of input.history) {
    parts.push("", `${turn.role === "user" ? "User" : "Assistant"}:`, turn.content);
  }
  parts.push("", "User:", input.message);
  if (input.history.length > 0) {
    parts.push("", AFFIRMATION_REFINEMENT_PROMPT);
  }
  return parts.join("\n");
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

    const model = getModelByHint("standard");
    const prompt = buildPrompt({
      message,
      history,
      userName,
      languageName,
    });

    const { text, modelUsed } = await generateGeminiText({
      model,
      temperature: 0.75,
      maxOutputTokens: 900,
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
