import type { SupabaseClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";

import type { OrchestratorDecision } from "@legacy/app/api/_utils/orchestrator";

export const MESSAGE_HISTORY_LIMIT = 40;
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

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
): boolean {
  const localStartedDate = localDateForIso(conversation.started_at, timezone);
  if (localStartedDate !== todayLocalDate(timezone, now)) return true;

  const lastMessageAt = conversation.last_message_at ?? conversation.started_at;
  if (!lastMessageAt) return true;
  const lastMessageMs = Date.parse(lastMessageAt);
  if (!Number.isFinite(lastMessageMs)) return true;
  return now.getTime() - lastMessageMs > SESSION_TTL_MS;
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

  const history = await loadHistory(db, userId, conversationId, 20);
  const lines = history
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => {
      const text = String(message.content ?? message.transcript ?? "").trim();
      if (!text) return null;
      return `${message.role === "user" ? "Пользователь" : "Ассистент"}: ${text}`;
    })
    .filter(Boolean) as string[];
  if (!lines.length) return null;

  const summary = lines.slice(-12).join("\n").slice(0, 3000);
  const { error } = await db.from("conversation_summaries").upsert({
    user_id: userId,
    conversation_id: conversationId,
    summary_text: summary,
    key_topics: [],
    chakras_mentioned: [],
    practices_mentioned: [],
    plans: [],
  });
  if (error) throw error;
  return summary;
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
    .map((item, index) => `Фрагмент ${index + 1}: ${String(item.summary_text ?? "").trim()}`)
    .filter((line) => line.length > 12)
    .join("\n\n")
    .slice(0, 4000);
}
