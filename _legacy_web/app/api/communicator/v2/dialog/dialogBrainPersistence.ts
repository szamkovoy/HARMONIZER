import type { SupabaseClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";

import { normalizePlanningSphereCells, type MatrixCell, type PlanningSphereCell } from "@legacy/app/api/_utils/lifeMatrix";
import { samePlannedEventIdentity } from "@legacy/app/api/_utils/plannedEventInference";
import type { PlannedEventMarker } from "@legacy/app/api/_utils/markers";
import {
  loadPlannedEventsForLocalDate,
  mergeSummarizedEventIntoDailyMatrix,
  rebuildProfileReportSnapshot,
  type PlannedEventRow,
} from "@legacy/app/api/communicator/v2/dialog/lifeMatrixPersistence";

export type PersistedPlannedEvent = {
  id: string | null;
  desc: string;
  displayOrder: number;
  action: "inserted" | "updated";
};

function endOfLocalDayIso(localDate: string, timezone: string): string {
  const end = DateTime.fromISO(localDate, { zone: timezone || "UTC" }).endOf("day");
  return end.toUTC().toISO() ?? `${localDate}T23:59:59.000Z`;
}

/**
 * Deterministically persist a PLANNING finalize turn into `planned_events`:
 * one row per marker, ordered by mention, de-duplicated against existing rows
 * for the same local day. Returns the rows for the turn artifacts payload.
 */
export async function persistPlanningFinalize(params: {
  db: SupabaseClient;
  userId: string;
  conversationId: string;
  workingLocalDate: string;
  timezone: string;
  nowIso: string;
  markers: PlannedEventMarker[];
}): Promise<PersistedPlannedEvent[]> {
  const { db, userId, conversationId, workingLocalDate, timezone, nowIso, markers } = params;
  if (markers.length === 0) return [];

  const existing = await loadPlannedEventsForLocalDate(db, userId, workingLocalDate);
  const expectedAt = endOfLocalDayIso(workingLocalDate, timezone);
  const results: PersistedPlannedEvent[] = [];
  let order = 0;

  for (const marker of markers) {
    order += 1;
    const displayOrder = Number.isInteger(marker.displayOrder) ? Number(marker.displayOrder) : order;
    const cells: PlanningSphereCell[] = normalizePlanningSphereCells(marker.cells);
    const match: PlannedEventRow | undefined = existing.find(
      (row) => row.status === "planned" && samePlannedEventIdentity(row.description, marker.desc),
    );

    if (match) {
      const { error } = await db
        .from("planned_events")
        .update({
          description: marker.desc,
          recommendation_text: marker.recommendation,
          display_order: displayOrder,
          cells,
        })
        .eq("user_id", userId)
        .eq("id", match.id);
      if (error) throw error;
      results.push({ id: match.id, desc: marker.desc, displayOrder, action: "updated" });
      continue;
    }

    const { data, error } = await db
      .from("planned_events")
      .insert({
        user_id: userId,
        conversation_id: conversationId,
        description: marker.desc,
        planned_at: nowIso,
        planned_local_date: workingLocalDate,
        expected_at: expectedAt,
        time_resolution: "fallback_default",
        time_phrase_raw: null,
        context_snippets: marker.snippets ?? [],
        cells,
        status: "planned",
        recommendation_text: marker.recommendation,
        display_order: displayOrder,
        explicit_time_text: null,
      })
      .select("id")
      .single();
    if (error) throw error;
    results.push({ id: (data?.id as string) ?? null, desc: marker.desc, displayOrder, action: "inserted" });
  }

  return results;
}

/** Store the day focus (overall recommendation) shown in the Day tab header. */
export async function persistDayFocus(params: {
  db: SupabaseClient;
  userId: string;
  forecastId: string | null;
  shortText: string | null | undefined;
}): Promise<void> {
  const { db, forecastId, shortText } = params;
  if (!forecastId || !shortText?.trim()) return;
  const { error } = await db
    .from("user_daily_forecasts")
    .update({
      recommendation_short_text: shortText.trim(),
      is_corrected_via_dialog: true,
      corrected_at: new Date().toISOString(),
    })
    .eq("id", forecastId);
  if (error) throw error;
}

/**
 * Persist one SUMMARIZE_EVENT outcome: mark the event summarized, store the
 * outcome, and (when there are outcome cells) merge it into the daily matrix.
 * Events that "did not happen" carry no cells and never touch the matrix.
 */
export async function persistSummarizedEvent(params: {
  db: SupabaseClient;
  userId: string;
  event: PlannedEventRow;
  outcomeText: string | null;
  outcomeCells: MatrixCell[];
  nowIso: string;
}): Promise<void> {
  const { db, userId, event, outcomeText, outcomeCells, nowIso } = params;
  const { error } = await db
    .from("planned_events")
    .update({
      status: "summarized",
      summarized_at: nowIso,
      outcome_text: outcomeText,
      outcome_cells: outcomeCells,
    })
    .eq("user_id", userId)
    .eq("id", event.id);
  if (error) throw error;

  if (outcomeCells.length > 0) {
    await mergeSummarizedEventIntoDailyMatrix(db, userId, event.planned_local_date, outcomeCells, nowIso);
    await rebuildProfileReportSnapshot(db, userId, nowIso);
  }
}
