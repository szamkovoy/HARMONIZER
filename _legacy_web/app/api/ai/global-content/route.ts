import type { SupabaseClient } from "@supabase/supabase-js";

import { runDevDayContentReset } from "../../_utils/devDayContentReset";
import { resolveContentLocale, SOURCE_LOCALE, type AppContentLocale, type TargetLocale } from "../../_utils/contentLocales";
import { ensureGlobalDailyContentRow, getExpectedGlobalDailyContentModel, globalContentNeedsRefresh } from "../../_utils/ensureGlobalDailyContent";
import { localizeGlobalContentPayloadSync } from "../../_utils/globalContentLocale";
import {
  pretranslateGlobalTexts,
  upsertGlobalTextI18n,
  type GlobalTextI18nMap,
} from "../../_utils/pretranslateGlobalTexts";
import { createServiceSupabase, errorResponse, json, requireUserId } from "../../_utils/supabase";

export const runtime = "nodejs";

type UserAccess = {
  tz?: string | null;
  locale?: string | null;
  membership_tier?: "free" | "premium" | null;
  trial_expires_at?: string | null;
};

function todayLocalDate(timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function hasPremiumAccess(user: UserAccess, now = new Date()): boolean {
  if (user.membership_tier === "premium") return true;
  if (user.membership_tier === "free" && user.trial_expires_at) {
    return new Date(user.trial_expires_at).getTime() > now.getTime();
  }
  return false;
}

function payloadFromContent(content: Record<string, unknown>, user: UserAccess, isFallback: boolean) {
  return {
    slogan: content.slogan,
    short_text: content.short_text,
    long_explanation: content.long_explanation,
    math_level: content.math_level,
    primary_planet: content.primary_planet,
    primary_chakra_number: content.primary_chakra_number,
    primary_tone: content.primary_tone,
    top_petals: content.top_petals,
    planet_positions: content.planet_positions,
    forecast_date: content.forecast_date_utc,
    llm_model: content.llm_model,
    is_global: true,
    is_fallback: isFallback,
    membership_tier: user.membership_tier ?? "free",
    has_premium_access: hasPremiumAccess(user),
    trial_expires_at: user.trial_expires_at ?? null,
  };
}

async function backfillGlobalTextI18n(
  db: SupabaseClient,
  forecastDateUtc: string,
  ru: { slogan: string; short_text: string; long_explanation: string },
  locales: readonly TargetLocale[],
): Promise<void> {
  const partial = await pretranslateGlobalTexts(ru, { locales });
  if (!Object.keys(partial).length) return;

  const { data: existing, error: readError } = await db
    .from("global_daily_content")
    .select("text_i18n")
    .eq("forecast_date_utc", forecastDateUtc)
    .maybeSingle();
  if (readError) throw readError;

  const merged: GlobalTextI18nMap = {
    ...((existing as { text_i18n?: GlobalTextI18nMap } | null)?.text_i18n ?? {}),
    ...partial,
  };
  await upsertGlobalTextI18n(db, forecastDateUtc, merged);
}

/**
 * Never block the HTTP response on LLM pre-translation — pickGlobalTexts already
 * falls back to canonical RU when a locale row is missing.
 */
async function ensureRowTextI18n(
  db: SupabaseClient,
  row: Record<string, unknown>,
  locale: AppContentLocale,
): Promise<Record<string, unknown>> {
  if (locale === SOURCE_LOCALE) return row;
  const map = row.text_i18n as GlobalTextI18nMap | undefined;
  const target = locale as TargetLocale;
  if (map?.[target]?.short_text?.trim()) return row;

  const forecastDateUtc = String(row.forecast_date_utc ?? "").trim();
  const ru = {
    slogan: String(row.slogan ?? "").trim(),
    short_text: String(row.short_text ?? "").trim(),
    long_explanation: String(row.long_explanation ?? "").trim(),
  };
  if (!ru.short_text || !forecastDateUtc) return row;

  void backfillGlobalTextI18n(db, forecastDateUtc, ru, [target]).catch((pretranslateError) => {
    console.error("[global-content] background text_i18n backfill failed", locale, pretranslateError);
  });
  return row;
}

async function respondWithLocalizedContent(
  db: SupabaseClient,
  row: Record<string, unknown>,
  user: UserAccess,
  isFallback: boolean,
  responseLocale: ReturnType<typeof resolveContentLocale>,
  devResetExtra: Record<string, unknown>,
) {
  const localizedRow = await ensureRowTextI18n(db, row, responseLocale);
  const localized = localizeGlobalContentPayloadSync(localizedRow, responseLocale);
  return json({
    ...payloadFromContent(
      {
        ...localizedRow,
        slogan: localized.slogan,
        short_text: localized.short_text,
        long_explanation: localized.long_explanation,
        math_level: localized.math_level,
      },
      user,
      isFallback,
    ),
    ...devResetExtra,
  });
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const db = createServiceSupabase();
    const body = (await req.json().catch(() => ({}))) as { devReset?: boolean; responseLocale?: string };

    let devResetExtra: { dev_reset?: Awaited<ReturnType<typeof runDevDayContentReset>> } = {};
    if (body.devReset === true) {
      devResetExtra = { dev_reset: await runDevDayContentReset(db, userId, "global") };
    }

    const { data: user, error: userError } = await db
      .from("users")
      .select("tz,locale,membership_tier,trial_expires_at")
      .eq("id", userId)
      .maybeSingle();
    if (userError) throw userError;
    if (!user) return json({ error: "User not found" }, { status: 404 });

    const userAccess = user as UserAccess;
    const responseLocale = resolveContentLocale(userAccess.locale, body.responseLocale);
    const localDate = todayLocalDate(userAccess.tz ?? "UTC");
    const expectedModel = await getExpectedGlobalDailyContentModel(db);
    const { data: content, error } = await db
      .from("global_daily_content")
      .select("*")
      .eq("forecast_date_utc", localDate)
      .maybeSingle();
    if (error) throw error;

    if (content) {
      if (globalContentNeedsRefresh(content as Record<string, unknown>, expectedModel)) {
        await ensureGlobalDailyContentRow(db, localDate);
        const { data: refreshed, error: refreshedError } = await db
          .from("global_daily_content")
          .select("*")
          .eq("forecast_date_utc", localDate)
          .maybeSingle();
        if (refreshedError) throw refreshedError;
        if (refreshed) {
          return respondWithLocalizedContent(
            db,
            refreshed as Record<string, unknown>,
            userAccess,
            false,
            responseLocale,
            devResetExtra,
          );
        }
      }
      return respondWithLocalizedContent(
        db,
        content as Record<string, unknown>,
        userAccess,
        false,
        responseLocale,
        devResetExtra,
      );
    }

    const { data: fallback, error: fallbackError } = await db
      .from("global_daily_content")
      .select("*")
      .order("forecast_date_utc", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (fallbackError) throw fallbackError;
    if (!fallback) {
      try {
        await ensureGlobalDailyContentRow(db, localDate);
      } catch (synthError) {
        console.error("[global-content] on-demand synthesis failed", synthError);
        return json({ error: "No global content available", ...devResetExtra }, { status: 503 });
      }
      const { data: created, error: createdError } = await db
        .from("global_daily_content")
        .select("*")
        .eq("forecast_date_utc", localDate)
        .maybeSingle();
      if (createdError) throw createdError;
      if (created) {
        return respondWithLocalizedContent(
          db,
          created as Record<string, unknown>,
          userAccess,
          false,
          responseLocale,
          devResetExtra,
        );
      }
      return json({ error: "No global content available", ...devResetExtra }, { status: 503 });
    }

    return respondWithLocalizedContent(
      db,
      fallback as Record<string, unknown>,
      userAccess,
      true,
      responseLocale,
      devResetExtra,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
