import { createServiceSupabase, errorResponse, json, requireUserId } from "../../_utils/supabase";
import { generateOtt, OTT_TTL_MS } from "../_utils";

// Выдача одноразового токена перехода app -> Личный кабинет.
// Вызывается приложением с Bearer JWT Supabase (кнопка «Личный кабинет»).
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const db = createServiceSupabase();
    const { token, hash } = generateOtt();
    const now = Date.now();

    const { error } = await db.from("web_ott_tokens").insert({
      user_id: userId,
      token_hash: hash,
      expires_at: new Date(now + OTT_TTL_MS).toISOString(),
    });
    if (error) throw error;

    // Мусор не накапливаем: попутно удаляем свои протухшие токены.
    await db
      .from("web_ott_tokens")
      .delete()
      .eq("user_id", userId)
      .lt("expires_at", new Date(now - OTT_TTL_MS).toISOString());

    return json({ ott: token, expiresInSec: Math.floor(OTT_TTL_MS / 1000) });
  } catch (error) {
    return errorResponse(error);
  }
}
