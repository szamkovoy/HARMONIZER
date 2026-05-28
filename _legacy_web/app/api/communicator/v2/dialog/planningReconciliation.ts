import type { SupabaseClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";
import { DateTime } from "luxon";

import type { PlannedEventMarker } from "@legacy/app/api/_utils/markers";
import {
  ensureDialogCache,
  generateGeminiJson,
  getModelByHint,
  supportsExplicitLlmCache,
  type GeminiContent,
} from "@legacy/app/api/_utils/gemini";
import { getLifeSpheresBaseline } from "@legacy/app/api/_utils/lifeSpheresBaseline";
import { normalizeCells, type MatrixCell } from "@legacy/app/api/_utils/lifeMatrix";
import { canonicalizeTimeResolution, parseEventTime } from "@legacy/app/api/_utils/timeParser";
import { planningReconciliationDelayMs } from "@legacy/app/api/_utils/testMode";
import {
  asMatrixCells,
  loadOpenPlannedEventsForUserHorizon,
  mergeSummarizedEventIntoDailyMatrix,
  rebuildProfileReportSnapshot,
  type PlannedEventRow,
} from "@legacy/app/api/communicator/v2/dialog/lifeMatrixPersistence";
import type { PlanningPersistenceTurn } from "@legacy/app/api/communicator/v2/dialog/dialogDebugExport";
import { matchPlannedEventAgainstExisting } from "@legacy/app/api/_utils/plannedEventInference";

const require = createRequire(import.meta.url);
const chakraStatesBaseline = require("../../../../../data/chakra_states_baseline.json") as Record<string, {
  chakra_number?: number;
  harmonicStates?: string[];
  dissonantStates?: string[];
  lexical_registers?: { psychological?: string[]; somatic?: string[] };
}>;

const PENDING_PLANNING_META_KEY = "pending_planning_reconciliation";
const LAST_PLANNING_RESULT_META_KEY = "last_planning_reconciliation";

export type PendingPlanningCandidate = {
  candidate_id: string;
  desc: string;
  time: string | null;
  timeNorm: string | null;
  cells: MatrixCell[];
  snippets: string[];
  queued_at: string;
};

export type PendingSummaryCandidate = {
  candidate_id: string;
  event_id: string;
  description: string;
  planned_local_date: string;
  expected_at: string;
  time_phrase_raw: string | null;
  time_resolution: string | null;
  outcome: string | null;
  proposed_outcome_cells: MatrixCell[];
  queued_at: string;
};

export type PendingArtifactState = {
  due_at: string;
  updated_at: string;
  planning_candidates: PendingPlanningCandidate[];
  summary_candidates: PendingSummaryCandidate[];
};

type ReconcileAction = "create_new" | "update_existing" | "ignore";

type ReconcileDecision = {
  candidate_id: string;
  action: ReconcileAction;
  existing_event_id?: string | null;
  normalized_desc?: string | null;
  confidence?: number | null;
  reason?: string | null;
};

type SummaryReconcileDecision = {
  candidate_id: string;
  normalized_outcome?: string | null;
  outcome_cells: MatrixCell[];
  confidence?: number | null;
  reason?: string | null;
};

type SummaryNormalizationDecision = {
  candidate_id: string;
  normalized_outcome?: string | null;
  confidence?: number | null;
  reason?: string | null;
};

type SummaryCellClassification = {
  candidate_id: string;
  outcome_cells: MatrixCell[];
  confidence?: number | null;
  reason?: string | null;
};

export function buildPlanningCandidateParsePhrase(candidate: Pick<PendingPlanningCandidate, "desc" | "time" | "timeNorm">): string {
  const explicitTime = candidate.timeNorm?.trim() || candidate.time?.trim() || "";
  if (!explicitTime) return candidate.desc;
  return `${candidate.desc}. ${explicitTime}`.trim();
}

export function buildSummaryNormalizationSourceText(
  candidate: Pick<PendingSummaryCandidate, "description" | "outcome" | "planned_local_date" | "time_phrase_raw">,
): string {
  const parts = [
    candidate.description?.trim() ? `Событие: ${candidate.description.trim()}.` : null,
    candidate.outcome?.trim() ? `Итог пользователя: ${candidate.outcome.trim()}.` : null,
    candidate.time_phrase_raw?.trim() ? `Когда было: ${candidate.time_phrase_raw.trim()}.` : null,
    candidate.planned_local_date?.trim() ? `Локальная дата: ${candidate.planned_local_date.trim()}.` : null,
  ].filter((value): value is string => Boolean(value));

  return parts.join(" ").trim();
}

export function buildSummaryClassificationCandidate(
  candidate: Pick<PendingSummaryCandidate, "candidate_id" | "description" | "outcome">,
  normalizedOutcome: string | null | undefined,
): {
  candidate_id: string;
  event_description: string;
  normalized_outcome: string;
} {
  return {
    candidate_id: candidate.candidate_id,
    event_description: candidate.description,
    normalized_outcome: normalizedOutcome?.trim() || candidate.outcome?.trim() || candidate.description,
  };
}

function newCandidateId(nowIso: string, index: number): string {
  return `${Date.parse(nowIso)}-${index}-${Math.random().toString(36).slice(2, 8)}`;
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

function normalizePendingCandidate(value: unknown): PendingPlanningCandidate | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const candidateId = typeof raw.candidate_id === "string" && raw.candidate_id.trim()
    ? raw.candidate_id.trim()
    : null;
  const desc = typeof raw.desc === "string" ? raw.desc.trim() : "";
  if (!candidateId || !desc) return null;
  return {
    candidate_id: candidateId,
    desc,
    time: typeof raw.time === "string" && raw.time.trim() ? raw.time.trim() : null,
    timeNorm: typeof raw.timeNorm === "string" && raw.timeNorm.trim() ? raw.timeNorm.trim() : null,
    cells: normalizeCells(asMatrixCells(raw.cells)),
    snippets: Array.isArray(raw.snippets)
      ? raw.snippets.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [],
    queued_at: typeof raw.queued_at === "string" && raw.queued_at.trim() ? raw.queued_at.trim() : new Date().toISOString(),
  };
}

function normalizePendingSummaryCandidate(value: unknown): PendingSummaryCandidate | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const candidateId = typeof raw.candidate_id === "string" && raw.candidate_id.trim()
    ? raw.candidate_id.trim()
    : null;
  const eventId = typeof raw.event_id === "string" && raw.event_id.trim() ? raw.event_id.trim() : null;
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  const plannedLocalDate = typeof raw.planned_local_date === "string" ? raw.planned_local_date.trim() : "";
  const expectedAt = typeof raw.expected_at === "string" ? raw.expected_at.trim() : "";
  if (!candidateId || !eventId || !description || !plannedLocalDate || !expectedAt) return null;
  return {
    candidate_id: candidateId,
    event_id: eventId,
    description,
    planned_local_date: plannedLocalDate,
    expected_at: expectedAt,
    time_phrase_raw: typeof raw.time_phrase_raw === "string" && raw.time_phrase_raw.trim() ? raw.time_phrase_raw.trim() : null,
    time_resolution: typeof raw.time_resolution === "string" && raw.time_resolution.trim() ? raw.time_resolution.trim() : null,
    outcome: typeof raw.outcome === "string" && raw.outcome.trim() ? raw.outcome.trim() : null,
    proposed_outcome_cells: normalizeCells(asMatrixCells(raw.proposed_outcome_cells)),
    queued_at: typeof raw.queued_at === "string" && raw.queued_at.trim() ? raw.queued_at.trim() : new Date().toISOString(),
  };
}

