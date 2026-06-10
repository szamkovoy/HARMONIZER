import type { SupabaseClient } from "@supabase/supabase-js";

import {
  asPlanningSphereCells,
  buildDailyMatrix,
  buildLifeMatrixReportSnapshot,
  computeRangeMetric,
  normalizePlanningSphereCells,
  normalizeCells,
  parseCompactCells,
  type CalendarTrendPoint,
  type DailyMatrixSource,
  type DenseMatrix,
  type MatrixCell,
} from "@legacy/app/api/_utils/lifeMatrix";
import { samePlannedEventIdentity } from "@legacy/app/api/_utils/plannedEventInference";

export const PROFILE_REPORT_SNAPSHOT_VERSION = 3;

export type PlannedEventRow = {
  id: string;
  conversation_id?: string | null;
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
  recommendation_text?: string | null;
  display_order?: number | null;
  explicit_time_text?: string | null;
};

export type ProfileReportSnapshot = {
  activeDaysCount: number;
  rawMatrix: DenseMatrix;
  visualMatrix: DenseMatrix;
  calendarTrend: CalendarTrendPoint[];
  lastRolledDate: string | null;
  snapshotVersion: number;
};

export type LifeMatrixReadinessMeta = {
  activeDaysCount: number;
  summarizedEventsCount: number;
  firstSummaryLocalDate: string | null;
  lastSummaryLocalDate: string | null;
};

export function asMatrixCells(value: unknown): MatrixCell[] {
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

function asDenseMatrix(value: unknown): DenseMatrix | null {
  if (!Array.isArray(value)) return null;
  const rows = value
    .map((row) => (Array.isArray(row) ? row.map((cell) => Number(cell) || 0) : null))
    .filter((row): row is number[] => Array.isArray(row));
  return rows.length > 0 ? rows : null;
}

function asCalendarTrendPoints(value: unknown): CalendarTrendPoint[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const localDate = typeof (item as { localDate?: unknown }).localDate === "string"
        ? (item as { localDate: string }).localDate
        : null;
      const rangeMetric = Number((item as { rangeMetric?: unknown }).rangeMetric);
      if (!localDate || !Number.isFinite(rangeMetric)) return null;
      return { localDate, rangeMetric } satisfies CalendarTrendPoint;
    })
    .filter((item): item is CalendarTrendPoint => Boolean(item));
}

function mergeUniqueStrings(existing: string[], incoming: string[]): string[] {
  return [...new Set([...existing, ...incoming].filter((value) => value.trim()))];
}

function mergeUnknownArrays(left: unknown, right: unknown): unknown[] {
  const values = [
    ...(Array.isArray(left) ? left : []),
    ...(Array.isArray(right) ? right : []),
  ];
  const seen = new Set<string>();
  const merged: unknown[] = [];
  for (const value of values) {
    const key = JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(value);
  }
  return merged;
}

function minuteKey(iso: string): string {
  const parsed = new Date(Date.parse(iso));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 16) : iso;
}

function isSemanticallyDuplicatePlannedRow(left: PlannedEventRow, right: PlannedEventRow): boolean {
  if (left.status !== "planned" || right.status !== "planned") return false;
  if (left.planned_local_date !== right.planned_local_date) return false;
  if (!samePlannedEventIdentity(left.description, right.description)) return false;
  return (
    minuteKey(left.expected_at) === minuteKey(right.expected_at)
    || left.time_resolution !== "explicit"
    || right.time_resolution !== "explicit"
  );
}

function rowQualityScore(row: PlannedEventRow): number {
  const explicitScore = row.time_resolution === "explicit" ? 1000 : row.time_resolution === "daypart_default" ? 100 : 10;
  const cellScore = asPlanningSphereCells(row.cells).length * 20;
  const snippetScore = (Array.isArray(row.context_snippets) ? row.context_snippets.length : 0) * 5;
  const descriptionScore = row.description.trim().length;
  const plannedAtScore = Date.parse(row.planned_at);
  return explicitScore + cellScore + snippetScore + descriptionScore + (Number.isFinite(plannedAtScore) ? plannedAtScore / 1_000_000_000_000 : 0);
}

