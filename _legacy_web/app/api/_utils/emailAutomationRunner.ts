/**
 * Welcome drip runner (phase B1).
 * Enrolls app contacts into active automations; sends due steps via marketingMail.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { parseStringRecord } from "./contentLocaleFallback";
import { resolveExactEmailCopy } from "./emailCopy";
import {
  buildSignedUnsubscribeUrl,
  generateUnsubscribeToken,
} from "./emailUnsubscribe";
import { wrapMarketingEmailHtml } from "./emailTemplate";
import { htmlToPlaintext, sendMarketingEmail, sleep } from "./marketingMail";

type Step = {
  id: string;
  automation_id: string;
  position: number;
  delay_hours: number;
  subject: string;
  subject_i18n: Record<string, string> | null;
  html_body: string;
  html_body_i18n: Record<string, string> | null;
};

type Enrollment = {
  id: string;
  automation_id: string;
  contact_id: string;
  current_position: number;
  next_step_at: string | null;
  status: string;
};

/** Enroll active marketing contacts that match welcome triggers and are not yet enrolled. */
export async function enrollWelcomeContacts(db: SupabaseClient): Promise<number> {
  const { data: automation, error } = await db
    .from("email_automations")
    .select("id, key, trigger_type, is_active")
    .eq("key", "welcome_after_install")
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  if (!automation) return 0;

  const { data: firstStep } = await db
    .from("email_automation_steps")
    .select("delay_hours")
    .eq("automation_id", automation.id)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!firstStep) return 0;

  await db.rpc("sync_email_contacts_from_users");

  const { data: contacts, error: contactsError } = await db
    .from("email_contacts")
    .select("id, user_id")
    .eq("marketing_status", "active")
    .not("user_id", "is", null)
    .limit(5000);
  if (contactsError) throw contactsError;
  if (!contacts?.length) return 0;

  const userIds = contacts.map((c) => c.user_id).filter(Boolean) as string[];
  const { data: users, error: usersError } = await db
    .from("users")
    .select("id, onboarded_at, last_seen_at")
    .in("id", userIds);
  if (usersError) throw usersError;

  const eligibleUsers = new Set(
    (users ?? [])
      .filter((u) => u.onboarded_at || u.last_seen_at)
      .map((u) => u.id),
  );

  const { data: existing } = await db
    .from("email_automation_enrollments")
    .select("contact_id")
    .eq("automation_id", automation.id);
  const enrolled = new Set((existing ?? []).map((e) => e.contact_id));

  const delayMs = Math.max(0, Number(firstStep.delay_hours) || 0) * 3600_000;
  const nextAt = new Date(Date.now() + delayMs).toISOString();

  const rows = contacts
    .filter((c) => c.user_id && eligibleUsers.has(c.user_id) && !enrolled.has(c.id))
    .map((c) => ({
      automation_id: automation.id,
      contact_id: c.id,
      current_position: 0,
      next_step_at: nextAt,
      status: "active",
    }));

  if (!rows.length) return 0;

  const CHUNK = 200;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error: insertError, data } = await db
      .from("email_automation_enrollments")
      .upsert(rows.slice(i, i + CHUNK), {
        onConflict: "automation_id,contact_id",
        ignoreDuplicates: true,
      })
      .select("id");
    if (insertError) throw insertError;
    inserted += data?.length ?? 0;
  }
  return inserted;
}

