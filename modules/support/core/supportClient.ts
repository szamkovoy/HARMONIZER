import { getSupabase } from "@/services/supabase";

export const MAX_SUPPORT_MESSAGE_LENGTH = 4000;

export async function sendSupportMessage(
  userId: string,
  body: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, message: "offline" };
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, message: "empty" };
  const { error } = await supabase
    .from("support_messages")
    .insert({ user_id: userId, body: trimmed.slice(0, MAX_SUPPORT_MESSAGE_LENGTH) });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}
