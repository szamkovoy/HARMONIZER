import type { SupabaseClient } from "@supabase/supabase-js";

export type NotificationSegment =
  | { kind: "all" }
  | { kind: "tier"; tier: "free" | "oracle" | "practitioner" | "master" }
  | { kind: "webinar"; webinarId: string };

const TIERS = ["free", "oracle", "practitioner", "master"] as const;

const TIER_LABELS: Record<string, string> = {
  free: "Бесплатный",
  oracle: "Оракул",
  practitioner: "Практик",
  master: "Мастер",
};

/** 'all' | 'tier:<tier>' | 'webinar:<uuid>' → структура; кидает 400 на мусор. */
export function parseSegment(raw: string | undefined): NotificationSegment {
  const value = raw?.trim() ?? "";
  if (value === "all") return { kind: "all" };
  if (value.startsWith("tier:")) {
    const tier = value.slice(5) as (typeof TIERS)[number];
    if (TIERS.includes(tier)) return { kind: "tier", tier };
  }
  if (value.startsWith("webinar:")) {
    const webinarId = value.slice(8);
    if (webinarId) return { kind: "webinar", webinarId };
  }
  throw new Response(JSON.stringify({ error: `Неизвестный сегмент: ${value || "пусто"}` }), { status: 400 });
}

export async function resolveSegmentUserIds(
  db: SupabaseClient,
  segment: NotificationSegment,
): Promise<string[]> {
  if (segment.kind === "webinar") {
    const { data, error } = await db
      .from("webinar_registrations")
      .select("user_id")
      .eq("webinar_id", segment.webinarId);
    if (error) throw error;
    return (data ?? []).map((row) => row.user_id);
  }
  let query = db.from("users").select("id");
  if (segment.kind === "tier") query = query.eq("membership_tier", segment.tier);
  const { data, error } = await query.limit(10000);
  if (error) throw error;
  return (data ?? []).map((row) => row.id);
}

export async function segmentLabel(db: SupabaseClient, segment: NotificationSegment): Promise<string> {
  if (segment.kind === "all") return "Все пользователи";
  if (segment.kind === "tier") return `Тариф «${TIER_LABELS[segment.tier]}»`;
  const { data } = await db.from("webinars").select("title").eq("id", segment.webinarId).maybeSingle();
  return `Вебинар «${data?.title ?? segment.webinarId}»`;
}
