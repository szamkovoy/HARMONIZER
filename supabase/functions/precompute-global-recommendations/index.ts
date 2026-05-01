// @ts-nocheck
import { assertCronSecret, createServiceClient, isOptions, json } from "../_shared/supabase.ts";
import { buildGlobalMathLevel, computeGlobalDailyForecast } from "../_shared/dailyForecast.ts";

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function calcExpiresAt(forecastDateUtc: string): string {
  const date = new Date(`${forecastDateUtc}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  date.setUTCHours(14, 0, 0, 0);
  return date.toISOString();
}

function renderTemplate(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    const value = variables[key];
    return typeof value === "string" ? value : JSON.stringify(value ?? "");
  });
}

function getModelByHint(hint: string | null | undefined): string {
  const tier = hint?.trim().toLowerCase();
  const model = tier === "premium" ? Deno.env.get("AI_MODEL_PREMIUM")?.trim() : Deno.env.get("AI_MODEL_STANDARD")?.trim();
  if (!model) throw new Error(tier === "premium" ? "Missing AI_MODEL_PREMIUM" : "Missing AI_MODEL_STANDARD");
  return model;
}

async function generateGeminiJson(params: {
  prompt: string;
  modelHint: string | null | undefined;
  temperature: number | null | undefined;
  maxOutputTokens: number | null | undefined;
}) {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is required");
  const model = getModelByHint(params.modelHint);
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: params.prompt }] }],
      generationConfig: {
        temperature: params.temperature ?? 0.85,
        maxOutputTokens: params.maxOutputTokens ?? 2200,
        responseMimeType: "application/json",
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini failed: ${res.status} ${await res.text().catch(() => "")}`);
  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Gemini returned empty response");
  return {
    json: JSON.parse(raw),
    model,
    tokensUsed: data?.usageMetadata?.totalTokenCount ?? null,
  };
}

async function generateForDate(db: any, date: string) {
  const { data: existing, error: existingError } = await db
    .from("global_daily_content")
    .select("forecast_date_utc")
    .eq("forecast_date_utc", date)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return { date, status: "already_exists" };

  const forecast = computeGlobalDailyForecast(date);
  const { data: prompt, error: promptError } = await db
    .from("prompts")
    .select("template,model_hint,temperature,max_output_tokens")
    .eq("prompt_key", "global_morning_recommendation")
    .eq("is_active", true)
    .single();
  if (promptError) throw promptError;

  const llm = await generateGeminiJson({
    prompt: renderTemplate(prompt.template, {
      top_petals_json: JSON.stringify(forecast.top_petals, null, 2),
      aspects_json: JSON.stringify(forecast.aspects, null, 2),
    }),
    modelHint: prompt.model_hint,
    temperature: prompt.temperature,
    maxOutputTokens: prompt.max_output_tokens,
  });

  const { error: insertError } = await db.from("global_daily_content").insert({
    forecast_date_utc: date,
    planet_positions: forecast.planet_positions,
    primary_planet: forecast.primary_planet,
    primary_chakra_number: forecast.primary_chakra_number,
    primary_tone: forecast.primary_tone,
    top_petals: forecast.top_petals,
    slogan: llm.json.slogan,
    short_text: llm.json.short_text,
    long_explanation: llm.json.long_explanation,
    math_level: buildGlobalMathLevel(forecast),
    generated_at: new Date().toISOString(),
    llm_tokens_used: llm.tokensUsed,
    llm_model: llm.model,
    expires_at_utc: calcExpiresAt(date),
  });
  if (insertError) throw insertError;

  return { date, status: "generated" };
}

Deno.serve(async (req) => {
  if (isOptions(req)) return new Response("ok");
  const unauthorized = assertCronSecret(req);
  if (unauthorized) return unauthorized;

  try {
    const db = createServiceClient();
    const now = new Date();
    const dates = [isoDate(now), isoDate(addDays(now, 1))];
    const results = [];

    for (const date of dates) {
      try {
        results.push(await generateForDate(db, date));
      } catch (error) {
        console.error("[precompute-global-recommendations] date failed", date, error);
        results.push({ date, status: "error", error: error instanceof Error ? error.message : String(error) });
      }
    }

    await db.from("global_daily_content").delete().lt("expires_at_utc", new Date().toISOString());

    return json({
      ok: true,
      results,
      generatedCount: results.filter((item) => item.status === "generated").length,
    });
  } catch (error) {
    console.error("[precompute-global-recommendations]", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
});
