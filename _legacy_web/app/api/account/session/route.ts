import { createServiceSupabase, errorResponse } from "../../_utils/supabase";
import { corsJson, corsPreflight, hashOtt, signCabinetToken, withCors } from "../_utils";
import { buildAccountOverview } from "../overview-data";

// Обмен OTT на кабинетную сессию. Вызывается страницей Личного кабинета
// на zamkovoi.yoga (CORS ограничен доменом сайта).
export const runtime = "nodejs";

export function OPTIONS() {
  return corsPreflight();
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { ott?: string; currency?: string } | null;
    const ott = body?.ott?.trim();
    if (!ott) return corsJson({ error: "ott is required" }, { status: 400 });

    const db = createServiceSupabase();

    // Атомарное гашение: UPDATE проходит только у первого запроса с этим токеном.
    const { data: tokenRow, error } = await db
      .from("web_ott_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("token_hash", hashOtt(ott))
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .select("user_id")
      .maybeSingle();
    if (error) throw error;
    if (!tokenRow) {
      return corsJson({ error: "Token expired or already used" }, { status: 401 });
    }

    const overview = await buildAccountOverview(db, tokenRow.user_id, { currency: body?.currency });
    return corsJson({
      sessionToken: signCabinetToken(tokenRow.user_id),
      overview,
    });
  } catch (error) {
    return withCors(errorResponse(error));
  }
}
