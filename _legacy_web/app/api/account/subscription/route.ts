import { createServiceSupabase, errorResponse } from "../../_utils/supabase";
import { cabinetBearerUserId, corsJson, corsPreflight, withCors } from "../_utils";
import { cancelLavaSubscription } from "../lava";

// Текущая подписка пользователя (GET) и её отмена (DELETE).
// Вызывается страницей Личного кабинета (кабинетная сессия, CORS сайта).
export const runtime = "nodejs";

export function OPTIONS() {
  return corsPreflight();
}

type ContractRow = {
  contract_id: string;
  tier: string;
  currency: string;
  amount: number | null;
  status: string;
  current_period_end: string | null;
  cancelled_at: string | null;
  created_at: string;
};

async function activeContract(userId: string): Promise<ContractRow | null> {
  const db = createServiceSupabase();
  const { data, error } = await db
    .from("payment_contracts")
    .select("contract_id,tier,currency,amount,status,current_period_end,cancelled_at,created_at")
    .eq("user_id", userId)
    .in("status", ["active", "cancelled"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function GET(req: Request) {
  try {
    const userId = cabinetBearerUserId(req);
    if (!userId) return corsJson({ error: "Unauthorized" }, { status: 401 });
    const contract = await activeContract(userId);
    return corsJson({ subscription: contract });
  } catch (error) {
    return withCors(errorResponse(error));
  }
}

export async function DELETE(req: Request) {
  try {
    const userId = cabinetBearerUserId(req);
    if (!userId) return corsJson({ error: "Unauthorized" }, { status: 401 });

    const contract = await activeContract(userId);
    if (!contract || contract.status !== "active") {
      return corsJson({ error: "No active subscription" }, { status: 404 });
    }

    const db = createServiceSupabase();
    const { data: authData } = await db.auth.admin.getUserById(userId);
    const email = authData?.user?.email;
    if (!email) return corsJson({ error: "User has no email" }, { status: 409 });

    await cancelLavaSubscription({ contractId: contract.contract_id, email });

    // Помечаем сразу (вебхук subscription.cancelled продублирует идемпотентно).
    // Доступ у пользователя остаётся до current_period_end: users.membership_*
    // не трогаем — тариф "сгорит" сам по membership_expires_at.
    const { error: updateError } = await db
      .from("payment_contracts")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("contract_id", contract.contract_id);
    if (updateError) throw updateError;

    return corsJson({
      cancelled: true,
      accessUntil: contract.current_period_end,
    });
  } catch (error) {
    return withCors(errorResponse(error));
  }
}