export function readPendingArtifactState(triggerMeta: Record<string, unknown> | null | undefined): PendingArtifactState | null {
  const raw = triggerMeta?.[PENDING_PLANNING_META_KEY];
  if (!raw || typeof raw !== "object") return null;
  const state = raw as Record<string, unknown>;
  const dueAt = typeof state.due_at === "string" && state.due_at.trim() ? state.due_at.trim() : null;
  const updatedAt = typeof state.updated_at === "string" && state.updated_at.trim() ? state.updated_at.trim() : null;
  const planningCandidates = Array.isArray(state.planning_candidates)
    ? state.planning_candidates.map(normalizePendingCandidate).filter((item): item is PendingPlanningCandidate => Boolean(item))
    : Array.isArray(state.candidates)
      ? state.candidates.map(normalizePendingCandidate).filter((item): item is PendingPlanningCandidate => Boolean(item))
      : [];
  const summaryCandidates = Array.isArray(state.summary_candidates)
    ? state.summary_candidates.map(normalizePendingSummaryCandidate).filter((item): item is PendingSummaryCandidate => Boolean(item))
    : [];
  if (!dueAt || !updatedAt || (planningCandidates.length === 0 && summaryCandidates.length === 0)) return null;
  return {
    due_at: dueAt,
    updated_at: updatedAt,
    planning_candidates: planningCandidates,
    summary_candidates: summaryCandidates,
  };
}

export function readPendingPlanningState(triggerMeta: Record<string, unknown> | null | undefined): PendingArtifactState | null {
  return readPendingArtifactState(triggerMeta);
}

export function pendingSummaryEventIds(triggerMeta: Record<string, unknown> | null | undefined): Set<string> {
  return new Set((readPendingArtifactState(triggerMeta)?.summary_candidates ?? []).map((item) => item.event_id));
}

function buildPendingArtifactState(
  planningCandidates: PendingPlanningCandidate[],
  summaryCandidates: PendingSummaryCandidate[],
  nowIso: string,
): PendingArtifactState {
  return {
    due_at: new Date(Date.parse(nowIso) + planningReconciliationDelayMs()).toISOString(),
    updated_at: nowIso,
    planning_candidates: planningCandidates,
    summary_candidates: summaryCandidates,
  };
}

async function updateConversationTriggerMeta(
  db: SupabaseClient,
  userId: string,
  conversationId: string,
  triggerMeta: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const nextMeta = {
    ...(triggerMeta ?? {}),
    ...patch,
  };
  const { error } = await db
    .from("conversations")
    .update({ trigger_meta: nextMeta })
    .eq("id", conversationId)
    .eq("user_id", userId);
  if (error) throw error;
  return nextMeta;
}

