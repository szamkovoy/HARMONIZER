import type { SupabaseClient } from "@supabase/supabase-js";

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

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Строку можно ОТДАТЬ клиенту (структурный прогноз + минимальные тексты есть),
 * даже если она устарела по модели/структуре — свежесть догонит фоновый refresh.
 */
function isUsableGlobalRow(row: Record<string, unknown> | null | undefined): row is Record<string, unknown> {
  return Boolean(row && hasText(row.slogan) && hasText(row.short_text) && hasText(row.long_explanation));
}

/**
 * Троттлинг фоновой регенерации, чтобы всплеск free-запросов не запускал десятки
 * параллельных LLM-вызовов на одну и ту же дату. Best-effort в рамках инстанса.
 */
const backgroundRefreshAttempts = new Map<string, number>();
const BACKGROUND_REFRESH_MIN_INTERVAL_MS = 60_000;

function triggerBackgroundGlobalRefresh(db: SupabaseClient, localDate: string): void {
  const now = Date.now();
  const last = backgroundRefreshAttempts.get(localDate) ?? 0;
  if (now - last < BACKGROUND_REFRESH_MIN_INTERVAL_MS) return;
  backgroundRefreshAttempts.set(localDate, now);
  void ensureGlobalDailyContentRow(db, localDate).catch((refreshError) => {
    console.error("[global-content] background refresh failed", localDate, refreshError);
  });
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

    // 1) Есть пригодная строка на сегодня → отдаём немедленно. Если она устарела
    //    (сменилась модель / структура текста), догоняем свежесть фоново, НЕ блокируя
    //    и НЕ роняя ответ, если LLM сейчас недоступна.
    if (isUsableGlobalRow(content as Record<string, unknown> | null)) {
      const row = content as Record<string, unknown>;
      if (globalContentNeedsRefresh(row, expectedModel)) {
        triggerBackgroundGlobalRefresh(db, localDate);
      }
      return respondWithLocalizedContent(db, row, userAccess, false, responseLocale, devResetExtra);
    }

    // 2) Строки на сегодня нет (или она непригодна) → БЫСТРО пишем детерминированную
    //    structural-строку (без LLM, ~1–2s) и сразу отдаём её. Настоящие LLM-тексты
    //    догоняет фоновый refresh — клиент не ждёт DeepSeek/Gemini и не попадает в
    //    25s клиентский таймаут на холодном free-заходе.
    let structuralRow: Record<string, unknown> | null = null;
    try {
      structuralRow = await writeStructuralGlobalRow(db, localDate);
    } catch (synthError) {
      console.error("[global-content] structural row write failed", synthError);
    }

    if (structuralRow) {
      triggerBackgroundGlobalRefresh(db, localDate);
      return respondWithLocalizedContent(
        db,
        structuralRow,
        userAccess,
        false,
        responseLocale,
        devResetExtra,
      );
    }

    // 3) Последний рубеж: отдать самую свежую доступную строку из прошлого,
    //    чтобы экран всё равно открылся (пометив её как fallback).
    const { data: fallback, error: fallbackError } = await db
      .from("global_daily_content")
      .select("*")
      .order("forecast_date_utc", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (fallbackError) throw fallbackError;
    if (isUsableGlobalRow(fallback as Record<string, unknown> | null)) {
      triggerBackgroundGlobalRefresh(db, localDate);
      return respondWithLocalizedContent(
        db,
        fallback as Record<string, unknown>,
        userAccess,
        true,
        responseLocale,
        devResetExtra,
      );
    }

    return json({ error: "No global content available", ...devResetExtra }, { status: 503 });
  } catch (error) {
    return errorResponse(error);
  }
}
