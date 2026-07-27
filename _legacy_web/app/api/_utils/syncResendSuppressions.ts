/**
 * Mirror Resend account suppressions into email_contacts.marketing_status.
 * Only upgrades active → suppressed/complained (never overwrites unsubscribed).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  listResendSuppressions,
  type ResendSuppression,
} from "./resendMarketingApi";

export async function applyResendSuppressionsToContacts(
  db: SupabaseClient,
  suppressions: ResendSuppression[],
): Promise<number> {
  let updated = 0;
  for (const s of suppressions) {
    const status = s.origin === "complaint" ? "complained" : "suppressed";
    const { data } = await db
      .from("email_contacts")
      .update({
        marketing_status: status,
        updated_at: new Date().toISOString(),
      })
      .eq("email_normalized", s.email.toLowerCase())
      .in("marketing_status", ["active"])
      .select("id")
      .maybeSingle();
    if (data) updated += 1;
  }
  return updated;
}

export async function syncResendSuppressionsToContacts(
  db: SupabaseClient,
  opts?: { maxPages?: number },
): Promise<{ resend_count: number; contacts_updated: number; error: string | null }> {
  const { suppressions, error } = await listResendSuppressions({
    limit: 100,
    maxPages: opts?.maxPages ?? 5,
  });
  if (error && !suppressions.length) {
    return { resend_count: 0, contacts_updated: 0, error };
  }
  const updated = await applyResendSuppressionsToContacts(db, suppressions);
  return {
    resend_count: suppressions.length,
    contacts_updated: updated,
    error: error ?? null,
  };
}