export async function enqueuePlanningCandidates(params: {
  db: SupabaseClient;
  userId: string;
  conversationId: string;
  triggerMeta: Record<string, unknown> | null | undefined;
  candidates: PlannedEventMarker[];
  nowIso: string;
}): Promise<PendingArtifactState | null> {
  if (!params.candidates.length) return readPendingArtifactState(params.triggerMeta);
  const existingState = readPendingArtifactState(params.triggerMeta);
  const appended = [
    ...(existingState?.planning_candidates ?? []),
    ...params.candidates.map((candidate, index) => ({
      candidate_id: newCandidateId(params.nowIso, index),
      desc: candidate.desc,
      time: candidate.time ?? null,
      timeNorm: candidate.timeNorm ?? null,
      cells: normalizeCells(candidate.cells),
      snippets: candidate.snippets,
      queued_at: params.nowIso,
    })),
  ];
  const nextState = buildPendingArtifactState(
    appended,
    existingState?.summary_candidates ?? [],
    params.nowIso,
  );
  await updateConversationTriggerMeta(
    params.db,
    params.userId,
    params.conversationId,
    params.triggerMeta,
    {
      [PENDING_PLANNING_META_KEY]: nextState,
    },
  );
  return nextState;
}

export async function enqueueSummaryCandidates(params: {
  db: SupabaseClient;
  userId: string;
  conversationId: string;
  triggerMeta: Record<string, unknown> | null | undefined;
  candidates: Array<{
    event: PlannedEventRow;
    outcome: string | null;
    proposedOutcomeCells: MatrixCell[];
  }>;
  nowIso: string;
}): Promise<PendingArtifactState | null> {
  if (!params.candidates.length) return readPendingArtifactState(params.triggerMeta);
  const existingState = readPendingArtifactState(params.triggerMeta);
  const mergedByEventId = new Map(
    (existingState?.summary_candidates ?? []).map((candidate) => [candidate.event_id, candidate] as const),
  );
  params.candidates.forEach((candidate, index) => {
    mergedByEventId.set(candidate.event.id, {
      candidate_id: mergedByEventId.get(candidate.event.id)?.candidate_id ?? newCandidateId(params.nowIso, index),
      event_id: candidate.event.id,
      description: candidate.event.description,
      planned_local_date: candidate.event.planned_local_date,
      expected_at: candidate.event.expected_at,
      time_phrase_raw: candidate.event.time_phrase_raw,
      time_resolution: candidate.event.time_resolution,
      outcome: candidate.outcome,
      proposed_outcome_cells: normalizeCells(candidate.proposedOutcomeCells),
      queued_at: params.nowIso,
    });
  });
  const nextState = buildPendingArtifactState(
    existingState?.planning_candidates ?? [],
    [...mergedByEventId.values()],
    params.nowIso,
  );
  await updateConversationTriggerMeta(
    params.db,
    params.userId,
    params.conversationId,
    params.triggerMeta,
    {
      [PENDING_PLANNING_META_KEY]: nextState,
    },
  );
  return nextState;
}

function normalizeDecision(value: unknown): ReconcileDecision | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const candidateId = typeof raw.candidate_id === "string" ? raw.candidate_id.trim() : "";
  const actionRaw = typeof raw.action === "string" ? raw.action.trim().toLowerCase() : "";
  const action: ReconcileAction | null =
    actionRaw === "create_new" || actionRaw === "update_existing" || actionRaw === "ignore"
      ? actionRaw
      : null;
  if (!candidateId || !action) return null;
  const confidence = Number(raw.confidence);
  return {
    candidate_id: candidateId,
    action,
    existing_event_id: typeof raw.existing_event_id === "string" && raw.existing_event_id.trim()
      ? raw.existing_event_id.trim()
      : null,
    normalized_desc: typeof raw.normalized_desc === "string" && raw.normalized_desc.trim()
      ? raw.normalized_desc.trim()
      : null,
    confidence: Number.isFinite(confidence) ? confidence : null,
    reason: typeof raw.reason === "string" && raw.reason.trim() ? raw.reason.trim() : null,
  };
}

function normalizeSummaryDecision(value: unknown): SummaryReconcileDecision | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const candidateId = typeof raw.candidate_id === "string" ? raw.candidate_id.trim() : "";
  if (!candidateId) return null;
  const confidence = Number(raw.confidence);
  return {
    candidate_id: candidateId,
    normalized_outcome: typeof raw.normalized_outcome === "string" && raw.normalized_outcome.trim()
      ? raw.normalized_outcome.trim()
      : null,
    outcome_cells: normalizeCells(asMatrixCells(raw.outcome_cells)),
    confidence: Number.isFinite(confidence) ? confidence : null,
    reason: typeof raw.reason === "string" && raw.reason.trim() ? raw.reason.trim() : null,
  };
}

function normalizeSummaryNormalization(value: unknown): SummaryNormalizationDecision | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const candidateId = typeof raw.candidate_id === "string" ? raw.candidate_id.trim() : "";
  if (!candidateId) return null;
  const confidence = Number(raw.confidence);
  return {
    candidate_id: candidateId,
    normalized_outcome: typeof raw.normalized_outcome === "string" && raw.normalized_outcome.trim()
      ? raw.normalized_outcome.trim()
      : null,
    confidence: Number.isFinite(confidence) ? confidence : null,
    reason: typeof raw.reason === "string" && raw.reason.trim() ? raw.reason.trim() : null,
  };
}

