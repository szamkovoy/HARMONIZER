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

export type PersistedSummarizedEvent = {
  id: string;
  title: string;
  displayOrder: number | null;
  summarizedAt: string;
  appliedToMatrix: boolean;
  outcomeCells: MatrixCell[];
};

export type DismissedPlannedEvent = {
  id: string;
  title: string;
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
  appendToExisting?: boolean;
  deleteOrphans?: boolean;
}): Promise<PersistedPlannedEvent[]> {
  const {
    db,
    userId,
    conversationId,
    workingLocalDate,
    timezone,
    nowIso,
    markers,
    appendToExisting,
    deleteOrphans = false,
  } = params;
  if (markers.length === 0) return [];

  const existing = await loadPlannedEventsForLocalDate(db, userId, workingLocalDate);
  let appendOrderOffset = 0;
  if (appendToExisting) {
    const { data: allRows, error: allRowsError } = await db
      .from("planned_events")
      .select("display_order")
      .eq("user_id", userId)
      .eq("planned_local_date", workingLocalDate)
      .order("display_order", { ascending: false, nullsFirst: false })
      .limit(1);
    if (allRowsError) throw allRowsError;
    const maxDisplayOrder = Number((allRows ?? [])[0]?.display_order);
    appendOrderOffset = Number.isFinite(maxDisplayOrder) ? maxDisplayOrder : existing.length;
  }
  const expectedAt = endOfLocalDayIso(workingLocalDate, timezone);
  const results: PersistedPlannedEvent[] = [];
  const seenMarkerIndexes = new Set<number>();
  let order = 0;

  for (const marker of markers) {
    const duplicateIndex = markers.findIndex((candidate) => samePlannedEventIdentity(candidate.desc, marker.desc));
    if (duplicateIndex !== -1 && seenMarkerIndexes.has(duplicateIndex)) continue;
    if (duplicateIndex !== -1) seenMarkerIndexes.add(duplicateIndex);
    order += 1;
    const cells: PlanningSphereCell[] = normalizePlanningSphereCells(marker.cells);
    const match: PlannedEventRow | undefined = existing.find(
      (row) => row.status === "planned" && samePlannedEventIdentity(row.description, marker.desc),
    );
    const baseDisplayOrder = Number.isInteger(marker.displayOrder) ? Number(marker.displayOrder) : order;
    const displayOrder = appendToExisting && !match
      ? appendOrderOffset + order
      : baseDisplayOrder;

    if (match) {
      const resolvedDisplayOrder = appendToExisting ? (match.display_order ?? displayOrder) : displayOrder;
      const { error } = await db
        .from("planned_events")
        .update({
          description: marker.desc,
          recommendation_text: marker.recommendation,
          display_order: resolvedDisplayOrder,
          cells,
        })
        .eq("user_id", userId)
        .eq("id", match.id);
      if (error) throw error;
      results.push({ id: match.id, desc: marker.desc, displayOrder: resolvedDisplayOrder, action: "updated" });
      match.description = marker.desc;
      match.recommendation_text = marker.recommendation;
      match.display_order = resolvedDisplayOrder;
      match.cells = cells;
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
    existing.push({
      id: (data?.id as string) ?? `pending:${results.length}`,
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
      outcome_cells: null,
      outcome_text: null,
      recommendation_text: marker.recommendation,
      display_order: displayOrder,
      explicit_time_text: null,
    });
  }

  // On the main finalize (not the incremental add-flow), remove any "planned"
  // rows from THIS conversation that the finalize did not touch. They are stale
  // incremental-save rows the model later reworded (so fuzzy identity matching
  // missed them), which otherwise surface as duplicates in the Day tab — e.g.
  // "Работа над результатами" (early save) + "Поработать для результатов" (final).
  if (!appendToExisting && deleteOrphans) {
    const touchedIds = new Set(
      results.map((item) => item.id).filter((id): id is string => typeof id === "string" && id.length > 0),
    );
    if (touchedIds.size > 0) {
      const orphanIds = existing
        .filter(
          (row) =>
            row.status === "planned"
            && row.conversation_id === conversationId
            && typeof row.id === "string"
            && !row.id.startsWith("pending:")
            && !touchedIds.has(row.id),
        )
        .map((row) => row.id);
      if (orphanIds.length > 0) {
        const { error: cleanupError } = await db
          .from("planned_events")
          .delete()
          .eq("user_id", userId)
          .in("id", orphanIds);
        if (cleanupError) throw cleanupError;
      }
    }
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
 * Persist one SUMMARIZE_EVENT outcome inside the same `planned_events` entity:
 * mark the event summarized and keep it visible until the local day changes.
 */
export async function persistSummarizedEvent(params: {
  db: SupabaseClient;
  userId: string;
  event: PlannedEventRow;
  outcomeText: string | null;
  outcomeCells: MatrixCell[];
  nowIso: string;
  deleteAfterPersist?: boolean;
}): Promise<PersistedSummarizedEvent> {
  const { db, userId, event, outcomeText, outcomeCells, nowIso, deleteAfterPersist = false } = params;
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

  if (deleteAfterPersist) {
    const { error: deleteError } = await db
      .from("planned_events")
      .delete()
      .eq("user_id", userId)
      .eq("id", event.id)
      .eq("status", "summarized");
    if (deleteError) throw deleteError;
  }

  return {
    id: event.id,
    title: event.description,
    displayOrder: event.display_order ?? null,
    summarizedAt: nowIso,
    appliedToMatrix: outcomeCells.length > 0,
    outcomeCells,
  };
}

/**
 * Lightweight cancellation: mark still-open (planned, not yet summarized)
 * events for the working day as `dismissed` so they drop out of the Day tab
 * (which only reads `planned`/`summarized`). Each ref is fuzzy-matched against
 * open rows; already-summarized events are never touched.
 */
export async function dismissPlannedEvents(params: {
  db: SupabaseClient;
  userId: string;
  workingLocalDate: string;
  refs: string[];
}): Promise<DismissedPlannedEvent[]> {
  const { db, userId, workingLocalDate, refs } = params;
  const cleanedRefs = refs.map((ref) => ref.trim()).filter(Boolean);
  if (cleanedRefs.length === 0) return [];

  const existing = await loadPlannedEventsForLocalDate(db, userId, workingLocalDate);
  const open = existing.filter((row) => row.status === "planned");
  if (open.length === 0) return [];

  const dismissedIds = new Set<string>();
  const dismissed: DismissedPlannedEvent[] = [];
  for (const ref of cleanedRefs) {
    const match = open.find(
      (row) => !dismissedIds.has(row.id) && samePlannedEventIdentity(row.description, ref),
    );
    if (!match) continue;
    dismissedIds.add(match.id);
    dismissed.push({ id: match.id, title: match.description });
  }
  if (dismissed.length === 0) return [];

  const { error } = await db
    .from("planned_events")
    .update({ status: "dismissed" })
    .eq("user_id", userId)
    .in("id", Array.from(dismissedIds))
    .eq("status", "planned");
  if (error) throw error;

  return dismissed;
}