function collapseDuplicatePlannedRows(rows: PlannedEventRow[]): PlannedEventRow[] {
  const collapsed: PlannedEventRow[] = [];
  for (const row of rows) {
    const duplicateIndex = collapsed.findIndex((existing) => isSemanticallyDuplicatePlannedRow(existing, row));
    if (duplicateIndex < 0) {
      collapsed.push(row);
      continue;
    }
    const existing = collapsed[duplicateIndex]!;
    const keepIncoming = rowQualityScore(row) >= rowQualityScore(existing);
    const keeper = keepIncoming ? row : existing;
    const shadow = keepIncoming ? existing : row;
    collapsed[duplicateIndex] = {
      ...keeper,
      context_snippets: mergeUnknownArrays(keeper.context_snippets, shadow.context_snippets),
      cells: normalizePlanningSphereCells([...asPlanningSphereCells(keeper.cells), ...asPlanningSphereCells(shadow.cells)]),
    };
  }
  return collapsed;
}

export async function expireStalePlannedEvents(db: SupabaseClient, userId: string, nowIso: string): Promise<string[]> {
  void db;
  void userId;
  void nowIso;
  return [];
}

export async function purgeHistoricalSummarizedPlannedEvents(
  db: SupabaseClient,
  userId: string,
  currentLocalDate: string,
): Promise<void> {
  const { error } = await db
    .from("planned_events")
    .delete()
    .eq("user_id", userId)
    .eq("status", "summarized")
    .lt("planned_local_date", currentLocalDate);
  if (error) throw error;
}

export async function deletePlannedEventsByIds(
  db: SupabaseClient,
  userId: string,
  eventIds: string[],
  nowIso: string,
): Promise<string[]> {
  const uniqueIds = [...new Set(eventIds.filter(Boolean))];
  if (!uniqueIds.length) return [];

  const { data, error } = await db
    .from("planned_events")
    .select("id,planned_local_date")
    .eq("user_id", userId)
    .eq("status", "planned")
    .in("id", uniqueIds);
  if (error) throw error;

  const plannedRows = (data ?? []) as Array<{ id: string; planned_local_date: string }>;
  if (!plannedRows.length) return [];

  const { error: deleteError } = await db
    .from("planned_events")
    .delete()
    .eq("user_id", userId)
    .in("id", plannedRows.map((row) => row.id));
  if (deleteError) throw deleteError;

  const affectedDates = [...new Set(plannedRows.map((row) => row.planned_local_date).filter(Boolean))];
  for (const localDate of affectedDates) {
    await upsertDailyMatrixForDate(db, userId, localDate, nowIso);
  }
  return plannedRows.map((row) => row.id);
}

export async function loadDuePlannedEvents(
  db: SupabaseClient,
  userId: string,
  beforeLocalDate: string,
): Promise<PlannedEventRow[]> {
  const { data, error } = await db
    .from("planned_events")
    .select("id,description,expected_at,planned_at,planned_local_date,status,time_phrase_raw,time_resolution,context_snippets,cells,outcome_cells,outcome_text,recommendation_text,display_order,explicit_time_text")
    .eq("user_id", userId)
    .eq("status", "planned")
    .lt("planned_local_date", beforeLocalDate)
    .order("planned_local_date", { ascending: false })
    .order("display_order", { ascending: true, nullsFirst: false })
    .order("planned_at", { ascending: true });
  if (error) throw error;
  const collapsed = collapseDuplicatePlannedRows((data ?? []) as PlannedEventRow[]);
  const latestLocalDate = collapsed[0]?.planned_local_date ?? null;
  return latestLocalDate ? collapsed.filter((row) => row.planned_local_date === latestLocalDate) : [];
}

