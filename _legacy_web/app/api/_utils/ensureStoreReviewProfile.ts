/**
 * Idempotent Master + onboarded profile for the store-review account.
 * Seeds fixed birth data only when the profile has no birth_date yet —
 * never overwrite reviewer edits (e.g. London) on later logins.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { computeNatalProfileWithAstronomia } from "../../../modules/astro-core";
import { nextVersionFor } from "./astro-db";

const REVIEW_BIRTH = {
  date: "1990-06-15",
  timeMode: "precise" as const,
  time: "12:00",
  location: {
    lat: 55.7558,
    lng: 37.6173,
    timezone: "Europe/Moscow",
  },
};

const REVIEW_BIRTH_PLACE = {
  name: "Moscow, Russia",
  lat: REVIEW_BIRTH.location.lat,
  lon: REVIEW_BIRTH.location.lng,
  timezone: REVIEW_BIRTH.location.timezone,
};

export async function ensureStoreReviewProfile(
  db: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data: row, error: loadError } = await db
    .from("users")
    .select("onboarded_at, birth_date")
    .eq("id", userId)
    .maybeSingle();
  if (loadError) throw loadError;

  const nowIso = new Date().toISOString();
  const needsBirthSeed =
    typeof row?.birth_date !== "string" || !row.birth_date.trim();

  const { error: updateError } = await db
    .from("users")
    .update({
      store_review_account: true,
      skip_email_automations: true,
      membership_tier: "master",
      membership_expires_at: null,
      trial_expires_at: null,
      // Fixed Review Notes name (overwrite email-local-part defaults).
      display_name: "Alex",
      onboarded_at: row?.onboarded_at ?? nowIso,
      updated_at: nowIso,
      ...(needsBirthSeed
        ? {
            birth_date: REVIEW_BIRTH.date,
            birth_time: REVIEW_BIRTH.time,
            birth_place: REVIEW_BIRTH_PLACE,
            lat: REVIEW_BIRTH.location.lat,
            lon: REVIEW_BIRTH.location.lng,
            tz: REVIEW_BIRTH.location.timezone,
            location_name: REVIEW_BIRTH_PLACE.name,
            country_code: "RU",
            city: "Moscow",
          }
        : {}),
    })
    .eq("id", userId);
  if (updateError) throw updateError;

  const { data: natal, error: natalLoadError } = await db
    .from("user_natal_charts")
    .select("id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (natalLoadError) throw natalLoadError;
  if (natal?.id) return;

  // Only auto-compute natal from the Moscow seed when we just seeded birth data.
  // If birth exists but natal is missing (edge), leave natal to createNatalProfile.
  if (!needsBirthSeed) return;

  const profile = await computeNatalProfileWithAstronomia(REVIEW_BIRTH);
  const version = await nextVersionFor(db, "user_natal_charts", userId);
  const { error: insertError } = await db.from("user_natal_charts").insert({
    user_id: userId,
    version,
    is_active: true,
    precision_mode: profile.precisionMode,
    is_day_chart: profile.isDayChart,
    ascendant_longitude: profile.ascendant?.longitude ?? null,
    house_system: profile.houseSystem,
    planets: profile.planets,
    ephemeris_lib_version: profile.ephemerisLibVersion,
    computed_at: profile.computedAt,
  });
  if (insertError) throw insertError;
}
