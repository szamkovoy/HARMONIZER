// @ts-nocheck
/**
 * Edge-cron прогрева global_daily_content.
 *
 * 1) Всегда пишет детерминированную structural-строку (планеты, лепестки, math_level)
 *    с fallback-текстами — чтобы cold-start Home никогда не ждал эфемериды.
 * 2) Затем дергает Node `POST /api/ai/global-content/warm` (CRON_SECRET), который
 *    генерирует настоящие LLM-тексты + text_i18n через тот же код, что и on-demand
 *    ensure (`ensureGlobalDailyContentRow`). Так промпт v6 / author voice остаются
 *    в одном Node-контуре, а утренний заход читает уже готовую строку.
 */
import { assertCronSecret, createServiceClient, isOptions, json } from "../_shared/supabase.ts";
import { buildGlobalMathLevel, computeGlobalDailyForecast } from "../_shared/dailyForecast.ts";

const GLOBAL_FALLBACK_SLOGAN = "День приглашает настроиться и двигаться в своём темпе.";
const GLOBAL_FALLBACK_SHORT_TEXT =
  "Сегодня полезно удерживать внимание на теле и дыхании, не форсируя решения.";
const GLOBAL_FALLBACK_LONG_EXPLANATION =
  "Транзитная картина дня собрана из положений семи классических планет; развёрнутый текст временно короткий — обновите экран позже.";

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

async function writeStructuralRowForDate(db: any, date: string) {
  const forecast = computeGlobalDailyForecast(date);
  const mathLevel = buildGlobalMathLevel(forecast);

  const row = {
    forecast_date_utc: date,
    planet_positions: forecast.planet_positions,
    primary_planet: forecast.primary_planet,
    primary_chakra_number: forecast.primary_chakra_number,
    primary_tone: forecast.primary_tone,
    top_petals: forecast.top_petals,
    slogan: GLOBAL_FALLBACK_SLOGAN,
    short_text: GLOBAL_FALLBACK_SHORT_TEXT,
    long_explanation: GLOBAL_FALLBACK_LONG_EXPLANATION,
    math_level: mathLevel,
    generated_at: new Date().toISOString(),
    llm_tokens_used: null as number | null,
    llm_model: null,
    expires_at_utc: calcExpiresAt(date),
  };

  // Do not overwrite a row that already has real LLM texts.
  const { data: existing } = await db
    .from("global_daily_content")
    .select("llm_model")
    .eq("forecast_date_utc", date)
    .maybeSingle();
  if (existing?.llm_model && String(existing.llm_model).trim()) {
    return { date, status: "kept_llm_row" };
  }

  const { error } = await db.from("global_daily_content").upsert(row, {
    onConflict: "forecast_date_utc",
  });
  if (error) throw error;

  return { date, status: "structural_written" };
}

async function warmViaNode(dates: string[]) {
  const appUrl = (Deno.env.get("HARMONIZER_APP_URL") ?? Deno.env.get("VERCEL_APP_URL") ?? "").replace(/\/$/, "");
  const cronSecret = Deno.env.get("CRON_SECRET")?.trim();
  if (!appUrl || !cronSecret) {
    return {
      status: "skipped",
      reason: !appUrl ? "missing_HARMONIZER_APP_URL" : "missing_CRON_SECRET",
    };
  }

  const controller = new AbortController();
  // Warm returns immediately (Node continues via after()); keep Edge wait short.
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`${appUrl}/api/ai/global-content/warm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cronSecret}`,
        "x-cron-secret": cronSecret,
      },
      body: JSON.stringify({ dates }),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.ok ? "warmed" : "warm_http_error", httpStatus: res.status, body };
  } catch (error) {
    return {
      status: "warm_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
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
        results.push(await writeStructuralRowForDate(db, date));
      } catch (error) {
        console.error("[precompute-global-recommendations] date failed", date, error);
        results.push({ date, status: "error", error: error instanceof Error ? error.message : String(error) });
      }
    }

    const warm = await warmViaNode(dates);
    if (warm.status === "skipped" || warm.status === "warm_failed" || warm.status === "warm_http_error") {
      console.error("[precompute-global-recommendations] warm not applied", warm);
    }

    await db.from("global_daily_content").delete().lt("expires_at_utc", new Date().toISOString());

    return json({
      ok: true,
      results,
      warm,
      note: "structural upsert + Node /api/ai/global-content/warm for LLM + text_i18n",
      warmOk: warm.status === "warmed",
    });
  } catch (error) {
    console.error("[precompute-global-recommendations]", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
});