function normalizeSummaryCellClassification(value: unknown): SummaryCellClassification | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const candidateId = typeof raw.candidate_id === "string" ? raw.candidate_id.trim() : "";
  if (!candidateId) return null;
  const confidence = Number(raw.confidence);
  return {
    candidate_id: candidateId,
    outcome_cells: normalizeCells(asMatrixCells(raw.outcome_cells)),
    confidence: Number.isFinite(confidence) ? confidence : null,
    reason: typeof raw.reason === "string" && raw.reason.trim() ? raw.reason.trim() : null,
  };
}

function compactChakraBaselines() {
  return Object.entries(chakraStatesBaseline)
    .map(([planet, value]) => ({
      planet,
      chakra_number: Number((value as { chakra_number?: unknown }).chakra_number),
      harmonic_states: ((value as { harmonicStates?: string[] }).harmonicStates ?? []).slice(0, 8),
      dissonant_states: ((value as { dissonantStates?: string[] }).dissonantStates ?? []).slice(0, 8),
      psychological_signals: ((value as { lexical_registers?: { psychological?: string[] } }).lexical_registers?.psychological ?? []).slice(0, 6),
      somatic_signals: ((value as { lexical_registers?: { somatic?: string[] } }).lexical_registers?.somatic ?? []).slice(0, 6),
    }))
    .sort((left, right) => left.chakra_number - right.chakra_number);
}

async function decidePlanningReconciliation(params: {
  conversationId: string;
  nowLocal: DateTime;
  locale: string;
  dueEvents: PlannedEventRow[];
  openPlans: PlannedEventRow[];
  planningCandidates: PendingPlanningCandidate[];
}): Promise<ReconcileDecision[]> {
  if (!params.planningCandidates.length) {
    return [];
  }
  const model = getModelByHint("low");
  const systemInstruction =
    "You reconcile delayed planning artifacts. Return JSON only. " +
    "For planning candidates, choose exactly one action: create_new, update_existing, or ignore. " +
    "Bias strongly against duplicates: if a candidate likely rephrases or уточняет an existing same-day plan, prefer update_existing. " +
    "Do not return ambiguous placeholders.";
  const cachedPrefixContent: GeminiContent = {
    role: "user",
    parts: [{
      text: JSON.stringify({
        now_local: params.nowLocal.toISO(),
        locale: params.locale,
        life_spheres_baseline: getLifeSpheresBaseline(params.locale),
        chakra_baselines: compactChakraBaselines(),
        due_events: params.dueEvents.map((event) => ({
          id: event.id,
          description: event.description,
          expected_at: event.expected_at,
          planned_local_date: event.planned_local_date,
          time_phrase_raw: event.time_phrase_raw,
          time_resolution: event.time_resolution,
        })),
        open_plans: params.openPlans.map((event) => ({
          id: event.id,
          description: event.description,
          expected_at: event.expected_at,
          planned_local_date: event.planned_local_date,
          time_phrase_raw: event.time_phrase_raw,
          time_resolution: event.time_resolution,
        })),
      }),
    }],
  };
  const suffixContent: GeminiContent = {
    role: "user",
    parts: [{
      text: JSON.stringify({
        planning_candidates: params.planningCandidates,
        response_shape: {
          planning_decisions: [
            {
              candidate_id: "string",
              action: "create_new | update_existing | ignore",
              existing_event_id: "string | null",
              normalized_desc: "string | null",
              confidence: "number 0..1",
              reason: "short string",
            },
          ],
        },
      }),
    }],
  };
  const cachedContent = supportsExplicitLlmCache(model)
    ? await ensureDialogCache(
        `${params.conversationId}:planning_reconcile`,
        systemInstruction,
        [cachedPrefixContent],
        model,
      )
    : null;
  const requestContents = cachedContent ? [suffixContent] : [cachedPrefixContent, suffixContent];
  const { json } = await generateGeminiJson<{ planning_decisions?: unknown }>({
    systemInstruction,
    contents: requestContents,
    cachedContent: cachedContent ?? undefined,
    model,
    temperature: 0.1,
    maxOutputTokens: 2200,
  });
  return Array.isArray(json?.planning_decisions)
    ? json.planning_decisions.map(normalizeDecision).filter((item): item is ReconcileDecision => Boolean(item))
    : [];
}