export async function loadPlannedEventsForLocalDate(
  db: SupabaseClient,
  userId: string,
  localDate: string,
): Promise<PlannedEventRow[]> {
  const { data, error } = await db
    .from("planned_events")
    .select("id,description,expected_at,planned_at,planned_local_date,status,time_phrase_raw,time_resolution,context_snippets,cells,outcome_cells,outcome_text,recommendation_text,display_order,explicit_time_text,conversation_id")
    .eq("user_id", userId)
    .eq("planned_local_date", localDate)
    .eq("status", "planned")
    .order("display_order", { ascending: true, nullsFirst: false })
    .order("planned_at", { ascending: true });
  if (error) throw error;
  return collapseDuplicatePlannedRows((data ?? []) as PlannedEventRow[]);
}

export async function loadPlannedEventsUpToLocalDate(
  db: SupabaseClient,
  userId: string,
  localDate: string,
): Promise<PlannedEventRow[]> {
  const { data, error } = await db
    .from("planned_events")
    .select("id,description,expected_at,planned_at,planned_local_date,status,time_phrase_raw,time_resolution,context_snippets,cells,outcome_cells,outcome_text,recommendation_text,display_order,explicit_time_text,conversation_id")
    .eq("user_id", userId)
    .eq("status", "planned")
    .lte("planned_local_date", localDate)
    .order("planned_local_date", { ascending: true })
    .order("display_order", { ascending: true, nullsFirst: false })
    .order("planned_at", { ascending: true });
  if (error) throw error;
  return collapseDuplicatePlannedRows((data ?? []) as PlannedEventRow[]);
}

