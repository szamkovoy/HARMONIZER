import { getSupabase } from "@/services/supabase";

export type InboxNotificationKind = "opportunity";

/**
 * Persist a personal inbox row (opportunity reminders). Idempotent on source_key.
 */
export async function recordInboxNotification(params: {
  kind: InboxNotificationKind;
  title: string;
  body?: string;
  linkUrl?: string | null;
  sourceKey: string;
}): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const title = params.title.trim();
  if (!title || !params.sourceKey.trim()) return null;

  const { data, error } = await supabase.rpc("record_inbox_notification", {
    p_kind: params.kind,
    p_title: title,
    p_body: params.body ?? "",
    p_link_url: params.linkUrl ?? null,
    p_source_key: params.sourceKey.trim(),
  });
  if (error) {
    if (__DEV__) console.warn("[notifications] record_inbox_notification", error.message);
    return null;
  }
  return typeof data === "string" ? data : null;
}
