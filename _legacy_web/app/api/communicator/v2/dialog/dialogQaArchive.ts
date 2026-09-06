import type { SupabaseClient } from "@supabase/supabase-js";

export const DAILY_DIALOG_ARCHIVE_TURN_TEXT_LIMIT = 8000;

export const DAILY_DIALOG_ARCHIVE_OUTCOMES = [
  "open",
  "completed",
  "practice_handoff",
  "superseded",
  "interrupted",
  "error",
] as const;

export type DailyDialogArchiveOutcome = (typeof DAILY_DIALOG_ARCHIVE_OUTCOMES)[number];

export type DailyDialogArchiveTurn = {
  role: "user" | "assistant";
  text: string;
  at: string;
  branch?: string;
  turnMode?: string;
  shouldClose?: boolean;
  guards?: string[];
  planningPersistence?: Record<string, unknown>;
  practicePicked?: boolean;
};

export type DailyDialogArchiveAppendInput = {
  userId: string;
  conversationId: string;
  entrySource?: string | null;
  dayTabMode?: string | null;
  locale?: string | null;
  algoVersion?: string | null;
  turns: DailyDialogArchiveTurn[];
  outcome?: DailyDialogArchiveOutcome;
  lastBranch?: string | null;
  lastTurnMode?: string | null;
  lastShouldClose?: boolean | null;
};

const PERSIST_KEYS = ["inserted", "updated", "summarized", "cancelled", "deleted"] as const;

function clipText(value: string, limit = DAILY_DIALOG_ARCHIVE_TURN_TEXT_LIMIT): string {
  return value.length <= limit ? value : value.slice(0, limit);
}

function compactPersistItem(item: unknown): Record<string, unknown> | null {
  if (!item || typeof item !== "object") return null;
  const row = item as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof row.id === "string" && row.id.trim()) out.id = row.id;
  if (typeof row.action === "string" && row.action.trim()) out.action = row.action;
  const description = row.description ?? row.title ?? row.desc;
  if (typeof description === "string" && description.trim()) {
    out.description = clipText(description.trim(), 200);
  }
  if (typeof row.display_order === "number" && Number.isFinite(row.display_order)) {
    out.display_order = row.display_order;
  }
  return Object.keys(out).length ? out : null;
}

export function compactPlanningPersistence(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of PERSIST_KEYS) {
    const value = row[key];
    if (!Array.isArray(value) || value.length === 0) continue;
    const items = value
      .slice(0, 20)
      .map(compactPersistItem)
      .filter((item): item is Record<string, unknown> => item != null);
    if (items.length) out[key] = items;
  }
  return Object.keys(out).length ? out : null;
}

export function resolveDailyDialogArchiveOutcome(params: {
  shouldClose?: boolean;
  practicePicked?: boolean;
  streamError?: boolean;
  interrupted?: boolean;
}): DailyDialogArchiveOutcome {
  if (params.streamError) return "error";
  if (params.interrupted) return "interrupted";
  if (params.shouldClose && params.practicePicked) return "practice_handoff";
  if (params.shouldClose) return "completed";
  return "open";
}

export function buildDailyDialogArchiveTurns(params: {
  userMessage?: string;
  assistantText?: string;
  at?: string;
  branch?: string | null;
  turnMode?: string | null;
  shouldClose?: boolean;
  guards?: string[];
  planningPersistence?: unknown;
  practicePicked?: boolean;
}): DailyDialogArchiveTurn[] {
  const at = params.at ?? new Date().toISOString();
  const turns: DailyDialogArchiveTurn[] = [];
  const userText = typeof params.userMessage === "string" ? params.userMessage.trim() : "";
  if (userText) {
    turns.push({ role: "user", text: clipText(userText), at });
  }
  const assistantText = typeof params.assistantText === "string" ? params.assistantText.trim() : "";
  if (assistantText) {
    const persistence = compactPlanningPersistence(params.planningPersistence);
    const guards = (params.guards ?? []).filter((item) => typeof item === "string" && item.trim());
    const turn: DailyDialogArchiveTurn = {
      role: "assistant",
      text: clipText(assistantText),
      at,
    };
    if (params.branch) turn.branch = params.branch;
    if (params.turnMode) turn.turnMode = params.turnMode;
    if (params.shouldClose) turn.shouldClose = true;
    if (guards.length) turn.guards = [...new Set(guards)];
    if (persistence) turn.planningPersistence = persistence;
    if (params.practicePicked) turn.practicePicked = true;
    turns.push(turn);
  }
  return turns;
}

export function dialogArchiveAlgoVersion(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  return sha ? sha.slice(0, 12) : "local";
}

function dayTabModeFromMeta(triggerMeta: Record<string, unknown> | null | undefined): string | null {
  const raw = triggerMeta?.dayTabMode ?? triggerMeta?.day_tab_mode;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

export async function appendDailyDialogArchive(
  db: SupabaseClient,
  input: DailyDialogArchiveAppendInput,
): Promise<void> {
  const { error } = await db.rpc("append_daily_dialog_archive", {
    p_user_id: input.userId,
    p_conversation_id: input.conversationId,
    p_entry_source: input.entrySource ?? null,
    p_day_tab_mode: input.dayTabMode ?? null,
    p_locale: input.locale ?? null,
    p_algo_version: input.algoVersion ?? dialogArchiveAlgoVersion(),
    p_turns: input.turns,
    p_outcome: input.outcome ?? "open",
    p_last_branch: input.lastBranch ?? null,
    p_last_turn_mode: input.lastTurnMode ?? null,
    p_last_should_close: input.lastShouldClose ?? null,
  });
  if (error) throw error;
}

/** Never throws — archive must not fail the user-facing dialog. */
export async function appendDailyDialogArchiveSafe(
  db: SupabaseClient | null | undefined,
  input: DailyDialogArchiveAppendInput | null | undefined,
): Promise<void> {
  if (!db || !input?.userId || !input.conversationId) return;
  try {
    await appendDailyDialogArchive(db, input);
  } catch (error) {
    console.warn(
      "[DIALOG_QA] archive append failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function markDailyDialogArchiveSupersededSafe(
  db: SupabaseClient | null | undefined,
  userId: string,
  conversationId: string,
): Promise<void> {
  await appendDailyDialogArchiveSafe(db, {
    userId,
    conversationId,
    turns: [],
    outcome: "superseded",
  });
}

export function archiveMetaFromTrigger(
  triggerMeta: Record<string, unknown> | null | undefined,
): { dayTabMode: string | null } {
  return { dayTabMode: dayTabModeFromMeta(triggerMeta) };
}