export async function loadOpenPlannedEventsForConversation(
  db: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<PlannedEventRow[]> {
  const { data, error } = await db
    .from("planned_events")
    .select("id,description,expected_at,planned_at,planned_local_date,status,time_phrase_raw,time_resolution,context_snippets,cells,outcome_cells,outcome_text,recommendation_text,display_order,explicit_time_text,conversation_id")
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .eq("status", "planned");
  if (error) throw error;
  return collapseDuplicatePlannedRows((data ?? []) as PlannedEventRow[]);
}

export async function loadOpenPlannedEventsForUserHorizon(
  db: SupabaseClient,
  userId: string,
  localDates: string[],
): Promise<PlannedEventRow[]> {
  const uniqueDates = [...new Set(localDates.filter(Boolean))];
  if (!uniqueDates.length) return [];
  const { data, error } = await db
    .from("planned_events")
    .select("id,description,expected_at,planned_at,planned_local_date,status,time_phrase_raw,time_resolution,context_snippets,cells,outcome_cells,outcome_text,recommendation_text,display_order,explicit_time_text,conversation_id")
    .eq("user_id", userId)
    .eq("status", "planned")
    .in("planned_local_date", uniqueDates);
  if (error) throw error;
  return collapseDuplicatePlannedRows((data ?? []) as PlannedEventRow[]);
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

export async function loadLifeMatrixReadinessMeta(
  db: SupabaseClient,
  userId: string,
): Promise<LifeMatrixReadinessMeta> {
  const { data, error } = await db
    .from("daily_matrices")
    .select("local_date,events_count")
    .eq("user_id", userId)
    .eq("source", "summary")
    .order("local_date", { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as Array<{ local_date: string; events_count: number | null }>;
  return {
    activeDaysCount: rows.length,
    summarizedEventsCount: rows.reduce((sum, row) => sum + (Number.isFinite(Number(row.events_count)) ? Number(row.events_count) : 0), 0),
    firstSummaryLocalDate: rows[0]?.local_date ?? null,
    lastSummaryLocalDate: rows.at(-1)?.local_date ?? null,
  };
}

export async function upsertDailyMatrixForDate(db: SupabaseClient, userId: string, localDate: string, nowIso: string): Promise<{
  matrix: number[][];
  source: DailyMatrixSource;
  eventsCount: number;
  rangeMetric: number | null;
} | null> {
  const [{ data, error }, { data: existingRow, error: existingError }] = await Promise.all([
    db
      .from("planned_events")
      .select("id,status,expected_at,planned_local_date,cells,outcome_cells")
      .eq("user_id", userId)
      .eq("planned_local_date", localDate),
    db
      .from("daily_matrices")
      .select("matrix,source,events_count,range_metric")
      .eq("user_id", userId)
      .eq("local_date", localDate)
      .maybeSingle(),
  ]);
  if (error) throw error;
  if (existingError) throw existingError;

  const rows = (data ?? []) as Array<{
    id: string;
    status: string;
    expected_at: string;
    planned_local_date: string;
    cells: unknown;
    outcome_cells: unknown;
  }>;

  const summarized = rows
    .filter((row) => row.status === "summarized")
    .map((row) => ({ id: row.id, outcome_cells: row.outcome_cells }))
    .filter((row) => asMatrixCells(row.outcome_cells).length > 0);
  let source: DailyMatrixSource | null = null;
  let cellsCollections: MatrixCell[][] = [];
  if (summarized.length > 0) {
    source = "summary";
    cellsCollections = summarized.map((row) => asMatrixCells(row.outcome_cells));
  } else if ((existingRow as { source?: unknown } | null)?.source === "summary") {
    const persistedMatrix = asDenseMatrix((existingRow as { matrix?: unknown } | null)?.matrix);
    const persistedRangeMetric = (existingRow as { range_metric?: unknown } | null)?.range_metric;
    const persistedEventsCount = Number((existingRow as { events_count?: unknown } | null)?.events_count);
    if (persistedMatrix) {
      return {
        matrix: persistedMatrix,
        source: "summary",
        eventsCount: Number.isFinite(persistedEventsCount) ? persistedEventsCount : 0,
        rangeMetric: typeof persistedRangeMetric === "number" ? persistedRangeMetric : computeRangeMetric(persistedMatrix),
      };
    }
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

export async function mergeSummarizedEventIntoDailyMatrix(
  db: SupabaseClient,
  userId: string,
  localDate: string,
  outcomeCells: MatrixCell[],
  nowIso: string,
): Promise<{
  matrix: DenseMatrix;
  rangeMetric: number | null;
  eventsCount: number;
}> {
  const eventMatrix = buildDailyMatrix([outcomeCells]);
  const { data, error } = await db
    .from("daily_matrices")
    .select("matrix,source,events_count")
    .eq("user_id", userId)
    .eq("local_date", localDate)
    .maybeSingle();
  if (error) throw error;

  const existingSource = (data as { source?: unknown } | null)?.source;
  const existingMatrix = existingSource === "summary" ? asDenseMatrix((data as { matrix?: unknown } | null)?.matrix) : null;
  const existingEventsCount = Number((data as { events_count?: unknown } | null)?.events_count);
  const nextMatrix = existingMatrix ? buildDailyMatrix([]) : eventMatrix;

  if (existingMatrix) {
    for (let row = 0; row < existingMatrix.length; row += 1) {
      for (let col = 0; col < (existingMatrix[row]?.length ?? 0); col += 1) {
        nextMatrix[row]![col] = Number(((existingMatrix[row]?.[col] ?? 0) + (eventMatrix[row]?.[col] ?? 0)).toFixed(6));
      }
    }
  }

  const eventsCount = existingMatrix && Number.isFinite(existingEventsCount) ? existingEventsCount + 1 : 1;
  const rangeMetric = computeRangeMetric(nextMatrix);
  const { error: upsertError } = await db.from("daily_matrices").upsert({
    user_id: userId,
    local_date: localDate,
    source: "summary",
    matrix: nextMatrix,
    events_count: eventsCount,
    range_metric: rangeMetric,
    updated_at: nowIso,
  }, { onConflict: "user_id,local_date" });
  if (upsertError) throw upsertError;

  return { matrix: nextMatrix, rangeMetric, eventsCount };
}

export async function rebuildProfileReportSnapshot(
  db: SupabaseClient,
  userId: string,
  nowIso: string,
): Promise<ProfileReportSnapshot> {
  const { data, error } = await db
    .from("daily_matrices")
    .select("local_date,matrix")
    .eq("user_id", userId)
    .eq("source", "summary")
    .order("local_date", { ascending: true });
  if (error) throw error;

  const rows = ((data ?? []) as Array<{ local_date: string; matrix: unknown }>)
    .map((row) => {
      const matrix = asDenseMatrix(row.matrix);
      if (!matrix) return null;
      return { localDate: row.local_date, matrix };
    })
    .filter((row): row is { localDate: string; matrix: DenseMatrix } => Boolean(row));

  const snapshot = buildLifeMatrixReportSnapshot(rows);
  const { error: upsertError } = await db.from("profile_report_snapshots").upsert({
    user_id: userId,
    active_days_count: snapshot.activeDaysCount,
    cumulative_matrix: snapshot.rawMatrix,
    visual_matrix: snapshot.visualMatrix,
    life_line_points: snapshot.calendarTrend,
    last_rolled_date: snapshot.lastRolledDate,
    snapshot_version: PROFILE_REPORT_SNAPSHOT_VERSION,
    updated_at: nowIso,
  }, { onConflict: "user_id" });
  if (upsertError) throw upsertError;

  return {
    ...snapshot,
    snapshotVersion: PROFILE_REPORT_SNAPSHOT_VERSION,
  };
}

export async function loadOrRebuildProfileReportSnapshot(
  db: SupabaseClient,
  userId: string,
  nowIso: string,
): Promise<ProfileReportSnapshot> {
  const { data, error } = await db
    .from("profile_report_snapshots")
    .select("active_days_count,cumulative_matrix,visual_matrix,life_line_points,last_rolled_date,snapshot_version")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;

  const activeDaysCount = Number((data as { active_days_count?: unknown } | null)?.active_days_count);
  const rawMatrix = asDenseMatrix((data as { cumulative_matrix?: unknown } | null)?.cumulative_matrix);
  const visualMatrix = asDenseMatrix((data as { visual_matrix?: unknown } | null)?.visual_matrix);
  const calendarTrend = asCalendarTrendPoints((data as { life_line_points?: unknown } | null)?.life_line_points);
  const lastRolledDate = typeof (data as { last_rolled_date?: unknown } | null)?.last_rolled_date === "string"
    ? (data as { last_rolled_date: string }).last_rolled_date
    : null;
  const snapshotVersion = Number((data as { snapshot_version?: unknown } | null)?.snapshot_version);

  if (
    Number.isFinite(activeDaysCount)
    && rawMatrix
    && visualMatrix
    && Number.isFinite(snapshotVersion)
    && snapshotVersion === PROFILE_REPORT_SNAPSHOT_VERSION
  ) {
    return {
      activeDaysCount,
      rawMatrix,
      visualMatrix,
      calendarTrend,
      lastRolledDate,
      snapshotVersion,
    };
  }

  return rebuildProfileReportSnapshot(db, userId, nowIso);
}

/** Drop free-text planning artifacts once the daily matrix snapshot is stored. */
export async function scrubPlannedEventTextAfterMatrix(
  db: SupabaseClient,
  userId: string,
  localDate: string,
): Promise<void> {
  const { error } = await db
    .from("planned_events")
    .update({
      context_snippets: [],
      outcome_text: null,
    })
    .eq("user_id", userId)
    .eq("planned_local_date", localDate)
    .in("status", ["expired", "dismissed"]);
  if (error) throw error;
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
  const { error } = await db.from("conversation_summaries").upsert(
    {
      user_id: payload.userId,
      conversation_id: payload.conversationId,
      summary_text: `[${payload.branch}:${payload.phaseTime}]`,
      key_topics: [],
      chakras_mentioned: [...new Set(payload.matrixCells.map((cell) => cell.chakra))].sort((a, b) => a - b),
      practices_mentioned: [],
      plans: [],
      branch: payload.branch,
      phase_time: payload.phaseTime,
      related_event_ids: payload.relatedEventIds,
      matrix_cells: payload.matrixCells,
    },
    { onConflict: "conversation_id" },
  );
  if (error) throw error;
}
