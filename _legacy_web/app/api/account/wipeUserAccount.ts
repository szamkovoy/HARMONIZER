/**
 * Единая точка удаления аккаунта (приложение + админка).
 *
 * Обязательный порядок:
 * 1) отменить активные recurring-подписки во ВСЕХ платёжных провайдерах
 *    (`cancelActiveSubscriptionsForUser` → `cancelProviderSubscription`);
 * 2) снимок buyer_email на payment_contracts / payments (отчёты без user_id);
 * 3) auth.admin.deleteUser — PII каскадом; леджер остаётся (ON DELETE SET NULL).
 *
 * Новый провайдер: добавить case в cancelProviderSubscription — иначе delete
 * упадёт (fail-closed), чтобы списания не продолжались после wipe.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { cancelActiveSubscriptionsForUser } from "./cancelActiveSubscriptions";

export async function wipeUserAccount(
  db: SupabaseClient,
  params: { userId: string; email: string },
): Promise<{ cancelledCount: number }> {
  const email = params.email.trim();
  if (!email) {
    throw new Error("User has no email");
  }

  const { cancelledCount } = await cancelActiveSubscriptionsForUser(db, {
    userId: params.userId,
    email,
  });

  const now = new Date().toISOString();
  const { error: contractsEmailError } = await db
    .from("payment_contracts")
    .update({ buyer_email: email, updated_at: now })
    .eq("user_id", params.userId);
  if (contractsEmailError) throw contractsEmailError;

  const { error: paymentsEmailError } = await db
    .from("payments")
    .update({ buyer_email: email })
    .eq("user_id", params.userId);
  if (paymentsEmailError) throw paymentsEmailError;

  const { error: deleteError } = await db.auth.admin.deleteUser(params.userId);
  if (deleteError) throw deleteError;

  return { cancelledCount };
}
