import type { SupabaseClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";

/**
 * Calendar YYYY-MM-DD in the user's IANA timezone for the given instant (default: now).
 */
export function todayLocalDate(timezone: string, at: Date = new Date()): string {
  const tz = timezone?.trim() || "UTC";
  return DateTime.fromJSDate(at, { zone: "utc" }).setZone(tz).toFormat("yyyy-MM-dd");
}

export async function getUserTimezone(db: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await db.from("users").select("tz").eq("id", userId).maybeSingle();
  if (error) throw error;
  const tz = data?.tz?.trim();
  return tz && tz.length > 0 ? tz : "UTC";
}
