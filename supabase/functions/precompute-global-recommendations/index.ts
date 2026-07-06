// @ts-nocheck
import { resolveGeminiModelIdFromTierEnv } from "../_shared/geminiModelIds.ts";
import { generateGeminiJson } from "../_shared/llm.ts";
import { assertCronSecret, createServiceClient, isOptions, json } from "../_shared/supabase.ts";
import { buildGlobalMathLevel, computeGlobalDailyForecast, GLOBAL_MATH_SCHEMA_VERSION } from "../_shared/dailyForecast.ts";

const GLOBAL_LONG_SECTION_MARKERS = ["§1.", "§2.", "§3.", "§4.", "§5.", "§6."];
const GLOBAL_LONG_CHAKRA_PATTERNS = [
  /\bchakra(?:s)?\b/iu,
  /чакр/iu,
  /анахат|манипур|сахасрар|вишуд|аджн|свадх|муладхар/iu,
];

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

function normalizeLongExplanationSectionHeaders(text: string): string {
  return text.replace(/§\s*6\.?\s*ЗАКЛЮЧЕНИЕ\s+С\s+МОСТИКОМ/giu, "§6. ЗАКЛЮЧЕНИЕ");
}

function isCurrentGlobalLongExplanation(text: unknown): boolean {
  if (!hasRequiredText(text)) return false;
  const value = normalizeLongExplanationSectionHeaders(String(text));
  if (!GLOBAL_LONG_SECTION_MARKERS.every((marker) => value.includes(marker))) {
    return false;
  }
  return !GLOBAL_LONG_CHAKRA_PATTERNS.some((pattern) => pattern.test(value));
}

function contentNeedsRefresh(existing: any, expectedModel: string): boolean {
  if (!existing) return true;
  const existingModel = typeof existing.llm_model === "string" ? existing.llm_model.trim() : "";
  if (!existingModel || existingModel !== expectedModel) return true;
  if (!hasRequiredText(existing.slogan)) return true;
  if (!hasRequiredText(existing.short_text)) return true;
  if (!hasRequiredText(existing.long_explanation)) return true;
  if (!isCurrentGlobalLongExplanation(existing.long_explanation)) return true;
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
    backgroundRetryPrimary: true,
    logTag: "precompute-global-recommendations",
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
        logTag: "precompute-global-recommendations",
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
