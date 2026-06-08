import { DateTime } from "luxon";

import { asMatrixCells } from "@legacy/app/api/communicator/v2/dialog/lifeMatrixPersistence";
import { errorResponse, requireUserId, createServiceSupabase, json } from "@legacy/app/api/_utils/supabase";

export const runtime = "nodejs";

const SPHERE_TITLES_RU = [
  "Тело и безопасность",
  "Удовольствия и отдых",
  "Проявленность и деньги",
  "Друзья, семья, отношения",
  "Ценности и самовыражение",
  "Познание и обучение",
  "Высшие смыслы, вера",
] as const;

const BREATH_LABEL_RU: Record<string, string> = {
  coherent: "когерентное",
  "nadi-shodhana": "попеременное",
  "surya-bhedana": "солнечное",
  "chandra-bhedana": "лунное",
  square: "квадратное",
  "triangle-up": "треугольное вверх",
  "triangle-down": "треугольное вниз",
};

function localDayBounds(localDate: string, timezone: string) {
  const start = DateTime.fromISO(localDate, { zone: timezone }).startOf("day");
  const end = start.plus({ days: 1 });
  return {
    startUtc: start.toUTC().toISO() ?? `${localDate}T00:00:00.000Z`,
    endUtc: end.toUTC().toISO() ?? `${localDate}T23:59:59.999Z`,
  };
}

function formatPracticeTitle(row: {
  practice_slug: string;
  duration_sec: number | null;
  started_at: string;
  context: unknown;
}) {
  const context = row.context && typeof row.context === "object" && !Array.isArray(row.context)
    ? row.context as Record<string, unknown>
    : {};
  const kind = typeof context.practice_kind === "string" ? context.practice_kind : null;
  if (kind === "breath") return `Дыхание: ${BREATH_LABEL_RU[row.practice_slug] ?? row.practice_slug}`;
  if (kind === "meditation") return "Медитация";
  if (kind === "yoga") return "Асаны";
  if (row.practice_slug === "sacred-symbol-stream") return "Медитация";
  if (BREATH_LABEL_RU[row.practice_slug]) return `Дыхание: ${BREATH_LABEL_RU[row.practice_slug]}`;
  return row.practice_slug;
}

function buildSphereStats(actions: Array<{ cells: unknown }>) {
  const totals = Array.from({ length: 7 }, (_, index) => ({
    id: index + 1,
    title: SPHERE_TITLES_RU[index] ?? String(index + 1),
    value: 0,
  }));
  for (const action of actions) {
    for (const cell of asMatrixCells(action.cells)) {
      if (cell.sphere >= 1 && cell.sphere <= 7) {
        totals[cell.sphere - 1]!.value += cell.weight;
      }
    }
  }
  const max = Math.max(0, ...totals.map((item) => item.value));
  return totals.map((item) => ({
    ...item,
    radius: max > 0 ? Math.sqrt(item.value / max) : 0,
  }));
}

function buildSphereHint(stats: ReturnType<typeof buildSphereStats>) {
  const active = stats.filter((item) => item.value > 0.001);
  if (!active.length) return null;
  if (active.length <= 2) {
    return "Пока день собран довольно узко. Чтобы расширять матрицу состояний, добавьте одно небольшое действие из другой сферы: тело, отдых, отношения, обучение или ценности.";
  }
  if (active.length <= 4) {
    return "День уже включает несколько сфер. Можно сделать его шире: добавьте короткое действие из той области, которая обычно остаётся без внимания.";
  }
  return "День выглядит достаточно разнообразным. Выберите главный тон внимания и проживите эти действия не на автомате, а в новом состоянии.";
}

async function chooseWorkingLocalDate(db: ReturnType<typeof createServiceSupabase>, userId: string, today: string) {
  const { data, error } = await db
    .from("planned_events")
    .select("planned_local_date")
    .eq("user_id", userId)
    .eq("status", "planned")
    .lt("planned_local_date", today)
    .order("planned_local_date", { ascending: false })
    .limit(1);
  if (error) throw error;
  return typeof data?.[0]?.planned_local_date === "string" ? data[0].planned_local_date : today;
}

