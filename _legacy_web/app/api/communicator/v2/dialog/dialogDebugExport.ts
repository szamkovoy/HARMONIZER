import type { SupabaseClient } from "@supabase/supabase-js";

import { forcedPhaseOrNull, promptLocalHour } from "@legacy/app/api/_utils/testMode";
import { extractRawMarkersForDebug } from "@legacy/app/api/_utils/markers";
import type { DialogBranch } from "@legacy/app/api/_utils/dialogBranching";
import type { DialogDailyContext } from "@legacy/app/api/communicator/v2/dialog/dialogDailyContext";
import { asMatrixCells } from "@legacy/app/api/communicator/v2/dialog/lifeMatrixPersistence";

type PracticePublic = {
  id?: string;
  kind?: string;
  reason?: string | null;
  overrides?: { durationMin?: number | null };
  durationSec?: number | null;
};

export type PlannedEventExportRow = {
  id: string;
  conversation_id: string | null;
  description: string;
  planned_at: string | null;
  planned_local_date: string | null;
  expected_at: string;
  time_phrase_raw: string | null;
  time_resolution: string | null;
  status: string;
  context_snippets: unknown[];
  cells: ReturnType<typeof formatCells>;
  summarized_at?: string | null;
  outcome_text?: string | null;
  outcome_cells?: ReturnType<typeof formatCells> | null;
};

export type PlanningPersistenceTurn = {
  inserted: PlannedEventExportRow[];
  summarized: Array<PlannedEventExportRow & { matched_ref: string | null }>;
  skipped: Array<{
    desc: string;
    time: string | null;
    time_norm: string | null;
    reason: string;
    resolved_local_date: string | null;
  }>;
};

export type TurnDebugExport = {
  raw_markers: ReturnType<typeof extractRawMarkersForDebug>;
  phase_time_used: "morning" | "day" | "evening";
  phase_time_source: "forced" | "real_local_hour";
  local_hour_used: number;
  local_hour_source: "forced" | "real_local_hour";
  matrix_ready: boolean;
  target_chakra: { chakraNumber: number; reason: string };
  branches_active: DialogBranch[];
  due_events_loaded: Array<{
    id: string;
    description: string;
    expected_at: string;
    status: string;
  }>;
  practice_pick: {
    id: string;
    type: string;
    duration_min: number | null;
    reason: string | null;
  } | null;
};

function formatPlannedEventRowForExport(row: Record<string, unknown>): PlannedEventExportRow {
  return {
    id: String(row.id ?? ""),
    conversation_id: typeof row.conversation_id === "string" ? row.conversation_id : null,
    description: String(row.description ?? ""),
    planned_at: typeof row.planned_at === "string" ? row.planned_at : null,
    planned_local_date: typeof row.planned_local_date === "string" ? row.planned_local_date : null,
    expected_at: String(row.expected_at ?? ""),
    time_phrase_raw: typeof row.time_phrase_raw === "string" ? row.time_phrase_raw : null,
    time_resolution: typeof row.time_resolution === "string" ? row.time_resolution : null,
    status: String(row.status ?? ""),
    context_snippets: Array.isArray(row.context_snippets) ? row.context_snippets : [],
    cells: formatCells(row.cells),
    summarized_at: typeof row.summarized_at === "string" ? row.summarized_at : null,
    outcome_text: typeof row.outcome_text === "string" ? row.outcome_text : null,
    outcome_cells: row.outcome_cells ? formatCells(row.outcome_cells) : null,
  };
}

export async function capturePlanningSnapshotIfNeeded(
  db: SupabaseClient,
  userId: string,
  conversationId: string,
  context: DialogDailyContext,
  existingTriggerMeta: Record<string, unknown> | null | undefined,
): Promise<void> {
  if (existingTriggerMeta?.planning_snapshot_at_start) return;

  const { data: openRows, error: openError } = await db
    .from("planned_events")
    .select(
      "id,conversation_id,description,planned_at,planned_local_date,expected_at,time_phrase_raw,time_resolution,status,context_snippets,cells",
    )
    .eq("user_id", userId)
    .eq("status", "planned")
    .order("expected_at", { ascending: true });
  if (openError) throw openError;

  const snapshot = {
    captured_at: new Date().toISOString(),
    due_events_now: context.dueEvents.map((event) => ({
      id: event.id,
      description: event.description,
      expected_at: event.expected_at,
      planned_at: event.planned_at,
      planned_local_date: event.planned_local_date,
      time_phrase_raw: event.time_phrase_raw,
      time_resolution: event.time_resolution,
      status: event.status,
      context_snippets: Array.isArray(event.context_snippets) ? event.context_snippets : [],
      cells: formatCells(event.cells),
    })),
    open_plans: ((openRows ?? []) as Array<Record<string, unknown>>).map(formatPlannedEventRowForExport),
  };

  const nextMeta = {
    ...(existingTriggerMeta ?? {}),
    planning_snapshot_at_start: snapshot,
  };
  const { error } = await db
    .from("conversations")
    .update({ trigger_meta: nextMeta })
    .eq("id", conversationId)
    .eq("user_id", userId);
  if (error) throw error;
}

