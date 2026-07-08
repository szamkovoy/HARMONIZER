import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../_utils/supabase";
import { emailsByUserId } from "../_utils/authEmails";

export const runtime = "nodejs";

/** Входящие сообщения поддержки: необработанные сверху, затем по дате. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const db = createServiceSupabase();
    const { data, error } = await db
      .from("support_messages")
      .select("id, user_id, body, created_at, processed_at, users(display_name, membership_tier)")
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) throw error;

    const emails = await emailsByUserId(db, [...new Set((data ?? []).map((m) => m.user_id))]);
    const messages = (data ?? [])
      .map((m) => {
        const user = m.users as { display_name?: string | null; membership_tier?: string | null } | null;
        return {
          id: m.id,
          user_id: m.user_id,
          body: m.body,
          created_at: m.created_at,
          processed_at: m.processed_at,
          display_name: user?.display_name?.trim() || "—",
          email: emails.get(m.user_id) ?? "—",
          membership_tier: user?.membership_tier ?? "free",
        };
      })
      .sort((a, b) => {
        const aDone = a.processed_at ? 1 : 0;
        const bDone = b.processed_at ? 1 : 0;
        return aDone - bDone || b.created_at.localeCompare(a.created_at);
      });

    return json({ messages });
  } catch (error) {
    return errorResponse(error);
  }
}