export async function GET(req: Request) {
  try {
    const userId = await requireUserId(req);
    const db = createServiceSupabase();
    const { data: user, error: userError } = await db
      .from("users")
      .select("tz,locale")
      .eq("id", userId)
      .maybeSingle();
    if (userError) throw userError;

    const timezone = typeof user?.tz === "string" && user.tz ? user.tz : "UTC";
    const nowLocal = DateTime.now().setZone(timezone);
    const today = nowLocal.toFormat("yyyy-MM-dd");
    const yesterday = nowLocal.minus({ days: 1 }).toFormat("yyyy-MM-dd");
    const localDate = await chooseWorkingLocalDate(db, userId, today);
    const { startUtc, endUtc } = localDayBounds(localDate, timezone);

    const [forecastRes, actionsRes, practicesRes, offerRes] = await Promise.all([
      db
        .from("user_daily_forecasts")
        .select("forecast_date,recommendation_short_text,recommendation_long_text,day_target_chakra,day_target_reason,planet_of_the_day,today_planet_state")
        .eq("user_id", userId)
        .eq("forecast_date", localDate)
        .maybeSingle(),
      db
        .from("planned_events")
        .select("id,description,recommendation_text,explicit_time_text,display_order,planned_local_date,expected_at,planned_at,status,cells,outcome_text,summarized_at")
        .eq("user_id", userId)
        .eq("planned_local_date", localDate)
        .in("status", ["planned", "summarized"])
        .order("display_order", { ascending: true, nullsFirst: false })
        .order("planned_at", { ascending: true }),
      db
        .from("practice_sessions")
        .select("id,practice_slug,started_at,ended_at,duration_sec,context")
        .eq("user_id", userId)
        .not("ended_at", "is", null)
        .gte("started_at", startUtc)
        .lt("started_at", endUtc)
        .order("started_at", { ascending: true }),
      db
        .from("day_practice_offers")
        .select("id,practice_kind,practice_id,practice_slug,title,duration_sec,launch,practice_summary,status,created_at")
        .eq("user_id", userId)
        .eq("local_date", localDate)
        .eq("status", "pending")
        .maybeSingle(),
    ]);
    if (forecastRes.error) throw forecastRes.error;
    if (actionsRes.error) throw actionsRes.error;
    if (practicesRes.error) throw practicesRes.error;
    if (offerRes.error) throw offerRes.error;

    let pendingPractice = offerRes.data ?? null;
    if (pendingPractice) {
      const completedMatchingPractice = (practicesRes.data ?? []).some((row) =>
        row.practice_slug === pendingPractice?.practice_slug
        && row.started_at >= String(pendingPractice?.created_at ?? ""),
      );
      if (completedMatchingPractice) {
        await db
          .from("day_practice_offers")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("user_id", userId)
          .eq("id", pendingPractice.id);
        pendingPractice = null;
      }
    }

    const actions = (actionsRes.data ?? []).map((row, index) => ({
      id: row.id,
      title: row.description,
      recommendation: row.recommendation_text ?? null,
      explicitTimeText: row.explicit_time_text ?? null,
      displayOrder: row.display_order ?? index,
      status: row.status,
      summarizedAt: row.summarized_at,
      outcomeText: row.outcome_text,
      cells: asMatrixCells(row.cells),
    }));
    const sphereStats = buildSphereStats(actionsRes.data ?? []);

    return json({
      localDate,
      dateLabelKind: localDate === yesterday ? "yesterday" : "date",
      timezone,
      forecast: forecastRes.data ?? null,
      dayRecommendation: forecastRes.data?.recommendation_short_text ?? forecastRes.data?.recommendation_long_text ?? null,
      actions,
      sphereStats,
      sphereHint: buildSphereHint(sphereStats),
      practices: (practicesRes.data ?? []).map((row) => ({
        id: row.id,
        title: formatPracticeTitle(row),
        startedAt: row.started_at,
        endedAt: row.ended_at,
        durationSec: row.duration_sec,
      })),
      pendingPractice,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(req: Request) {
  try {
    const userId = await requireUserId(req);
    const db = createServiceSupabase();
    const body = await req.json() as {
      action?: string;
      eventId?: string;
      title?: string;
      offerId?: string;
    };

    if (body.action === "rename_event") {
      const title = body.title?.trim();
      if (!body.eventId || !title) return json({ error: "eventId and title are required" }, { status: 400 });
      const { error } = await db
        .from("planned_events")
        .update({ description: title })
        .eq("user_id", userId)
        .eq("id", body.eventId)
        .eq("status", "planned");
      if (error) throw error;
      return json({ ok: true });
    }

    if (body.action === "delete_event") {
      if (!body.eventId) return json({ error: "eventId is required" }, { status: 400 });
      const { error } = await db
        .from("planned_events")
        .delete()
        .eq("user_id", userId)
        .eq("id", body.eventId)
        .eq("status", "planned");
      if (error) throw error;
      return json({ ok: true });
    }

    if (body.action === "cancel_practice_offer") {
      if (!body.offerId) return json({ error: "offerId is required" }, { status: 400 });
      const nowIso = new Date().toISOString();
      const { error } = await db
        .from("day_practice_offers")
        .update({ status: "cancelled", cancelled_at: nowIso })
        .eq("user_id", userId)
        .eq("id", body.offerId)
        .eq("status", "pending");
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const db = createServiceSupabase();
    const body = await req.json() as {
      localDate?: string;
      practice?: {
        id: string;
        slug: string;
        kind: "meditation" | "breath" | "yoga";
        title: string;
        defaultDurationSec?: number | null;
        launch: unknown;
        summary: unknown;
      };
    };
    const localDate = body.localDate?.trim();
    const practice = body.practice;
    if (!localDate || !practice?.slug || !practice.title || !practice.kind) {
      return json({ error: "localDate and practice are required" }, { status: 400 });
    }

    await db
      .from("day_practice_offers")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("local_date", localDate)
      .eq("status", "pending");

    const { data, error } = await db
      .from("day_practice_offers")
      .insert({
        user_id: userId,
        local_date: localDate,
        practice_kind: practice.kind,
        practice_id: practice.id,
        practice_slug: practice.slug,
        title: practice.title,
        duration_sec: practice.defaultDurationSec ?? null,
        launch: practice.launch ?? {},
        practice_summary: practice.summary ?? {},
        status: "pending",
      })
      .select("id")
      .single();
    if (error) throw error;
    return json({ ok: true, id: data?.id ?? null });
  } catch (error) {
    return errorResponse(error);
  }
}
