import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";

import { hasEffectivePremium } from "@/modules/access/core/paidAccess";
import { runDevDayContentReset } from "../../_utils/devDayContentReset";
import { resolveContentLocale, SOURCE_LOCALE, type AppContentLocale, type TargetLocale } from "../../_utils/contentLocales";
import { ensureGlobalDailyContentRow, getExpectedGlobalDailyContentModel, globalContentNeedsRefresh, writeStructuralGlobalRow } from "../../_utils/ensureGlobalDailyContent";
import { localizeGlobalContentPayloadSync } from "../../_utils/globalContentLocale";
import {
  pretranslateGlobalTexts,
  upsertGlobalTextI18n,
  type GlobalTextI18nMap,
} from "../../_utils/pretranslateGlobalTexts";
import { createServiceSupabase, errorResponse, json, requireUserId } from "../../_utils/supabase";

export const runtime = "nodejs";
/**
 * Обычный load отвечает structural/cache сразу; LLM догоняет через `after()`.
 * `forceRefresh` (смена языка / явный ensure) может дождаться полной генерации —
 * maxDuration 120 даёт запас над ~90s LLM-цепочкой.
 */
export const maxDuration = 120;

type UserAccess = {
  tz?: string | null;
  locale?: string | null;
  membership_tier?: string | null;
  trial_expires_at?: string | null;
  membership_expires_at?: string | null;
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

// Правило платного доступа общее с клиентом: modules/access/core/paidAccess.ts.
const hasPremiumAccess = (user: UserAccess): boolean => hasEffectivePremium(user);

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Строку можно ОТДАТЬ клиенту (структурный прогноз + минимальные тексты есть),
 * даже если она устарела по модели/структуре — свежесть догонит background refresh.
 */
function isUsableGlobalRow(row: Record<string, unknown> | null | undefined): row is Record<string, unknown> {
  return Boolean(row && hasText(row.slogan) && hasText(row.short_text) && hasText(row.long_explanation));
}

/**
 * In-flight guard для регенерации в пределах инстанса (dedup гонок + after()/forceRefresh).
 */
const refreshInFlight = new Map<string, Promise<void>>();

function scheduleGlobalRefresh(db: SupabaseClient, localDate: string): Promise<void> {
  const existing = refreshInFlight.get(localDate);
  if (existing) return existing;
  const promise = ensureGlobalDailyContentRow(db, localDate)
    .catch((refreshError) => {
      console.error("[global-content] refresh failed", localDate, refreshError);
    })
    .finally(() => {
      refreshInFlight.delete(localDate);
    });
  refreshInFlight.set(localDate, promise);
  return promise;
}

/** Keep Vercel alive after the HTTP response so LLM warm is not killed. */
function queueBackgroundRefresh(db: SupabaseClient, localDate: string): void {
  after(() => scheduleGlobalRefresh(db, localDate));
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

function rowHasLocaleTexts(row: Record<string, unknown>, locale: AppContentLocale): boolean {
  if (locale === SOURCE_LOCALE) {
    return hasText(row.slogan) && hasText(row.short_text) && Boolean(String(row.llm_model ?? "").trim());
  }
  const map = row.text_i18n as GlobalTextI18nMap | undefined;
  const localized = map?.[locale as TargetLocale];
  return Boolean(localized?.slogan?.trim() && localized?.short_text?.trim());
}

/**
 * Never block the HTTP response on LLM pre-translation for ordinary loads —
 * pickGlobalTexts already falls back to canonical RU when a locale row is missing.
 * `awaitBackfill` is used by forceRefresh (profile language rebuild).
 */
async function ensureRowTextI18n(
  db: SupabaseClient,
  row: Record<string, unknown>,
  locale: AppContentLocale,
  awaitBackfill: boolean,
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

  if (!awaitBackfill) {
    void backfillGlobalTextI18n(db, forecastDateUtc, ru, [target]).catch((pretranslateError) => {
      console.error("[global-content] background text_i18n backfill failed", locale, pretranslateError);
    });
    return row;
  }

  try {
    await backfillGlobalTextI18n(db, forecastDateUtc, ru, [target]);
    const { data: refreshed, error } = await db
      .from("global_daily_content")
      .select("*")
      .eq("forecast_date_utc", forecastDateUtc)
      .maybeSingle();
    if (error) throw error;
    if (isUsableGlobalRow(refreshed as Record<string, unknown> | null)) {
      return refreshed as Record<string, unknown>;
    }
  } catch (pretranslateError) {
    console.error("[global-content] awaited text_i18n backfill failed", locale, pretranslateError);
  }
  return row;
}

async function respondWithLocalizedContent(
  db: SupabaseClient,
  row: Record<string, unknown>,
  user: UserAccess,
  isFallback: boolean,
  responseLocale: ReturnType<typeof resolveContentLocale>,
  devResetExtra: Record<string, unknown>,
  awaitLocaleBackfill: boolean,
) {
  const localizedRow = await ensureRowTextI18n(db, row, responseLocale, awaitLocaleBackfill);
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
      isFallback || !String(localizedRow.llm_model ?? "").trim(),
    ),
    ...devResetExtra,
  });
}

