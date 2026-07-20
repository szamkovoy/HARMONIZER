import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Explicit finite-state machine for the daily dialog "brain".
 *
 * The previous implementation inferred the dialogue branch every turn from
 * message history via heuristics + regex, which made behaviour unpredictable.
 * Here the server stores exactly which branch it is in (and how far it got)
 * inside `conversations.trigger_meta.dialog_fsm`, and transitions
 * deterministically. One turn = one branch = one focused prompt = one marker
 * type to parse.
 */

export type DialogBranch = "summarizing" | "planning" | "practice" | "done";

export const DIALOG_FSM_KEY = "dialog_fsm" as const;
export const DIALOG_FSM_VERSION = 1 as const;

export type DialogFsmState = {
  v: number;
  /** Ordered branches this dialogue will walk through. */
  flow: DialogBranch[];
  /** Index into `flow` for the current branch. */
  branchIndex: number;
  branch: DialogBranch;
  /** Per-event clarifying-question counter for SUMMARIZING (max 1 each). */
  summaryAsked: Record<string, number>;
  planningFinalized: boolean;
  practiceDecided: boolean;
  /** Flows that never enter the practice branch (Day-tab add, or tiers without catalog). */
  noPractice: boolean;
  /**
   * Home/plan finalize for Oracle/Free: soft close about today's-chakra practice +
   * Master catalog note (no kind/duration question). Distinct from Day-tab add
   * (`noPractice` without this flag), which ends with no practice paragraph.
   */
  softPracticeClose: boolean;
  /** add day-tab flow opens without a greeting. */
  noGreeting: boolean;
  /** Target chakra fixed for the whole local day. */
  targetChakra: number;
  /** Local date the dialogue is operating on (today, or the summarized day). */
  workingLocalDate: string;
};

export type DialogTabMode = "summary" | "add" | "plan" | null;

function asBranch(value: unknown): DialogBranch | null {
  return value === "summarizing" || value === "planning" || value === "practice" || value === "done"
    ? value
    : null;
}

export function readFsmState(triggerMeta: Record<string, unknown> | null | undefined): DialogFsmState | null {
  const raw = triggerMeta?.[DIALOG_FSM_KEY];
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<DialogFsmState>;
  const branch = asBranch(candidate.branch);
  if (!branch) return null;
  const flow = Array.isArray(candidate.flow)
    ? candidate.flow.map(asBranch).filter((item): item is DialogBranch => Boolean(item))
    : [branch];
  return {
    v: typeof candidate.v === "number" ? candidate.v : DIALOG_FSM_VERSION,
    flow: flow.length ? flow : [branch],
    branchIndex: Number.isInteger(candidate.branchIndex) ? Number(candidate.branchIndex) : 0,
    branch,
    summaryAsked: candidate.summaryAsked && typeof candidate.summaryAsked === "object"
      ? candidate.summaryAsked as Record<string, number>
      : {},
    planningFinalized: Boolean(candidate.planningFinalized),
    practiceDecided: Boolean(candidate.practiceDecided),
    noPractice: Boolean(candidate.noPractice),
    softPracticeClose: Boolean(candidate.softPracticeClose),
    noGreeting: Boolean(candidate.noGreeting),
    targetChakra: Number.isInteger(candidate.targetChakra) ? Number(candidate.targetChakra) : 7,
    workingLocalDate: typeof candidate.workingLocalDate === "string" ? candidate.workingLocalDate : "",
  };
}

export function initFsmState(params: {
  tabMode: DialogTabMode;
  daySummaryRequested: boolean;
  hasDueEvents: boolean;
  targetChakra: number;
  workingLocalDate: string;
  /**
   * Master (or active trial): include practice branch + kind/duration offer.
   * Oracle/Free (and safety-net Free): omit practice; planning soft-closes instead.
   * Defaults to true so unit tests and older callers keep the catalog flow.
   */
  offerCatalogPractice?: boolean;
}): DialogFsmState {
  let flow: DialogBranch[];
  let noPractice = false;
  let softPracticeClose = false;
  let noGreeting = false;
  const offerCatalogPractice = params.offerCatalogPractice !== false;

  if (params.tabMode === "add") {
    flow = ["planning"];
    noPractice = true;
    noGreeting = true;
  } else if (params.daySummaryRequested) {
    // "Summarize this day" — close after the wrap-up, no planning/practice.
    flow = ["summarizing"];
    noPractice = true;
  } else if (params.tabMode === "plan" || params.tabMode === null || params.tabMode === "summary") {
    // Home / Day-tab "Что делать?" / plan: summarize overdue if any, then plan.
    // Practice branch only when the user can open the catalog (Master / trial).
    const withSummary = params.hasDueEvents ? (["summarizing"] as DialogBranch[]) : [];
    if (offerCatalogPractice) {
      flow = [...withSummary, "planning", "practice"];
      noPractice = false;
      softPracticeClose = false;
    } else {
      flow = [...withSummary, "planning"];
      noPractice = true;
      softPracticeClose = true;
    }
    noGreeting = false;
  } else {
    flow = ["planning"];
    noPractice = true;
  }

  const branch = flow[0] ?? "planning";
  return {
    v: DIALOG_FSM_VERSION,
    flow,
    branchIndex: 0,
    branch,
    summaryAsked: {},
    planningFinalized: false,
    practiceDecided: false,
    noPractice,
    softPracticeClose,
    noGreeting,
    targetChakra: params.targetChakra,
    workingLocalDate: params.workingLocalDate,
  };
}

/** Move to the next branch in `flow`, or `done` when the flow is exhausted. */
export function advanceBranch(state: DialogFsmState): DialogFsmState {
  let nextIndex = state.branchIndex + 1;
  // Skip the practice branch entirely when noPractice is set.
  while (nextIndex < state.flow.length && state.noPractice && state.flow[nextIndex] === "practice") {
    nextIndex += 1;
  }
  if (nextIndex >= state.flow.length) {
    return { ...state, branchIndex: nextIndex, branch: "done" };
  }
  return { ...state, branchIndex: nextIndex, branch: state.flow[nextIndex]! };
}

export function isLastBranch(state: DialogFsmState): boolean {
  for (let i = state.branchIndex + 1; i < state.flow.length; i += 1) {
    if (state.noPractice && state.flow[i] === "practice") continue;
    return false;
  }
  return true;
}

export function bumpSummaryAsked(state: DialogFsmState, eventId: string): DialogFsmState {
  const summaryAsked = { ...state.summaryAsked, [eventId]: (state.summaryAsked[eventId] ?? 0) + 1 };
  return { ...state, summaryAsked };
}

export function summaryAskedCount(state: DialogFsmState, eventId: string | null | undefined): number {
  if (!eventId) return 0;
  return state.summaryAsked[eventId] ?? 0;
}

/** Persist the FSM state back into `conversations.trigger_meta`, returning the merged meta. */
export async function writeFsmState(
  db: SupabaseClient,
  userId: string,
  conversationId: string,
  triggerMeta: Record<string, unknown> | null | undefined,
  state: DialogFsmState,
): Promise<Record<string, unknown>> {
  const nextMeta = { ...(triggerMeta ?? {}), [DIALOG_FSM_KEY]: state };
  const { error } = await db
    .from("conversations")
    .update({ trigger_meta: nextMeta })
    .eq("id", conversationId)
    .eq("user_id", userId);
  if (error) throw error;
  return nextMeta;
}
