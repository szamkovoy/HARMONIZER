// @ts-nocheck
import { resolveGeminiModelIdFromTierEnv } from "../_shared/geminiModelIds.ts";
import { assertCronSecret, createServiceClient, isOptions, json } from "../_shared/supabase.ts";
import { buildGlobalMathLevel, computeGlobalDailyForecast, GLOBAL_MATH_SCHEMA_VERSION } from "../_shared/dailyForecast.ts";

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

function hasRequiredText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function contentNeedsRefresh(existing: any, expectedModel: string): boolean {
  if (!existing) return true;
  const existingModel = typeof existing.llm_model === "string" ? existing.llm_model.trim() : "";
  if (!existingModel || existingModel !== expectedModel) return true;
  if (!hasRequiredText(existing.slogan)) return true;
  if (!hasRequiredText(existing.short_text)) return true;
  if (!hasRequiredText(existing.long_explanation)) return true;
  const structured = existing.math_level?.structured;
  if (!structured || structured.schema_version !== GLOBAL_MATH_SCHEMA_VERSION || structured.chart_mode !== "transit_only") {
    return true;
  }
  return false;
}

function renderTemplate(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    const value = variables[key];
    return typeof value === "string" ? value : JSON.stringify(value ?? "");
  });
}

async function generateGeminiJson(params: {
  prompt: string;
  modelHint: string | null | undefined;
  temperature: number | null | undefined;
  maxOutputTokens: number | null | undefined;
}) {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is required");
  const model = resolveGeminiModelIdFromTierEnv(params.modelHint);
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
  const { data: prompt, error: promptError } = await db
    .from("prompts")
    .select("template,model_hint,temperature,max_output_tokens")
    .eq("prompt_key", "global_morning_recommendation")
    .eq("is_active", true)
    .single();
  if (promptError) throw promptError;
  const expectedModel = resolveGeminiModelIdFromTierEnv(prompt.model_hint);

  const { data: existing, error: existingError } = await db
    .from("global_daily_content")
    .select("forecast_date_utc,llm_model,slogan,short_text,long_explanation,math_level")
    .eq("forecast_date_utc", date)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing && !contentNeedsRefresh(existing, expectedModel)) {
    return { date, status: "already_exists" };
  }

  const forecast = computeGlobalDailyForecast(date);
  const llm = await generateGeminiJson({
    prompt: renderTemplate(prompt.template, {
      top_petals_json: JSON.stringify(forecast.top_petals, null, 2),
      aspects_json: JSON.stringify(forecast.aspects, null, 2),
    }),
    modelHint: prompt.model_hint,
    temperature: prompt.temperature,
    maxOutputTokens: Math.max(prompt.max_output_tokens ?? 2200, 6144),
  });

  const row = {
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
    text_i18n: {} as Record<string, unknown>,
  };

  const TARGET_LOCALES = ["en", "de", "fr", "it", "es", "pt", "nl"];
  const LANGUAGE_NAMES: Record<string, string> = {
    en: "English",
    de: "German",
    fr: "French",
    it: "Italian",
    es: "Spanish",
    pt: "Portuguese",
    nl: "Dutch",
  };
  const ruTexts = {
    slogan: String(llm.json.slogan ?? ""),
    short_text: String(llm.json.short_text ?? ""),
    long_explanation: String(llm.json.long_explanation ?? ""),
  };
  const textI18n: Record<string, typeof ruTexts> = {};
  for (const locale of TARGET_LOCALES) {
    try {
      const tr = await generateGeminiJson({
        prompt: [
          `Translate the following daily forecast texts from Russian into ${LANGUAGE_NAMES[locale]}.`,
          "Preserve an empathetic mentor tone. Return JSON with keys slogan, short_text, long_explanation only.",
          JSON.stringify(ruTexts, null, 2),
        ].join("\n"),
        modelHint: "standard",
        temperature: 0.3,
        maxOutputTokens: 6144,
      });
      textI18n[locale] = {
        slogan: String(tr.json.slogan ?? ruTexts.slogan),
        short_text: String(tr.json.short_text ?? ruTexts.short_text),
        long_explanation: String(tr.json.long_explanation ?? ruTexts.long_explanation),
      };
    } catch (error) {
      console.error("[precompute-global-recommendations] translate failed", locale, error);
    }
  }
  row.text_i18n = textI18n;

  const { error: insertError } = await db.from("global_daily_content").upsert(row, {
    onConflict: "forecast_date_utc",
  });
  if (insertError) throw insertError;

  return { date, status: existing ? "refreshed" : "generated" };
}

Deno.serve(async (req) => {
  if (isOptions(req)) return new Response("ok");
  const unauthorized = assertCronSecret(req);
  if (unauthorized) return unauthorized;

  try {
    const db = createServiceClient();
    const now = new Date();
    const dates = [isoDate(addDays(now, -1)), isoDate(now), isoDate(addDays(now, 1))];
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
