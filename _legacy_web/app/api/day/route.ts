import { DateTime } from "luxon";

import { asPlanningSphereCells } from "@legacy/app/api/_utils/lifeMatrix";
import { purgeHistoricalSummarizedPlannedEvents } from "@legacy/app/api/communicator/v2/dialog/lifeMatrixPersistence";
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
    for (const cell of asPlanningSphereCells(action.cells)) {
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

async function loadForecastForLocalDateOrLatest(
  db: ReturnType<typeof createServiceSupabase>,
  userId: string,
  localDate: string,
) {
  const exact = await db
    .from("user_daily_forecasts")
    .select("forecast_date,recommendation_short_text,recommendation_long_text,is_corrected_via_dialog,day_target_chakra,day_target_reason,planet_of_the_day,today_planet_state")
    .eq("user_id", userId)
    .eq("forecast_date", localDate)
    .maybeSingle();
  if (exact.error) throw exact.error;
  if (exact.data) return exact;

  const latest = await db
    .from("user_daily_forecasts")
    .select("forecast_date,recommendation_short_text,recommendation_long_text,is_corrected_via_dialog,day_target_chakra,day_target_reason,planet_of_the_day,today_planet_state")
    .eq("user_id", userId)
    .order("forecast_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest.error) throw latest.error;
  return latest;
}

function dateLabelKindFor(localDate: string, today: string, yesterday: string): "today" | "yesterday" | "date" {
  if (localDate === today) return "today";
  if (localDate === yesterday) return "yesterday";
  return "date";
}

function localDateForStartedAt(iso: string, timezone: string): string {
  const date = DateTime.fromISO(iso, { zone: "utc" }).setZone(timezone);
  return date.isValid ? date.toFormat("yyyy-MM-dd") : iso.slice(0, 10);
}

function buildPracticeLogsForDates(
  rows: Array<{ id: string; practice_slug: string; started_at: string; ended_at: string | null; duration_sec: number | null; context: unknown }>,
  timezone: string,
) {
  const grouped = new Map<string, Array<{ id: string; localDate: string; title: string; startedAt: string; endedAt: string | null; durationSec: number | null }>>();
  for (const row of rows) {
    const localDate = localDateForStartedAt(row.started_at, timezone);
    const item = {
      id: row.id,
      localDate,
      title: formatPracticeTitle(row),
      startedAt: row.started_at,
      endedAt: row.ended_at,
      durationSec: row.duration_sec,
    };
    const bucket = grouped.get(localDate);
    if (bucket) bucket.push(item);
    else grouped.set(localDate, [item]);
  }
  return grouped;
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
    const localDate = today;
    await purgeHistoricalSummarizedPlannedEvents(db, userId, localDate);

    const [overdueActionsRes, forecastRes, currentActionsRes, offerRes] = await Promise.all([
      db
        .from("planned_events")
        .select("id,description,recommendation_text,explicit_time_text,display_order,planned_local_date,expected_at,planned_at,status,cells,outcome_text,summarized_at")
        .eq("user_id", userId)
        .eq("status", "planned")
        .lt("planned_local_date", localDate)
        .order("planned_local_date", { ascending: false })
        .order("display_order", { ascending: true, nullsFirst: false })
        .order("planned_at", { ascending: true }),
      loadForecastForLocalDateOrLatest(db, userId, localDate),
      db
        .from("planned_events")
        .select("id,description,recommendation_text,explicit_time_text,display_order,planned_local_date,expected_at,planned_at,status,cells,outcome_text,summarized_at")
        .eq("user_id", userId)
        .eq("planned_local_date", localDate)
        .in("status", ["planned", "summarized"])
        .order("display_order", { ascending: true, nullsFirst: false })
        .order("planned_at", { ascending: true }),
      db
        .from("day_practice_offers")
        .select("id,practice_kind,practice_id,practice_slug,title,duration_sec,launch,practice_summary,status,created_at")
        .eq("user_id", userId)
        .eq("local_date", localDate)
        .eq("status", "pending")
        .maybeSingle(),
    ]);
    if (overdueActionsRes.error) throw overdueActionsRes.error;
    if (forecastRes.error) throw forecastRes.error;
    if (currentActionsRes.error) throw currentActionsRes.error;
    if (offerRes.error) throw offerRes.error;

    const overdueRows = overdueActionsRes.data ?? [];
    const hasOverdueSummary = overdueRows.length > 0;

    if (hasOverdueSummary) {
      const overdueDates = [...new Set(overdueRows.map((row) => row.planned_local_date).filter(Boolean))];
      const oldestDate = overdueDates[overdueDates.length - 1] ?? localDate;
      const newestDate = overdueDates[0] ?? localDate;
      const oldestBounds = localDayBounds(oldestDate, timezone);
      const newestBounds = localDayBounds(newestDate, timezone);
      const practicesRes = await db
        .from("practice_sessions")
        .select("id,practice_slug,started_at,ended_at,duration_sec,context")
        .eq("user_id", userId)
        .not("ended_at", "is", null)
        .gte("started_at", oldestBounds.startUtc)
        .lt("started_at", newestBounds.endUtc)
        .order("started_at", { ascending: true });
      if (practicesRes.error) throw practicesRes.error;

      const practicesByDate = buildPracticeLogsForDates(practicesRes.data ?? [], timezone);
      const sections = overdueDates.map((date) => {
        const dateRows = overdueRows.filter((row) => row.planned_local_date === date);
        const actions = dateRows
          .map((row, index) => ({
            id: row.id,
            localDate: row.planned_local_date,
            title: row.description,
            recommendation: row.recommendation_text ?? null,
            explicitTimeText: row.explicit_time_text ?? null,
            displayOrder: row.display_order ?? index,
            status: row.status,
            summarizedAt: row.summarized_at,
            outcomeText: row.outcome_text,
            cells: asPlanningSphereCells(row.cells),
            plannedAt: row.planned_at,
          }))
          .sort((left, right) => {
            const byDisplayOrder = (left.displayOrder ?? Number.MAX_SAFE_INTEGER) - (right.displayOrder ?? Number.MAX_SAFE_INTEGER);
            if (byDisplayOrder !== 0) return byDisplayOrder;
            return String(left.plannedAt ?? "").localeCompare(String(right.plannedAt ?? ""));
          })
          .map(({ plannedAt, ...rest }) => rest);
        const sphereStats = buildSphereStats(dateRows);
        return {
          localDate: date,
          dateLabelKind: dateLabelKindFor(date, today, yesterday),
          actions,
          sphereStats,
          sphereHint: buildSphereHint(sphereStats),
          practices: practicesByDate.get(date) ?? [],
        };
      });

      return json({
        mode: "overdue_summary",
        currentLocalDate: localDate,
        timezone,
        forecast: null,
        dayRecommendation: null,
        hasOverdueSummary: true,
        canSummarizeCurrentDay: false,
        summaryTargetLocalDate: newestDate,
        sections,
        pendingPractice: null,
      });
    }

    const { startUtc, endUtc } = localDayBounds(localDate, timezone);
    const practicesRes = await db
      .from("practice_sessions")
      .select("id,practice_slug,started_at,ended_at,duration_sec,context")
      .eq("user_id", userId)
      .not("ended_at", "is", null)
      .gte("started_at", startUtc)
      .lt("started_at", endUtc)
      .order("started_at", { ascending: true });
    if (practicesRes.error) throw practicesRes.error;

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

    const actions = (currentActionsRes.data ?? [])
      .map((row, index) => ({
        id: row.id,
        localDate: row.planned_local_date,
        title: row.description,
        recommendation: row.recommendation_text ?? null,
        explicitTimeText: row.explicit_time_text ?? null,
        displayOrder: row.display_order ?? index,
        status: row.status,
        summarizedAt: row.summarized_at,
        outcomeText: row.outcome_text,
        cells: asPlanningSphereCells(row.cells),
        plannedAt: row.planned_at,
      }))
      .sort((left, right) => {
        const byDisplayOrder = (left.displayOrder ?? Number.MAX_SAFE_INTEGER) - (right.displayOrder ?? Number.MAX_SAFE_INTEGER);
        if (byDisplayOrder !== 0) return byDisplayOrder;
        return String(left.plannedAt ?? "").localeCompare(String(right.plannedAt ?? ""));
      })
      .map(({ plannedAt, ...rest }) => rest);
    const sphereStats = buildSphereStats(currentActionsRes.data ?? []);
    const practices = buildPracticeLogsForDates(practicesRes.data ?? [], timezone).get(localDate) ?? [];
    const canSummarizeCurrentDay = actions.some((action) => action.status === "planned");
    const sections = [{
      localDate,
      dateLabelKind: dateLabelKindFor(localDate, today, yesterday),
      actions,
      sphereStats,
      sphereHint: buildSphereHint(sphereStats),
      practices,
    }];

    return json({
      mode: actions.length > 0 || practices.length > 0 || Boolean(pendingPractice) ? "current_day" : "empty_today",
      currentLocalDate: localDate,
      timezone,
      forecast: forecastRes.data ?? null,
      // Header focus is written only by PLANNING branch ([CORRECT_RECOMMENDATION] → persistDayFocus).
      // Summarizing never sets is_corrected_via_dialog; do not surface generic forecast text here.
      dayRecommendation:
        forecastRes.data?.forecast_date === localDate
        && forecastRes.data?.is_corrected_via_dialog === true
          ? forecastRes.data.recommendation_short_text ?? null
          : null,
      hasOverdueSummary: false,
      canSummarizeCurrentDay,
      summaryTargetLocalDate: canSummarizeCurrentDay ? localDate : null,
      sections,
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
