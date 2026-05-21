import type { SupabaseClient } from "@supabase/supabase-js";

import { forcedPhaseOrNull } from "@legacy/app/api/_utils/testMode";
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

export type TurnDebugExport = {
  raw_markers: ReturnType<typeof extractRawMarkersForDebug>;
  phase_time_used: "morning" | "day" | "evening";
  phase_time_source: "forced" | "real_local_hour";
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
      "id,description,planned_at,planned_local_date,expected_at,time_phrase_raw,time_resolution,status,cells,summarized_at,outcome_cells",
    )
    .eq("user_id", userId)
    .gte("planned_at", cutoffIso)
    .order("planned_at", { ascending: false });
  if (plannedError) throw plannedError;

  const { data: matrixRow, error: matrixError } = await db
    .from("daily_matrices")
    .select("local_date,source,matrix,events_count,range_metric")
    .eq("user_id", userId)
    .eq("local_date", context.localDate)
    .maybeSingle();
  if (matrixError) throw matrixError;

  return {
    conversation_id: conversationId,
    user_daily_forecast: forecast
      ? {
          forecast_date: forecast.forecast_date ?? context.localDate,
          day_target_chakra: forecast.day_target_chakra ?? null,
          day_target_reason: forecast.day_target_reason ?? null,
          day_target_fixed_at: forecast.day_target_fixed_at ?? null,
        }
      : null,
    planned_events_recent_48h: ((plannedRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: row.id,
      description: row.description,
      planned_at: row.planned_at,
      planned_local_date: row.planned_local_date,
      expected_at: row.expected_at,
      time_phrase_raw: row.time_phrase_raw ?? null,
      time_resolution: row.time_resolution,
      status: row.status,
      cells: formatCells(row.cells),
      summarized_at: row.summarized_at ?? null,
      outcome_cells: row.outcome_cells ? formatCells(row.outcome_cells) : null,
    })),
    daily_matrix_today: matrixRow
      ? {
          local_date: matrixRow.local_date,
          source: matrixRow.source,
          events_count: matrixRow.events_count,
          matrix: matrixRow.matrix,
          range_metric: matrixRow.range_metric ?? null,
        }
      : null,
  };
}