async function normalizeSummaryOutcomes(params: {
  conversationId: string;
  locale: string;
  summaryCandidates: PendingSummaryCandidate[];
}): Promise<SummaryNormalizationDecision[]> {
  if (!params.summaryCandidates.length) return [];
  const model = getModelByHint("low");
  const systemInstruction =
    "You normalize summarized dialog outcomes for later life-matrix classification. Return JSON only. " +
    "For each candidate, write one compact canonical outcome in the same language as the input. " +
    "Keep the primary event or activity explicit, preserve the lived result, and demote side effects to the background. " +
    "Do not over-abstract into body/recovery or meaning/value language unless that theme is central to the outcome itself.";
  const { json } = await generateGeminiJson<{ normalized_summaries?: unknown }>({
    systemInstruction,
    contents: [{
      role: "user",
      parts: [{
        text: JSON.stringify({
          locale: params.locale,
          summary_candidates: params.summaryCandidates.map((candidate) => ({
            candidate_id: candidate.candidate_id,
            source_text: buildSummaryNormalizationSourceText(candidate),
            event_description: candidate.description,
            raw_outcome: candidate.outcome,
          })),
          response_shape: {
            normalized_summaries: [
              {
                candidate_id: "string",
                normalized_outcome: "string | null",
                confidence: "number 0..1",
                reason: "short string",
              },
            ],
          },
        }),
      }],
    }],
    model,
    temperature: 0.1,
    maxOutputTokens: 1400,
  });
  return Array.isArray(json?.normalized_summaries)
    ? json.normalized_summaries.map(normalizeSummaryNormalization).filter((item): item is SummaryNormalizationDecision => Boolean(item))
    : [];
}

async function classifySummaryOutcomeCells(params: {
  conversationId: string;
  locale: string;
  summaryInputs: Array<ReturnType<typeof buildSummaryClassificationCandidate>>;
}): Promise<SummaryCellClassification[]> {
  if (!params.summaryInputs.length) return [];
  const model = getModelByHint("low");
  const systemInstruction =
    "You classify normalized summarized outcomes into sparse life-matrix cells. Return JSON only. " +
    "Use normalized_outcome as primary truth and event_description only as a domain anchor. " +
    "Prefer the event's primary domain over secondary side effects. " +
    "Do not move an outcome into sphere 1 unless body, health, recovery, sleep, or energy are central to the normalized outcome. " +
    "Do not move an outcome into sphere 7 unless meaning, values, purpose, service, faith, or orientation are central to the normalized outcome. " +
    "Use at most 3 outcome cells per candidate. Weights inside the same sphere should sum to 1. " +
    "Do not return ambiguous placeholders.";
  const cachedPrefixContent: GeminiContent = {
    role: "user",
    parts: [{
      text: JSON.stringify({
        locale: params.locale,
        life_spheres_baseline: getLifeSpheresBaseline(params.locale),
        chakra_baselines: compactChakraBaselines(),
      }),
    }],
  };
  const suffixContent: GeminiContent = {
    role: "user",
    parts: [{
      text: JSON.stringify({
        summary_inputs: params.summaryInputs,
        response_shape: {
          summary_classifications: [
            {
              candidate_id: "string",
              outcome_cells: [{ sphere: 1, chakra: 1, weight: 1 }],
              confidence: "number 0..1",
              reason: "short string",
            },
          ],
        },
      }),
    }],
  };
  const cachedContent = supportsExplicitLlmCache(model)
    ? await ensureDialogCache(
        `${params.conversationId}:summary_outcome_classifier`,
        systemInstruction,
        [cachedPrefixContent],
        model,
      )
    : null;
  const requestContents = cachedContent ? [suffixContent] : [cachedPrefixContent, suffixContent];
  const { json } = await generateGeminiJson<{ summary_classifications?: unknown }>({
    systemInstruction,
    contents: requestContents,
    cachedContent: cachedContent ?? undefined,
    model,
    temperature: 0.1,
    maxOutputTokens: 1800,
  });
  return Array.isArray(json?.summary_classifications)
    ? json.summary_classifications.map(normalizeSummaryCellClassification).filter((item): item is SummaryCellClassification => Boolean(item))
    : [];
}

async function decideSummaryReconciliation(params: {
  conversationId: string;
  locale: string;
  summaryCandidates: PendingSummaryCandidate[];
}): Promise<SummaryReconcileDecision[]> {
  if (!params.summaryCandidates.length) return [];

  const normalizedSummaries = await normalizeSummaryOutcomes(params);
  const normalizedByCandidate = new Map(normalizedSummaries.map((item) => [item.candidate_id, item]));
  const classifications = await classifySummaryOutcomeCells({
    conversationId: params.conversationId,
    locale: params.locale,
    summaryInputs: params.summaryCandidates.map((candidate) =>
      buildSummaryClassificationCandidate(
        candidate,
        normalizedByCandidate.get(candidate.candidate_id)?.normalized_outcome ?? null,
      ),
    ),
  });
  const classificationByCandidate = new Map(classifications.map((item) => [item.candidate_id, item]));

  return params.summaryCandidates.map((candidate) => {
    const normalized = normalizedByCandidate.get(candidate.candidate_id);
    const classified = classificationByCandidate.get(candidate.candidate_id);
    const reason = [normalized?.reason, classified?.reason].filter((value): value is string => Boolean(value)).join("; ");

    return normalizeSummaryDecision({
      candidate_id: candidate.candidate_id,
      normalized_outcome: normalized?.normalized_outcome ?? candidate.outcome ?? candidate.description,
      outcome_cells: classified?.outcome_cells ?? [],
      confidence: classified?.confidence ?? normalized?.confidence ?? null,
      reason: reason || null,
    }) ?? {
      candidate_id: candidate.candidate_id,
      normalized_outcome: normalized?.normalized_outcome ?? candidate.outcome ?? candidate.description,
      outcome_cells: classified?.outcome_cells ?? [],
      confidence: classified?.confidence ?? normalized?.confidence ?? null,
      reason: reason || null,
    };
  });
}

