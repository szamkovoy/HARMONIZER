/**
 * Отмена всех активных recurring-подписок пользователя во всех платёжных
 * провайдерах перед удалением аккаунта (и переиспользуемо для других сценариев).
 *
 * Обязательная точка расширения: каждый новый шлюз — новый `case` в
 * `cancelProviderSubscription`. Unknown provider → throw (fail-closed).
 *
 * Провайдеры:
 * - `lavatop` — Lava DELETE /api/v1/subscriptions
 * - `yookassa` — пока DB-only (нет автосписаний); при YOOKASSA_RECURRING_ENABLED
 *   здесь ОБЯЗАТЕЛЬНО отозвать saved payment_method / отменить подписку у API
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { cancelLavaSubscription } from "./lava";

export type ActiveSubscriptionContract = {
  contract_id: string;
  provider: string;
  product_kind: string | null;
};

/**
 * Отмена у шлюза (без обновления строки в БД). Для yookassa без saved method — no-op.
 */
export async function cancelProviderSubscription(params: {
  provider: string;
  contractId: string;
  email: string;
}): Promise<void> {
  switch (params.provider) {
    case "lavatop":
      await cancelLavaSubscription({ contractId: params.contractId, email: params.email });
      return;
    case "yookassa":
      // Сейчас: 30-дневный grant без автосписания → gateway cancel не нужен.
      // TODO(YOOKASSA_RECURRING): при включении рекуррента — отозвать
      // payment_method_id / отменить подписку в ЮKassa API до return.
      // Иначе wipeUserAccount пометит cancelled в БД, а списания продолжатся.
      return;
    default:
      // Не молчим: иначе пользователь потеряет аккаунт, а списания продолжатся.
      throw new Error(`Unsupported payment provider for cancel: ${params.provider}`);
  }
}

/**
 * Находит active subscription-контракты пользователя, отменяет их у провайдера
 * и помечает `cancelled` в БД. One-time покупки не трогает.
 * Возвращает число успешно отменённых контрактов.
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
    // До миграции one_time product_kind мог быть null → считаем subscription.
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

  return { cancelledCount };
}
