import type { SupabaseClient } from "@supabase/supabase-js";

import type { OrchestratorDecision } from "../../../_utils/orchestrator";

export const MESSAGE_HISTORY_LIMIT = 40;

export type MessageRecord = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string | null;
  transcript: string | null;
  meta: Record<string, unknown> | null;
  created_at: string | null;
};

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
