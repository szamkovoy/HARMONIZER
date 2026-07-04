import { generateGeminiText, getModelByHint } from "@legacy/app/api/_utils/gemini";
import { reportRouteError } from "@legacy/app/api/_utils/monitoring";
import { languageNameFor, resolveResponseLocale } from "@legacy/app/api/_utils/contentLocales";
import {
  createServiceSupabase,
  errorResponse,
  json,
  requireUserId,
} from "@legacy/app/api/_utils/supabase";

export const runtime = "nodejs";

type InterpretationRequestBody = {
  outcome?: Record<string, unknown> | null;
  responseLocale?: string | null;
};

function buildPrompt(input: {
  outcome: Record<string, unknown>;
  languageName: string;
}): string {
  return [
    `OUTPUT LANGUAGE: ${input.languageName}.`,
    `Write the entire answer in ${input.languageName}.`,
    "",
    "You are an empathetic HARMONIZER breathing-practice mentor interpreting one completed session for a woman aged 35–60.",
    "Your goal is to encourage her and gently motivate continued practice — the text should feel warm, hopeful, and supportive.",
    "Use only the supplied JSON. Do not invent metrics, symptoms, or causal claims.",
    "If seriesInsights are present, use ONLY the metrics that appear in seriesInsights. Compare start/mid/end averages and mention at most 1–2 clear POSITIVE or NEUTRAL dynamics. Do NOT mention, reference, or speculate about any metric that is absent from seriesInsights — if a metric is missing from seriesInsights it was intentionally excluded and you must not read its value from elsewhere in the payload.",
    "If hybrid.start and hybrid.end are present, briefly compare how the state changed from the beginning to the end, only when supported by the numbers.",
    "Do not turn every metric into a mini-report. Prefer one concise takeaway over listing all ranges.",
    "If detailed biometrics are missing, hidden, or null, say that clearly and avoid pretending that HRV/coherence/RSA were measured.",
    "If this looks like camera guidance-only mode, explain that the rhythm could still guide breathing but advanced biometrics were unavailable in this session.",
    "NEVER claim or imply that the user is a beginner, that this is a new technique for them, or that they are 'first learning' the practice. You do not know their experience level.",
    "Keep the tone calm, warm, and grounded. No diagnosis, no treatment advice, no headings, no bullet list, no markdown.",
    "Reply in 4–7 sentences, ideally split into 2 short paragraphs.",
    "",
    "Practice result payload:",
    JSON.stringify(input.outcome, null, 2),
  ].join("\n");
}

export async function POST(req: Request) {
  const db = createServiceSupabase();
  let userId: string | null = null;
  try {
    userId = await requireUserId(req);
    const body = (await req.json()) as InterpretationRequestBody;
    const outcome = body?.outcome;
    if (!outcome || typeof outcome !== "object" || Array.isArray(outcome)) {
      return json({ error: "Invalid outcome payload." }, { status: 400 });
    }

    const { data: userRow } = await db
      .from("users")
      .select("locale")
      .eq("id", userId)
      .maybeSingle();
    const locale = resolveResponseLocale(userRow?.locale ?? null, body?.responseLocale);
    const languageName = languageNameFor(locale);
    const model = getModelByHint("standard");
    const prompt = buildPrompt({
      outcome,
      languageName,
    });

    const { text, modelUsed } = await generateGeminiText({
      model,
      temperature: 0.4,
      maxOutputTokens: 420,
      prompt,
    });

    const trimmed = text.trim();
    if (!trimmed) {
      return json({ error: "Empty interpretation text from model." }, { status: 502 });
    }

    return json({
      text: trimmed,
      modelUsed,
      responseLocale: locale,
    });
  } catch (error) {
    await reportRouteError(error, {
      db,
      endpoint: "communicator/v2/practice-interpretation",
      userId,
      payload: { feature: "breath_practice_interpretation" },
    });
    return errorResponse(error);
  }
}