export function buildTurnDebugExport(params: {
  rawAssistantText: string;
  context: DialogDailyContext;
  branches: DialogBranch[];
  practicePublic: PracticePublic | null;
}): TurnDebugExport {
  const { context, branches, practicePublic, rawAssistantText } = params;
  let practicePick: TurnDebugExport["practice_pick"] = null;
  if (practicePublic?.id) {
    const durationMin =
      practicePublic.overrides?.durationMin ??
      (practicePublic.durationSec != null ? Math.round(practicePublic.durationSec / 60) : null);
    practicePick = {
      id: practicePublic.id,
      type: practicePublic.kind ?? "unknown",
      duration_min: durationMin,
      reason: practicePublic.reason ?? null,
    };
  }

  return {
    raw_markers: extractRawMarkersForDebug(rawAssistantText),
    phase_time_used: context.phaseTime,
    phase_time_source: forcedPhaseOrNull() ? "forced" : "real_local_hour",
    local_hour_used: promptLocalHour(context.nowLocal.hour),
    local_hour_source: forcedPhaseOrNull() ? "forced" : "real_local_hour",
    matrix_ready: context.matrixReady,
    target_chakra: {
      chakraNumber: context.targetChakra.chakraNumber,
      reason: context.targetChakra.reason,
    },
    branches_active: [...branches],
    due_events_loaded: context.dueEvents.map((event) => ({
      id: event.id,
      description: event.description,
      expected_at: event.expected_at,
      status: event.status,
    })),
    practice_pick: practicePick,
  };
}

function formatCells(value: unknown) {
  return asMatrixCells(value);
}

export async function buildDialogStateAfter(
  db: SupabaseClient,
  userId: string,
  conversationId: string | null,
  context: DialogDailyContext,
): Promise<Record<string, unknown>> {
  const forecast = context.forecast;
  const cutoffIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const { data: plannedRows, error: plannedError } = await db
    .from("planned_events")
    .select(
      "id,conversation_id,description,planned_at,planned_local_date,expected_at,time_phrase_raw,time_resolution,status,context_snippets,cells,summarized_at,outcome_text,outcome_cells",
    )
    .eq("user_id", userId)
    .gte("planned_at", cutoffIso)
    .order("planned_at", { ascending: false });
  if (plannedError) throw plannedError;

  const { data: conversationRow, error: conversationError } = conversationId
    ? await db
      .from("conversations")
      .select("trigger_meta")
      .eq("user_id", userId)
      .eq("id", conversationId)
      .maybeSingle()
    : { data: null, error: null };
  if (conversationError) throw conversationError;

  const formattedPlannedRows = ((plannedRows ?? []) as Array<Record<string, unknown>>).map(formatPlannedEventRowForExport);
  const openPlansNow = formattedPlannedRows.filter((row) => row.status === "planned");
  const closedPlansRecent = formattedPlannedRows.filter((row) => row.status === "summarized" || row.status === "expired");
  const createdInConversation = conversationId
    ? formattedPlannedRows.filter((row) => row.conversation_id === conversationId)
    : [];
  const planningSnapshotAtStart =
    (conversationRow?.trigger_meta as { planning_snapshot_at_start?: unknown } | null | undefined)?.planning_snapshot_at_start
    ?? null;

  const { data: matrixRow, error: matrixError } = await db
    .from("daily_matrices")
    .select("local_date,source,matrix,events_count,range_metric")
    .eq("user_id", userId)
    .eq("local_date", context.localDate)
    .maybeSingle();
  if (matrixError) throw matrixError;

  const { data: conversationSummaryRow, error: conversationSummaryError } = conversationId
    ? await db
      .from("conversation_summaries")
      .select("generated_at,branch,phase_time,related_event_ids,matrix_cells,summary_text")
      .eq("user_id", userId)
      .eq("conversation_id", conversationId)
      .maybeSingle()
    : { data: null, error: null };
  if (conversationSummaryError) throw conversationSummaryError;

  return {
    conversation_id: conversationId,
    context_snapshot: {
      local_date: context.localDate,
      phase_time: context.phaseTime,
      matrix_ready: context.matrixReady,
      target_chakra: context.targetChakra,
      top3_planets: context.top3Planets.map((petal) => ({
        planet: petal.planet,
        chakra_number: petal.chakra_number,
        importance: petal.importance,
        strength: petal.strength,
        harmoniousness: petal.harmoniousness,
      })),
      due_events_now: context.dueEvents.map((event) => ({
        id: event.id,
        description: event.description,
        expected_at: event.expected_at,
        planned_at: event.planned_at,
        planned_local_date: event.planned_local_date,
        time_phrase_raw: event.time_phrase_raw,
        time_resolution: event.time_resolution,
        status: event.status,
        context_snippets: Array.isArray(event.context_snippets) ? event.context_snippets : [],
        cells: formatCells(event.cells),
      })),
    },
    user_daily_forecast: forecast
      ? {
          forecast_date: forecast.forecast_date ?? context.localDate,
          day_target_chakra: forecast.day_target_chakra ?? null,
          day_target_reason: forecast.day_target_reason ?? null,
          day_target_fixed_at: forecast.day_target_fixed_at ?? null,
        }
      : null,
    planning_snapshot_at_start: planningSnapshotAtStart,
    planning_open_now: openPlansNow,
    planning_closed_recent_48h: closedPlansRecent,
    planning_created_in_this_conversation: createdInConversation,
    planned_events_recent_48h: formattedPlannedRows,
    daily_matrix_today: matrixRow
      ? {
          local_date: matrixRow.local_date,
          source: matrixRow.source,
          events_count: matrixRow.events_count,
          matrix: matrixRow.matrix,
          range_metric: matrixRow.range_metric ?? null,
        }
      : null,
    conversation_summary_for_exported_conversation: conversationSummaryRow
      ? {
          generated_at: conversationSummaryRow.generated_at ?? null,
          branch: conversationSummaryRow.branch ?? null,
          phase_time: conversationSummaryRow.phase_time ?? null,
          related_event_ids: Array.isArray(conversationSummaryRow.related_event_ids)
            ? conversationSummaryRow.related_event_ids
            : [],
          matrix_cells: formatCells(conversationSummaryRow.matrix_cells),
          summary_text: conversationSummaryRow.summary_text ?? null,
        }
      : null,
  };
}
