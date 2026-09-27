import { after } from "next/server";

import { cronSecretDenied } from "../../_utils/emailCronIdle";
import { expectedModelFromHint, globalContentNeedsRefresh } from "../../_utils/globalContentFresh";

export const runtime = "nodejs";
/** Up to 3 dates × (LLM + i18n). Loaded only when a date is actually stale. */
export const maxDuration = 300;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

type FreshRow = Record<string, unknown> & { forecast_date_utc?: string };

/**
 * Cron/Node warm for free-tier `global_daily_content`.
 * Fresh dates return immediately and do not import the LLM stack.
 */
export async function POST(req: Request) {
  const denied = cronSecretDenied(req);
  if (denied) return denied;

  try {
    const body = (await req.json().catch(() => ({}))) as { dates?: string[] };
    const now = new Date();
    const dates =
      Array.isArray(body.dates) && body.dates.length
        ? body.dates.map((d) => String(d).trim()).filter(Boolean)
        : [isoDate(addDays(now, -1)), isoDate(now), isoDate(addDays(now, 1))];

    const { createServiceSupabase } = await import("../../_utils/supabase");
    const db = createServiceSupabase();
    const [{ data: promptRow, error: promptError }, { data: rows, error: rowsError }] = await Promise.all([
      db
        .from("prompts")
        .select("model_hint")
        .eq("prompt_key", "global_morning_recommendation")
        .eq("is_active", true)
        .maybeSingle(),
      db
        .from("global_daily_content")
        .select("forecast_date_utc, llm_model, slogan, short_text, long_explanation, math_level")
        .in("forecast_date_utc", dates),
    ]);
    if (promptError) throw promptError;
    if (rowsError) throw rowsError;

    const expected = expectedModelFromHint(
      (promptRow as { model_hint?: string | null } | null)?.model_hint,
    );
    const byDate = new Map(
      ((rows ?? []) as FreshRow[]).map((row) => [String(row.forecast_date_utc), row]),
    );
    const allFresh = Boolean(expected) && dates.every((date) => {
      const row = byDate.get(date);
      return Boolean(row) && !globalContentNeedsRefresh(row, expected as string);
    });
    if (allFresh) {
      return Response.json({ ok: true, skipped: "fresh", dates });
    }

    after(async () => {
      const {
        ensureGlobalDailyContentRow,
        getExpectedGlobalDailyContentModel,
        globalContentNeedsRefresh: needsRefresh,
        writeStructuralGlobalRow,
      } = await import("../../_utils/ensureGlobalDailyContent");
      const expectedModel = await getExpectedGlobalDailyContentModel(db);
      for (const date of dates) {
        try {
          const { data: existing, error } = await db
            .from("global_daily_content")
            .select("*")
            .eq("forecast_date_utc", date)
            .maybeSingle();
          if (error) throw error;

          if (!existing) {
            await writeStructuralGlobalRow(db, date);
          }

          const row = existing as Record<string, unknown> | null;
          if (row && !needsRefresh(row, expectedModel)) {
            console.info("[global-content/warm] fresh", date);
            continue;
          }

          await ensureGlobalDailyContentRow(db, date);
          console.info("[global-content/warm] warmed", date);
        } catch (dateError) {
          console.error("[global-content/warm] date failed", date, dateError);
        }
      }
    });

    return Response.json({ ok: true, accepted: dates, mode: "background" });
  } catch (error) {
    const { errorResponse } = await import("../../_utils/supabase");
    return errorResponse(error);
  }
}
