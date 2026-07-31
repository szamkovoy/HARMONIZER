/**
 * Отмена всех активных recurring-подписок пользователя во всех платёжных
 * провайдерах перед удалением аккаунта (и переиспользуемо для других сценариев).
 *
 * Обязательная точка расширения: каждый новый шлюз — новый `case` в
 * `cancelProviderSubscription`. Unknown provider → throw (fail-closed).
 *
 * Провайдеры:
 * - `lavatop` — Lava DELETE /api/v1/subscriptions
 * - `yookassa` — пометить saved payment methods inactive (ЮKassa не удаляет
 *   method на своей стороне; мы перестаём слать charge)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { cancelLavaSubscription } from "./lava";

export type ActiveSubscriptionContract = {
  contract_id: string;
  provider: string;
  product_kind: string | null;
};

/**
 * Отмена у шлюза (без обновления строки в БД).
 */
export async function cancelProviderSubscription(params: {
  provider: string;
  contractId: string;
  email: string;
  userId?: string;
  db?: SupabaseClient;
}): Promise<void> {
  switch (params.provider) {
    case "lavatop":
      await cancelLavaSubscription({ contractId: params.contractId, email: params.email });
      return;
    case "yookassa": {
      // ЮKassa: удаление method только на нашей стороне (docs: stop using payment_method_id).
      const db = params.db;
      const userId = params.userId;
      if (!db || !userId) {
        console.warn(
          "[cancel] yookassa cancel without db/userId — methods may stay active until wipe path",
        );
        return;
      }
      const nowIso = new Date().toISOString();
      const { error: methodsError } = await db
        .from("yookassa_payment_methods")
        .update({ status: "inactive", updated_at: nowIso })
        .eq("user_id", userId)
        .in("status", ["active", "pending"]);
      if (methodsError) throw methodsError;

      const { error: contractError } = await db
        .from("payment_contracts")
        .update({ payment_method_id: null, updated_at: nowIso })
        .eq("contract_id", params.contractId);
      if (contractError) throw contractError;
      return;
    }
    default:
      throw new Error(`Unsupported payment provider for cancel: ${params.provider}`);
  }
}

/**
 * Находит active subscription-контракты пользователя, отменяет их у провайдера
 * и помечает `cancelled` в БД. One-time покупки не трогает.
 */
export async function cancelActiveSubscriptionsForUser(
  db: SupabaseClient,
  params: { userId: string; email: string },
): Promise<{ cancelledCount: number }> {
  const { data, error } = await db
    .from("payment_contracts")
    .select("contract_id,provider,product_kind,status")
    .eq("user_id", params.userId)
    .eq("status", "active");
  if (error) throw error;

  const subscriptions = (data ?? []).filter((row) => {
    const kind = row.product_kind ?? "subscription";
    return kind === "subscription";
  }) as ActiveSubscriptionContract[];

  let cancelledCount = 0;
  const now = new Date().toISOString();

  for (const contract of subscriptions) {
    await cancelProviderSubscription({
      provider: contract.provider || "lavatop",
      contractId: contract.contract_id,
      email: params.email,
      userId: params.userId,
      db,
    });

    const { error: updateError } = await db
      .from("payment_contracts")
      .update({
        status: "cancelled",
        cancelled_at: now,
        updated_at: now,
      })
      .eq("contract_id", contract.contract_id);
    if (updateError) throw updateError;
    cancelledCount += 1;
  }

  // На всякий случай гасим все active methods пользователя (orphan после wipe).
  const { error: orphanMethodsError } = await db
    .from("yookassa_payment_methods")
    .update({ status: "inactive", updated_at: now })
    .eq("user_id", params.userId)
    .in("status", ["active", "pending"]);
  if (orphanMethodsError) throw orphanMethodsError;

  return { cancelledCount };
}
