import type { SupabaseClient } from "@supabase/supabase-js";

import { buildDailyMatrix, computeRangeMetric, normalizeCells, parseCompactCells, type DailyMatrixSource, type MatrixCell } from "@legacy/app/api/_utils/lifeMatrix";

const PLANNED_EVENT_EXPIRY_HOURS = 36;

export type PlannedEventRow = {
  id: string;
  description: string;
  expected_at: string;
  planned_at: string;
  planned_local_date: string;
  status: string;
  time_phrase_raw: string | null;
  time_resolution: string;
  context_snippets: unknown;
  cells: unknown;
  outcome_cells: unknown;
  outcome_text: string | null;
};

function asMatrixCells(value: unknown): MatrixCell[] {
  if (typeof value === "string") return parseCompactCells(value);
  if (!Array.isArray(value)) return [];
  return normalizeCells(
    value.map((item) => ({
      sphere: Number((item as { sphere?: unknown }).sphere),
      chakra: Number((item as { chakra?: unknown }).chakra),
      weight: Number((item as { weight?: unknown }).weight),
    })),
  );
}

function mergeUniqueStrings(existing: string[], incoming: string[]): string[] {
  return [...new Set([...existing, ...incoming].filter((value) => value.trim()))];
}

export async function expireStalePlannedEvents(db: SupabaseClient, userId: string, nowIso: string): Promise<string[]> {
  const cutoffIso = new Date(Date.parse(nowIso) - PLANNED_EVENT_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("planned_events")
    .update({ status: "expired", updated_at: nowIso })
    .eq("user_id", userId)
    .eq("status", "planned")
    .lt("planned_at", cutoffIso)
    .select("id");
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
}

export async function loadDuePlannedEvents(db: SupabaseClient, userId: string, nowIso: string): Promise<PlannedEventRow[]> {
  const cutoffIso = new Date(Date.parse(nowIso) - PLANNED_EVENT_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("planned_events")
    .select("id,description,expected_at,planned_at,planned_local_date,status,time_phrase_raw,time_resolution,context_snippets,cells,outcome_cells,outcome_text")
    .eq("user_id", userId)
    .eq("status", "planned")
    .lte("expected_at", nowIso)
    .gte("planned_at", cutoffIso)
    .order("expected_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PlannedEventRow[];
}

export async function loadLastPlanningSummary(db: SupabaseClient, userId: string): Promise<{ generated_at: string | null } | null> {
  const { data, error } = await db
    .from("conversation_summaries")
    .select("generated_at")
    .eq("user_id", userId)
    .in("branch", ["planning", "both"])
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as { generated_at: string | null } | null) ?? null;
}

export async function upsertDailyMatrixForDate(db: SupabaseClient, userId: string, localDate: string, nowIso: string): Promise<{
  matrix: number[][];
  source: DailyMatrixSource;
  eventsCount: number;
  rangeMetric: number | null;
} | null> {
  const { data, error } = await db
    .from("planned_events")
    .select("id,status,expected_at,planned_local_date,cells,outcome_cells")
    .eq("user_id", userId)
    .eq("planned_local_date", localDate);
  if (error) throw error;

  const rows = (data ?? []) as Array<{
    id: string;
    status: string;
    expected_at: string;
    planned_local_date: string;
    cells: unknown;
    outcome_cells: unknown;
  }>;

  const summarized = rows.filter((row) => row.status === "summarized" && asMatrixCells(row.outcome_cells).length > 0);
  const duePlanned = rows.filter((row) => (row.status === "planned" || row.status === "expired") && row.expected_at <= nowIso && asMatrixCells(row.cells).length > 0);

  let source: DailyMatrixSource | null = null;
  let cellsCollections: MatrixCell[][] = [];
  if (summarized.length > 0) {
    source = "summary";
    cellsCollections = summarized.map((row) => asMatrixCells(row.outcome_cells));
  } else if (duePlanned.length > 0) {
    source = "plan";
    cellsCollections = duePlanned.map((row) => asMatrixCells(row.cells));
  }

  if (!source || cellsCollections.length === 0) {
    await db.from("daily_matrices").delete().eq("user_id", userId).eq("local_date", localDate);
    return null;
  }

  const matrix = buildDailyMatrix(cellsCollections);
  const rangeMetric = computeRangeMetric(matrix);
  const payload = {
    user_id: userId,
    local_date: localDate,
    source,
    matrix,
    events_count: cellsCollections.length,
    range_metric: rangeMetric,
    updated_at: nowIso,
  };

  const { error: upsertError } = await db.from("daily_matrices").upsert(payload, { onConflict: "user_id,local_date" });
  if (upsertError) throw upsertError;

  return {
    matrix,
    source,
    eventsCount: cellsCollections.length,
    rangeMetric,
  };
}

export async function mergeUserProfileMemory(db: SupabaseClient, userId: string, payload: {
  keyFacts?: string[];
  currentGoals?: string[];
  lastPracticeFocusChakras?: number[];
  recentPractices?: Array<{ id: string; kind?: string | null; created_at?: string | null }>;
}): Promise<void> {
  const { data, error } = await db
    .from("user_profile_memory")
    .select("key_facts,current_goals,last_practice_focus_chakras,recent_practices")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;

  const existing = (data as {
    key_facts?: Record<string, string>;
    current_goals?: string[];
    last_practice_focus_chakras?: number[];
    recent_practices?: Array<{ id: string; kind?: string | null; created_at?: string | null }>;
  } | null) ?? null;

  const nowIso = new Date().toISOString();
  const nextFacts = {
    ...(existing?.key_facts ?? {}),
    ...Object.fromEntries((payload.keyFacts ?? []).map((fact) => [fact, nowIso])),
  };
  const nextGoals = mergeUniqueStrings(existing?.current_goals ?? [], payload.currentGoals ?? []);
  const nextChakras = [...new Set([...(existing?.last_practice_focus_chakras ?? []), ...(payload.lastPracticeFocusChakras ?? [])])]
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 7)
    .sort((a, b) => a - b);
  const nextRecentPractices = [...(payload.recentPractices ?? []), ...(existing?.recent_practices ?? [])]
    .filter((item, index, array) => array.findIndex((candidate) => candidate.id === item.id) === index)
    .slice(0, 20);

  const { error: upsertError } = await db.from("user_profile_memory").upsert({
    user_id: userId,
    key_facts: nextFacts,
    current_goals: nextGoals,
    last_practice_focus_chakras: nextChakras,
    recent_practices: nextRecentPractices,
    updated_at: nowIso,
  });
  if (upsertError) throw upsertError;
}

export async function upsertConversationSummary(db: SupabaseClient, payload: {
  userId: string;
  conversationId: string;
  summaryText: string;
  branch: "planning" | "summarizing" | "both" | "free" | "none";
  phaseTime: "morning" | "day" | "evening";
  relatedEventIds: string[];
  matrixCells: MatrixCell[];
}): Promise<void> {
  const { error } = await db.from("conversation_summaries").upsert({
    user_id: payload.userId,
    conversation_id: payload.conversationId,
    summary_text: payload.summaryText,
    key_topics: [],
    chakras_mentioned: [...new Set(payload.matrixCells.map((cell) => cell.chakra))].sort((a, b) => a - b),
    practices_mentioned: [],
    plans: [],
    branch: payload.branch,
    phase_time: payload.phaseTime,
    related_event_ids: payload.relatedEventIds,
    matrix_cells: payload.matrixCells,
  });
  if (error) throw error;
}
