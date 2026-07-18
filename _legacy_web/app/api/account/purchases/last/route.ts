import { createServiceSupabase, errorResponse, json, requireUserId } from "../../../_utils/supabase";

// Последняя разовая (ONE_TIME) покупка пользователя — книга/вебинар/курс.
// Вызывается приложением с Bearer JWT Supabase после возврата из Личного
// кабинета, чтобы показать модалку «спасибо за покупку». Таблица
// payment_contracts закрыта для клиента (RLS без политик), поэтому чтение
// только через service role здесь.
//
// GET /api/account/purchases/last
//   -> { purchase: { kind:"book"|"webinar"|..., productRef: string|null, createdAt: string } | null }
//
// `kind` — это tier из payment_contracts для one_time (webinar/book/...).
// Приложение сравнивает createdAt с временем визита в кабинет (cabinetVisit.ts)
// и благодарит за покупку, появившуюся после визита.
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const userId = await requireUserId(req);
    const db = createServiceSupabase();

    const { data, error } = await db
      .from("payment_contracts")
      .select("tier,product_ref,created_at,contract_id")
      .eq("user_id", userId)
      .eq("product_kind", "one_time")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return json({ purchase: null });

    return json({
      purchase: {
        kind: data.tier,
        productRef: data.product_ref ?? null,
        createdAt: data.created_at,
        contractId: data.contract_id,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