async function loadRowForDate(db: SupabaseClient, localDate: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await db.from("global_daily_content").select("*").eq("forecast_date_utc", localDate).maybeSingle();
  if (error) throw error;
  return isUsableGlobalRow(data as Record<string, unknown> | null) ? (data as Record<string, unknown>) : null;
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const db = createServiceSupabase();
    const body = (await req.json().catch(() => ({}))) as {
      devReset?: boolean;
      responseLocale?: string;
      forceRefresh?: boolean;
    };
    const forceRefresh = body.forceRefresh === true;

    let devResetExtra: { dev_reset?: Awaited<ReturnType<typeof runDevDayContentReset>> } = {};
    if (body.devReset === true) {
      devResetExtra = { dev_reset: await runDevDayContentReset(db, userId, "global") };
    }

    const { data: user, error: userError } = await db
      .from("users")
      .select("tz,locale,membership_tier,trial_expires_at,membership_expires_at")
      .eq("id", userId)
      .maybeSingle();
    if (userError) throw userError;
    if (!user) return json({ error: "User not found" }, { status: 404 });

    const userAccess = user as UserAccess;
    const responseLocale = resolveContentLocale(userAccess.locale, body.responseLocale);
    const localDate = todayLocalDate(userAccess.tz ?? "UTC");
    const expectedModel = await getExpectedGlobalDailyContentModel(db);
    let content = await loadRowForDate(db, localDate);

    // forceRefresh: await full LLM + locale texts (profile language rebuild).
    if (forceRefresh) {
      if (!content || globalContentNeedsRefresh(content, expectedModel) || !rowHasLocaleTexts(content, responseLocale)) {
        await scheduleGlobalRefresh(db, localDate);
        content = await loadRowForDate(db, localDate);
      }
      if (content) {
        return respondWithLocalizedContent(db, content, userAccess, false, responseLocale, devResetExtra, true);
      }
    }

    // 1) Usable row — respond immediately; refresh LLM in background when stale.
    if (content) {
      if (globalContentNeedsRefresh(content, expectedModel)) {
        queueBackgroundRefresh(db, localDate);
      }
      return respondWithLocalizedContent(db, content, userAccess, false, responseLocale, devResetExtra, false);
    }

    // 2) No row — write structural (~1–2s), respond, warm LLM in background.
    try {
      content = await writeStructuralGlobalRow(db, localDate);
    } catch (synthError) {
      console.error("[global-content] structural row write failed", synthError);
    }
    if (content) {
      queueBackgroundRefresh(db, localDate);
      return respondWithLocalizedContent(db, content, userAccess, true, responseLocale, devResetExtra, false);
    }

    // 3) Last resort: most recent past row.
    const { data: fallback, error: fallbackError } = await db
      .from("global_daily_content")
      .select("*")
      .order("forecast_date_utc", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (fallbackError) throw fallbackError;
    if (isUsableGlobalRow(fallback as Record<string, unknown> | null)) {
      return respondWithLocalizedContent(
        db,
        fallback as Record<string, unknown>,
        userAccess,
        true,
        responseLocale,
        devResetExtra,
        false,
      );
    }

    return json({ error: "No global content available", ...devResetExtra }, { status: 503 });
  } catch (error) {
    return errorResponse(error);
  }
}