async function clearPendingPlanningState(params: {
  db: SupabaseClient;
  userId: string;
  conversationId: string;
  triggerMeta: Record<string, unknown> | null | undefined;
  result: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const nextMeta = { ...(params.triggerMeta ?? {}) };
  delete nextMeta[PENDING_PLANNING_META_KEY];
  nextMeta[LAST_PLANNING_RESULT_META_KEY] = params.result;
  const { error } = await params.db
    .from("conversations")
    .update({ trigger_meta: nextMeta })
    .eq("id", params.conversationId)
    .eq("user_id", params.userId);
  if (error) throw error;
  return nextMeta;
}

export async function reconcilePendingPlanningCandidates(params: {
  db: SupabaseClient;
  userId: string;
  conversation: { id: string; trigger_meta?: Record<string, unknown> | null };
  nowLocal: DateTime;
  eventParseNowLocal: DateTime;
  eventParseRelativeNowLocal: DateTime;
  timezone: string;
  locale: string;
  dueEvents: PlannedEventRow[];
  planningHorizonLocalDates: string[];
  force?: boolean;
}): Promise<{ applied: boolean; triggerMeta: Record<string, unknown> | null | undefined; planningPersistence: PlanningPersistenceTurn | null }> {
  const pending = readPendingArtifactState(params.conversation.trigger_meta);
  if (!pending) {
    return { applied: false, triggerMeta: params.conversation.trigger_meta, planningPersistence: null };
  }
  if (!params.force && Date.parse(pending.due_at) > params.nowLocal.toUTC().toMillis()) {
    return { applied: false, triggerMeta: params.conversation.trigger_meta, planningPersistence: null };
  }

  const openPlans = await loadOpenPlannedEventsForUserHorizon(
    params.db,
    params.userId,
    params.planningHorizonLocalDates,
  );
  const [planningDecisions, summaryDecisions] = await Promise.all([
    decidePlanningReconciliation({
      conversationId: params.conversation.id,
      nowLocal: params.nowLocal,
      locale: params.locale,
      dueEvents: params.dueEvents,
      openPlans,
      planningCandidates: pending.planning_candidates,
    }),
    decideSummaryReconciliation({
      conversationId: params.conversation.id,
      locale: params.locale,
      summaryCandidates: pending.summary_candidates,
    }),
  ]);

  const planningDecisionByCandidate = new Map(planningDecisions.map((decision) => [decision.candidate_id, decision]));
  const summaryDecisionByCandidate = new Map(summaryDecisions.map((decision) => [decision.candidate_id, decision]));
  const mutableOpenPlans = [...openPlans];
  const insertedPlannedEvents: PlanningPersistenceTurn["inserted"] = [];
  const updatedPlannedEvents: PlanningPersistenceTurn["updated"] = [];
  const skippedPlannedEvents: PlanningPersistenceTurn["skipped"] = [];
  const summarizedPlannedEvents: PlanningPersistenceTurn["summarized"] = [];

  for (const candidate of pending.planning_candidates) {
    const decision = planningDecisionByCandidate.get(candidate.candidate_id) ?? {
      candidate_id: candidate.candidate_id,
      action: "ignore" as const,
      reason: "missing_model_decision",
    };
    if (decision.action === "ignore") {
      skippedPlannedEvents.push({
        desc: candidate.desc,
        time: candidate.time,
        time_norm: candidate.timeNorm,
        reason: decision.reason ?? "model_ignore",
        resolved_local_date: null,
      });
      continue;
    }

    const parsedTime = parseEventTime({
      phrase: buildPlanningCandidateParsePhrase(candidate),
      nowLocal: params.eventParseNowLocal,
      relativeNowLocal: params.eventParseRelativeNowLocal,
      tz: params.timezone,
      locale: params.locale,
    });
    const dayDelta = Math.round(
      parsedTime.expectedLocal.startOf("day").diff(params.nowLocal.startOf("day"), "days").days,
    );
    if (dayDelta < 0 || dayDelta > 1) {
      skippedPlannedEvents.push({
        desc: candidate.desc,
        time: candidate.time,
        time_norm: candidate.timeNorm,
        reason: "beyond_supported_horizon",
        resolved_local_date: parsedTime.expectedLocal.toFormat("yyyy-MM-dd"),
      });
      continue;
    }

    const freshOpenPlans = await loadOpenPlannedEventsForUserHorizon(
      params.db,
      params.userId,
      params.planningHorizonLocalDates,
    );
    mutableOpenPlans.length = 0;
    mutableOpenPlans.push(...freshOpenPlans);

    if (decision.action === "update_existing") {
      const existing = mutableOpenPlans.find((row) => row.id === decision.existing_event_id);
      if (!existing) {
        const sameExisting = mutableOpenPlans.find((row) => matchPlannedEventAgainstExisting({
          existing: row,
          incomingDescription: decision.normalized_desc?.trim() || candidate.desc,
          incomingParsedTime: parsedTime,
          timezone: params.timezone,
        }) === "same");
        if (sameExisting) {
          skippedPlannedEvents.push({
            desc: candidate.desc,
            time: candidate.time,
            time_norm: candidate.timeNorm,
            reason: "duplicate_guard_same_after_refresh",
            resolved_local_date: parsedTime.expectedLocal.toFormat("yyyy-MM-dd"),
          });
          continue;
        }
        skippedPlannedEvents.push({
          desc: candidate.desc,
          time: candidate.time,
          time_norm: candidate.timeNorm,
          reason: "reconcile_missing_existing_target",
          resolved_local_date: parsedTime.expectedLocal.toFormat("yyyy-MM-dd"),
        });
        continue;
      }
      const updatePayload = {
        expected_at: parsedTime.expectedUtc,
        planned_local_date: parsedTime.expectedLocal.toFormat("yyyy-MM-dd"),
        time_phrase_raw: candidate.time?.trim() ?? candidate.timeNorm?.trim() ?? null,
        time_resolution: canonicalizeTimeResolution(parsedTime.resolution),
        description: decision.normalized_desc?.trim() || candidate.desc,
        context_snippets: mergeUnknownArrays(existing.context_snippets, candidate.snippets),
        cells: normalizeCells([...asMatrixCells(existing.cells), ...candidate.cells]),
        status: "planned",
      };
      const { data, error } = await params.db
        .from("planned_events")
        .update(updatePayload)
        .eq("user_id", params.userId)
        .eq("id", existing.id)
        .select("id,description,expected_at,planned_at,planned_local_date,status,time_phrase_raw,time_resolution,context_snippets,cells,outcome_cells,outcome_text,conversation_id")
        .single();
      if (error) throw error;
      if (data) {
        const nextRow = data as PlannedEventRow;
        const idx = mutableOpenPlans.findIndex((row) => row.id === existing.id);
        if (idx >= 0) mutableOpenPlans[idx] = nextRow;
        updatedPlannedEvents.push({
          id: String(data.id),
          conversation_id: typeof data.conversation_id === "string" ? data.conversation_id : existing.conversation_id ?? params.conversation.id,
          description: String(data.description ?? candidate.desc),
          planned_at: typeof data.planned_at === "string" ? data.planned_at : params.nowLocal.toUTC().toISO() ?? new Date().toISOString(),
          planned_local_date: typeof data.planned_local_date === "string" ? data.planned_local_date : parsedTime.expectedLocal.toFormat("yyyy-MM-dd"),
          expected_at: String(data.expected_at ?? parsedTime.expectedUtc),
          time_phrase_raw: typeof data.time_phrase_raw === "string" ? data.time_phrase_raw : candidate.time?.trim() ?? candidate.timeNorm?.trim() ?? null,
          time_resolution: typeof data.time_resolution === "string" ? data.time_resolution : canonicalizeTimeResolution(parsedTime.resolution),
          status: String(data.status ?? "planned"),
          context_snippets: Array.isArray(data.context_snippets) ? data.context_snippets : candidate.snippets,
          cells: asMatrixCells(data.cells ?? candidate.cells),
        });
      }
      continue;
    }

    const sameExisting = mutableOpenPlans.find((row) => matchPlannedEventAgainstExisting({
      existing: row,
      incomingDescription: decision.normalized_desc?.trim() || candidate.desc,
      incomingParsedTime: parsedTime,
      timezone: params.timezone,
    }) === "same");
    if (sameExisting) {
      skippedPlannedEvents.push({
        desc: candidate.desc,
        time: candidate.time,
        time_norm: candidate.timeNorm,
        reason: "duplicate_guard_same",
        resolved_local_date: parsedTime.expectedLocal.toFormat("yyyy-MM-dd"),
      });
      continue;
    }

    const ambiguousExisting = mutableOpenPlans.find((row) => matchPlannedEventAgainstExisting({
      existing: row,
      incomingDescription: decision.normalized_desc?.trim() || candidate.desc,
      incomingParsedTime: parsedTime,
      timezone: params.timezone,
    }) === "ambiguous_time_conflict");
    if (ambiguousExisting) {
      skippedPlannedEvents.push({
        desc: candidate.desc,
        time: candidate.time,
        time_norm: candidate.timeNorm,
        reason: "ambiguous_time_conflict",
        resolved_local_date: parsedTime.expectedLocal.toFormat("yyyy-MM-dd"),
      });
      continue;
    }

    const { data, error } = await params.db
      .from("planned_events")
      .insert({
        user_id: params.userId,
        conversation_id: params.conversation.id,
        planned_at: params.nowLocal.toUTC().toISO() ?? new Date().toISOString(),
        planned_local_date: parsedTime.expectedLocal.toFormat("yyyy-MM-dd"),
        expected_at: parsedTime.expectedUtc,
        time_phrase_raw: candidate.time?.trim() ?? candidate.timeNorm?.trim() ?? null,
        time_resolution: canonicalizeTimeResolution(parsedTime.resolution),
        description: decision.normalized_desc?.trim() || candidate.desc,
        context_snippets: candidate.snippets,
        cells: candidate.cells,
        status: "planned",
      })
      .select("id,conversation_id,planned_at,planned_local_date,expected_at,time_phrase_raw,time_resolution,description,context_snippets,cells,status,outcome_cells,outcome_text")
      .single();
    if (error) throw error;
    if (data) {
      insertedPlannedEvents.push({
        id: String(data.id),
        conversation_id: typeof data.conversation_id === "string" ? data.conversation_id : params.conversation.id,
        description: String(data.description ?? candidate.desc),
        planned_at: typeof data.planned_at === "string" ? data.planned_at : params.nowLocal.toUTC().toISO() ?? new Date().toISOString(),
        planned_local_date: typeof data.planned_local_date === "string" ? data.planned_local_date : parsedTime.expectedLocal.toFormat("yyyy-MM-dd"),
        expected_at: String(data.expected_at ?? parsedTime.expectedUtc),
        time_phrase_raw: typeof data.time_phrase_raw === "string" ? data.time_phrase_raw : candidate.time?.trim() ?? candidate.timeNorm?.trim() ?? null,
        time_resolution: typeof data.time_resolution === "string" ? data.time_resolution : canonicalizeTimeResolution(parsedTime.resolution),
        status: String(data.status ?? "planned"),
        context_snippets: Array.isArray(data.context_snippets) ? data.context_snippets : candidate.snippets,
        cells: asMatrixCells(data.cells ?? candidate.cells),
      });
    }
  }

  let appliedSummaries = 0;
  for (const candidate of pending.summary_candidates) {
    const summaryDecision = summaryDecisionByCandidate.get(candidate.candidate_id);
    const outcomeCells = normalizeCells(summaryDecision?.outcome_cells?.length ? summaryDecision.outcome_cells : candidate.proposed_outcome_cells);
    if (!outcomeCells.length) {
      skippedPlannedEvents.push({
        desc: candidate.description,
        time: candidate.time_phrase_raw,
        time_norm: candidate.time_phrase_raw,
        reason: summaryDecision?.reason ?? "summary_missing_outcome_cells",
        resolved_local_date: candidate.planned_local_date,
      });
      continue;
    }
    const { data: existingRow, error: existingError } = await params.db
      .from("planned_events")
      .select("id,description,planned_at,planned_local_date,expected_at,time_phrase_raw,time_resolution,status,context_snippets,cells")
      .eq("user_id", params.userId)
      .eq("id", candidate.event_id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existingRow) {
      skippedPlannedEvents.push({
        desc: candidate.description,
        time: candidate.time_phrase_raw,
        time_norm: candidate.time_phrase_raw,
        reason: "summary_event_missing_or_already_processed",
        resolved_local_date: candidate.planned_local_date,
      });
      continue;
    }
    await mergeSummarizedEventIntoDailyMatrix(
      params.db,
      params.userId,
      candidate.planned_local_date,
      outcomeCells,
      params.nowLocal.toUTC().toISO() ?? new Date().toISOString(),
    );
    const { error: deleteError } = await params.db
      .from("planned_events")
      .delete()
      .eq("user_id", params.userId)
      .eq("id", candidate.event_id);
    if (deleteError) throw deleteError;
    summarizedPlannedEvents.push({
      id: String(existingRow.id),
      conversation_id: null,
      description: String(existingRow.description ?? candidate.description),
      planned_at: typeof existingRow.planned_at === "string" ? existingRow.planned_at : null,
      planned_local_date: typeof existingRow.planned_local_date === "string" ? existingRow.planned_local_date : candidate.planned_local_date,
      expected_at: String(existingRow.expected_at ?? candidate.expected_at),
      time_phrase_raw: typeof existingRow.time_phrase_raw === "string" ? existingRow.time_phrase_raw : candidate.time_phrase_raw,
      time_resolution: typeof existingRow.time_resolution === "string" ? existingRow.time_resolution : candidate.time_resolution,
      status: "summarized",
      context_snippets: Array.isArray(existingRow.context_snippets) ? existingRow.context_snippets : [],
      cells: asMatrixCells(existingRow.cells),
      summarized_at: params.nowLocal.toUTC().toISO() ?? new Date().toISOString(),
      outcome_text: summaryDecision?.normalized_outcome ?? candidate.outcome,
      outcome_cells: outcomeCells,
      matched_ref: candidate.event_id,
    });
    appliedSummaries += 1;
  }

  if (appliedSummaries > 0) {
    await rebuildProfileReportSnapshot(
      params.db,
      params.userId,
      params.nowLocal.toUTC().toISO() ?? new Date().toISOString(),
    );
  }

  const resultMeta = {
    processed_at: params.nowLocal.toUTC().toISO() ?? new Date().toISOString(),
    planning_candidate_count: pending.planning_candidates.length,
    summary_candidate_count: pending.summary_candidates.length,
    inserted_count: insertedPlannedEvents.length,
    updated_count: updatedPlannedEvents.length,
    summarized_count: summarizedPlannedEvents.length,
    skipped_count: skippedPlannedEvents.length,
  };
  const nextMeta = await clearPendingPlanningState({
    db: params.db,
    userId: params.userId,
    conversationId: params.conversation.id,
    triggerMeta: params.conversation.trigger_meta,
    result: resultMeta,
  });
  return {
    applied: true,
    triggerMeta: nextMeta,
    planningPersistence: {
      queued: [],
      queued_summaries: [],
      inserted: insertedPlannedEvents,
      updated: updatedPlannedEvents,
      summarized: summarizedPlannedEvents,
      skipped: skippedPlannedEvents,
    },
  };
}
