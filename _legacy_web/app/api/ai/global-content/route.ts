import { runDevDayContentReset } from "../../_utils/devDayContentReset";
import { ensureGlobalDailyContentRow } from "../../_utils/ensureGlobalDailyContent";
import { createServiceSupabase, errorResponse, json, requireUserId } from "../../_utils/supabase";

export const runtime = "nodejs";

type UserAccess = {
  tz?: string | null;
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

export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const db = createServiceSupabase();
    const body = (await req.json().catch(() => ({}))) as { devReset?: boolean };

    let devResetExtra: { dev_reset?: Awaited<ReturnType<typeof runDevDayContentReset>> } = {};
    if (body.devReset === true) {
      devResetExtra = { dev_reset: await runDevDayContentReset(db, userId) };
    }

    const { data: user, error: userError } = await db
      .from("users")
      .select("tz,membership_tier,trial_expires_at")
      .eq("id", userId)
      .maybeSingle();
    if (userError) throw userError;
    if (!user) return json({ error: "User not found" }, { status: 404 });

    const localDate = todayLocalDate((user as UserAccess).tz ?? "UTC");
    const { data: content, error } = await db
      .from("global_daily_content")
      .select("*")
      .eq("forecast_date_utc", localDate)
      .maybeSingle();
    if (error) throw error;

    if (content) {
      return json({ ...payloadFromContent(content as Record<string, unknown>, user as UserAccess, false), ...devResetExtra });
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
        return json({ ...payloadFromContent(created as Record<string, unknown>, user as UserAccess, false), ...devResetExtra });
      }
      return json({ error: "No global content available", ...devResetExtra }, { status: 503 });
    }

    return json({ ...payloadFromContent(fallback as Record<string, unknown>, user as UserAccess, true), ...devResetExtra });
  } catch (error) {
    return errorResponse(error);
  }
}
