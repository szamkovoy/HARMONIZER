import type { SupabaseClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";

import type { OrchestratorDecision } from "@legacy/app/api/_utils/orchestrator";
import { sessionTtlMs } from "@legacy/app/api/_utils/testMode";

export const MESSAGE_HISTORY_LIMIT = 40;

export type TurnHistoryItem = {
  role: "user" | "assistant";
  content: string;
  meta?: Record<string, unknown>;
};

export function resolveTurnHistory(
  clientHistory: TurnHistoryItem[] | undefined,
  dbHistory: MessageRecord[],
): MessageRecord[] {
  if (clientHistory?.length) {
    return clientHistory.map((item, index) => ({
      id: `client-${index}`,
      role: item.role,
      content: item.content,
      transcript: null,
      meta: item.meta ?? null,
      created_at: null,
    }));
  }
  return dbHistory;
}

export function normalizeTurnHistory(raw: unknown): TurnHistoryItem[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const items = raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const role = (item as { role?: unknown }).role;
      const content = String((item as { content?: unknown }).content ?? "").trim();
      if ((role !== "user" && role !== "assistant") || !content) return null;
      const rawMeta = (item as { meta?: unknown }).meta;
      const meta =
        rawMeta && typeof rawMeta === "object"
          ? (() => {
              const practicePicked =
                (rawMeta as { practicePicked?: unknown; practice_picked?: unknown }).practicePicked
                ?? (rawMeta as { practice_picked?: unknown }).practice_picked;
              const turnMode =
                (rawMeta as { turn_mode?: unknown; turnMode?: unknown }).turn_mode
                ?? (rawMeta as { turnMode?: unknown }).turnMode;
              const branchesRaw =
                (rawMeta as { branches?: unknown; dialog_branches?: unknown }).branches
                ?? (rawMeta as { dialog_branches?: unknown }).dialog_branches;
              const branches = Array.isArray(branchesRaw)
                ? branchesRaw.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
                : [];
              const sanitized: Record<string, unknown> = {};
              if (practicePicked && typeof practicePicked === "object") {
                sanitized.practicePicked = practicePicked;
                sanitized.practice_picked = practicePicked;
              }
              if (typeof turnMode === "string" && turnMode.trim()) {
                sanitized.turn_mode = turnMode;
              }
              if (branches.length > 0) {
                sanitized.branches = branches;
                sanitized.dialog_branches = branches;
              }
              return Object.keys(sanitized).length ? sanitized : undefined;
            })()
          : undefined;
      return { role, content: content.slice(0, 8000), ...(meta ? { meta } : {}) } satisfies TurnHistoryItem;
    })
    .filter((item): item is NonNullable<typeof item> => item != null);
  return items.length ? items.slice(-MESSAGE_HISTORY_LIMIT) : undefined;
}

export async function purgeConversationMessages(
  db: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<void> {
  const { error } = await db
    .from("messages")
    .delete()
    .eq("user_id", userId)
    .eq("conversation_id", conversationId);
  if (error) throw error;
}

export async function closeConversation(
  db: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<void> {
  const endedAt = new Date().toISOString();
  const { error: endError } = await db
    .from("conversations")
    .update({ ended_at: endedAt })
    .eq("id", conversationId)
    .eq("user_id", userId);
  if (endError) throw endError;
  await purgeConversationMessages(db, userId, conversationId);
}
/** Real 2h — not compressed by TEST_MODE_FAST_INTERVALS (see testMode.sessionTtlMs). */
export const SESSION_TTL_MS = sessionTtlMs();

export type MessageRecord = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string | null;
  transcript: string | null;
  meta: Record<string, unknown> | null;
  created_at: string | null;
};

export type ConversationRecord = {
  id: string;
  scenario_id?: string | null;
  trigger_meta?: Record<string, unknown> | null;
  entry_source?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  last_message_at?: string | null;
};

export function todayLocalDate(timezone: string, now: Date = new Date()): string {
  return DateTime.fromJSDate(now).setZone(timezone || "UTC").toISODate() ?? now.toISOString().slice(0, 10);
}

export function localDateForIso(iso: string | null | undefined, timezone: string): string | null {
  if (!iso) return null;
  const date = DateTime.fromISO(iso, { zone: "utc" }).setZone(timezone || "UTC");
  return date.isValid ? date.toISODate() : null;
}

export function isConversationExpired(
  conversation: Pick<ConversationRecord, "started_at" | "last_message_at">,
  timezone: string,
  now: Date = new Date(),
  idleTtlMs: number = SESSION_TTL_MS,
): boolean {
  const localStartedDate = localDateForIso(conversation.started_at, timezone);
  if (localStartedDate !== todayLocalDate(timezone, now)) return true;

  const lastMessageAt = conversation.last_message_at ?? conversation.started_at;
  if (!lastMessageAt) return true;
  const lastMessageMs = Date.parse(lastMessageAt);
  if (!Number.isFinite(lastMessageMs)) return true;
  return now.getTime() - lastMessageMs > idleTtlMs;
}

export async function loadHistory(
  db: SupabaseClient,
  userId: string,
  conversationId: string,
  limit = MESSAGE_HISTORY_LIMIT,
): Promise<MessageRecord[]> {
  const { data, error } = await db
    .from("messages")
    .select("id,role,content,transcript,meta,created_at")
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ([...(data ?? [])] as MessageRecord[]).reverse();
}

export function lastAssistantDecisions(history: MessageRecord[], count = 2): OrchestratorDecision[] {
  return history
    .filter((message) => message.role === "assistant")
    .map((message) => (message.meta?.orchestrator_decision ?? null) as OrchestratorDecision | null)
    .filter((decision): decision is OrchestratorDecision => Boolean(decision?.next_phase))
    .slice(-count);
}

export async function summarizeConversationIfNeeded(
  db: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<string | null> {
  const { data: existing, error: existingError } = await db
    .from("conversation_summaries")
    .select("summary_text")
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.summary_text) return String(existing.summary_text);
  return null;
}

export async function loadDayBackground(
  db: SupabaseClient,
  userId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<string> {
  const dayStartUtc = DateTime.fromISO(todayLocalDate(timezone, now), { zone: timezone || "UTC" }).startOf("day").toUTC().toISO();
  if (!dayStartUtc) return "";
  const { data, error } = await db
    .from("conversation_summaries")
    .select("summary_text,generated_at")
    .eq("user_id", userId)
    .gte("generated_at", dayStartUtc)
    .order("generated_at", { ascending: true })
    .limit(5);
  if (error) throw error;
  return (data ?? [])
    .map((item) => String(item.summary_text ?? "").trim())
    .filter((line) => line.length > 12 && !line.startsWith("["))
    .map((line, index) => `Фрагмент ${index + 1}: ${line}`)
    .join("\n\n")
    .slice(0, 4000);
}
