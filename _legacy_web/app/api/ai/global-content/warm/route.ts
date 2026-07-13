import { after } from "next/server";

import { createServiceSupabase, errorResponse, json } from "../../../_utils/supabase";
import {
  ensureGlobalDailyContentRow,
  getExpectedGlobalDailyContentModel,
  globalContentNeedsRefresh,
  writeStructuralGlobalRow,
} from "../../../_utils/ensureGlobalDailyContent";

export const runtime = "nodejs";
/** Up to 3 dates × (LLM + i18n). */
export const maxDuration = 300;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function assertCronSecret(req: Request): Response | null {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) {
    return json({ error: "CRON_SECRET is required" }, { status: 500 });
  }
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const header = req.headers.get("x-cron-secret");
  if (bearer === expected || header === expected) return null;
  return json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * Cron/Node warm for free-tier `global_daily_content`:
 * ensures real LLM RU texts + text_i18n for the requested UTC dates.
 * Called by Edge `precompute-global-recommendations` after structural upsert.
 */
export async function POST(req: Request) {
  const unauthorized = assertCronSecret(req);
  if (unauthorized) return unauthorized;

  try {
    const body = (await req.json().catch(() => ({}))) as { dates?: string[] };
    const now = new Date();
    const dates =
      Array.isArray(body.dates) && body.dates.length
        ? body.dates.map((d) => String(d).trim()).filter(Boolean)
        : [isoDate(addDays(now, -1)), isoDate(now), isoDate(addDays(now, 1))];

    // Acknowledge immediately so Edge cron is not killed mid-LLM. Work continues via `after()`.
    after(async () => {
      const db = createServiceSupabase();
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
          if (row && !globalContentNeedsRefresh(row, expectedModel)) {
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

    return json({ ok: true, accepted: dates, mode: "background" });
  } catch (error) {
    return errorResponse(error);
  }
}