/** Send due automation steps (position is 0-based index into ordered steps). */
export async function processDueAutomationSteps(db: SupabaseClient): Promise<{
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
}> {
  const nowIso = new Date().toISOString();
  const { data: due, error } = await db
    .from("email_automation_enrollments")
    .select("id, automation_id, contact_id, current_position, next_step_at, status")
    .eq("status", "active")
    .lte("next_step_at", nowIso)
    .order("next_step_at", { ascending: true })
    .limit(50);
  if (error) throw error;
  if (!due?.length) return { processed: 0, sent: 0, skipped: 0, failed: 0 };

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const enrollment of due as Enrollment[]) {
    const { data: automation } = await db
      .from("email_automations")
      .select("id, is_active")
      .eq("id", enrollment.automation_id)
      .maybeSingle();
    if (!automation?.is_active) {
      await db
        .from("email_automation_enrollments")
        .update({ status: "cancelled", updated_at: nowIso })
        .eq("id", enrollment.id);
      continue;
    }

    const { data: steps } = await db
      .from("email_automation_steps")
      .select(
        "id, automation_id, position, delay_hours, subject, subject_i18n, html_body, html_body_i18n",
      )
      .eq("automation_id", enrollment.automation_id)
      .order("position", { ascending: true });
    const ordered = (steps ?? []) as Step[];
    const step = ordered[enrollment.current_position];
    if (!step) {
      await db
        .from("email_automation_enrollments")
        .update({ status: "completed", next_step_at: null, updated_at: nowIso })
        .eq("id", enrollment.id);
      continue;
    }

    const { data: contact } = await db
      .from("email_contacts")
      .select("id, email, locale, marketing_status, unsubscribe_token")
      .eq("id", enrollment.contact_id)
      .maybeSingle();

    if (!contact || contact.marketing_status !== "active") {
      await db
        .from("email_automation_enrollments")
        .update({ status: "cancelled", updated_at: nowIso })
        .eq("id", enrollment.id);
      skipped += 1;
      continue;
    }

    const copy = resolveExactEmailCopy(contact.locale, {
      subject: step.subject,
      htmlBody: step.html_body,
      subjectI18n: parseStringRecord(step.subject_i18n),
      htmlBodyI18n: parseStringRecord(step.html_body_i18n),
    });

    if (!copy) {
      // Skip this step but advance (avoid stuck enrollments).
      await advanceEnrollment(db, enrollment, ordered, nowIso);
      skipped += 1;
      continue;
    }

    let token = contact.unsubscribe_token;
    if (!token) {
      token = generateUnsubscribeToken();
      await db
        .from("email_contacts")
        .update({ unsubscribe_token: token })
        .eq("id", contact.id);
    }
    const unsubscribeUrl = buildSignedUnsubscribeUrl(token);
    const html = wrapMarketingEmailHtml({
      bodyHtml: copy.htmlBody,
      unsubscribeUrl,
      previewText: copy.subject,
    });

    const result = await sendMarketingEmail({
      to: contact.email,
      subject: copy.subject,
      html,
      text: htmlToPlaintext(html),
      unsubscribeUrl,
      tags: [
        { name: "automation_id", value: enrollment.automation_id },
        { name: "step", value: String(step.position) },
      ],
    });

    if (result.ok) {
      sent += 1;
      await db
        .from("email_contacts")
        .update({ last_sent_at: nowIso })
        .eq("id", contact.id);
    } else {
      failed += 1;
    }

    await advanceEnrollment(db, enrollment, ordered, nowIso);
    await sleep(400);
  }

  return { processed: due.length, sent, skipped, failed };
}

async function advanceEnrollment(
  db: SupabaseClient,
  enrollment: Enrollment,
  ordered: Step[],
  nowIso: string,
): Promise<void> {
  const nextPos = enrollment.current_position + 1;
  const nextStep = ordered[nextPos];
  if (!nextStep) {
    await db
      .from("email_automation_enrollments")
      .update({
        status: "completed",
        current_position: nextPos,
        next_step_at: null,
        updated_at: nowIso,
      })
      .eq("id", enrollment.id);
    return;
  }
  const delayMs = Math.max(0, Number(nextStep.delay_hours) || 0) * 3600_000;
  await db
    .from("email_automation_enrollments")
    .update({
      current_position: nextPos,
      next_step_at: new Date(Date.now() + delayMs).toISOString(),
      updated_at: nowIso,
    })
    .eq("id", enrollment.id);
}

export async function runEmailAutomations(db: SupabaseClient) {
  const enrolled = await enrollWelcomeContacts(db);
  const due = await processDueAutomationSteps(db);
  return { enrolled, ...due };
}
