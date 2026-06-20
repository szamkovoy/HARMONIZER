import type { SupabaseClient } from "@supabase/supabase-js";

import {
  validateHistoryHasDurationAndType,
  type PracticePickMarker,
} from "@legacy/app/api/_utils/markers";
import { attachThumbnailToPracticeRecommendation } from "@legacy/app/api/_utils/vimeo";
import {
  buildPracticeAssistantReason,
  buildPracticeCardSummary,
  normalizeModelPracticeCardBlurb,
} from "@legacy/app/api/communicator/v2/dialog/practiceCardSummary";
import {
  choosePractice,
  applyPracticeCardOverridesToPayload,
  publicPracticePickedPayload,
  type PracticeSelectionContext,
} from "@legacy/app/api/communicator/v2/dialog/practiceSelection";
import type { MessageRecord } from "@legacy/app/api/communicator/v2/dialog/dialogHelpers";
import {
  clipDurationMinutesToSelectableMinutes,
  selectableDurationMinutesForPracticeCard,
} from "@shared/assistantSelectableDurations";

/**
 * Resolve the visible practice card for a PRACTICE branch finalization.
 * Reuses the existing selector engine (`choosePractice`) and duration clipping;
 * for breath/meditation duration + chakra stay editable on the card, for yoga
 * the catalog decides. Returns null when no practice can be resolved.
 */
export async function resolvePracticeCard(params: {
  db: SupabaseClient;
  userId: string;
  marker: PracticePickMarker | null;
  context: PracticeSelectionContext & { user?: { locale?: string | null } };
  userMessage: string;
  history: MessageRecord[];
  conversationId: string;
}): Promise<Record<string, unknown> | null> {
  const { db, userId, marker, context, userMessage, history, conversationId } = params;
  const validation = validateHistoryHasDurationAndType([
    ...history.filter((m) => m.role === "user"),
    { role: "user" as const, content: userMessage },
  ]);

  if (!marker && !validation.confident) return null;

  const choose = await choosePractice(db, userId, marker, context, userMessage, history);
  if (!choose.picked) {
    console.warn(
      "[DIALOG_FSM] choosePractice returned null",
      JSON.stringify({ conversationId, confident: validation.confident, hasMarker: Boolean(marker) }),
    );
    return null;
  }

  const { picked, markerIdResolved, chakraId, preferredDurationMin, historyKindConflictResolved } = choose;

  const historyDurationMin =
    validation.confident && validation.durationSec != null ? Math.round(validation.durationSec / 60) : null;
  const markerDurationMin = marker?.durationMin ?? null;

  let rawMinutes: number | null = null;
  if (validation.confident && validation.durationSec != null) {
    rawMinutes = Math.round(validation.durationSec / 60);
  } else {
    rawMinutes = markerDurationMin ?? preferredDurationMin;
  }

  const isYoga = picked.kind === "yoga";
  const selectable = !isYoga ? selectableDurationMinutesForPracticeCard(picked.kind) : [];

  let preClip = rawMinutes;
  if (preClip == null && !isYoga && selectable.length) {
    preClip = picked.durationSec
      ? Math.max(1, Math.round(picked.durationSec / 60))
      : picked.kind === "breath"
        ? 10
        : 3;
  }

  let finalDurationMin: number | null = preClip;
  if (!isYoga && selectable.length && preClip != null) {
    finalDurationMin = clipDurationMinutesToSelectableMinutes(preClip, selectable).value;
  }

  const canUseMarkerCardBlurb =
    Boolean(marker?.cardBlurb) && !historyKindConflictResolved && (marker?.id === "default" || markerIdResolved === true);
  const cardBlurb = canUseMarkerCardBlurb ? normalizeModelPracticeCardBlurb(marker!.cardBlurb) : null;
  const cardSummary = buildPracticeCardSummary({
    kind: picked.kind,
    slug: picked.slug,
    chakraIds: picked.chakraIds ?? [],
    locale: context.user?.locale,
    userMessage,
    modelCardBlurb: cardBlurb,
  });
  const assistantReason = buildPracticeAssistantReason({
    kind: picked.kind,
    chakraIds: picked.chakraIds ?? [],
    locale: context.user?.locale,
  });
  const publicPayload = await attachThumbnailToPracticeRecommendation(
    publicPracticePickedPayload({ ...picked, reason: assistantReason, card_blurb: cardSummary }, assistantReason),
    295,
  );
  const overrides: { durationMin?: number | null; chakraIndex?: number } | undefined = isYoga
    ? undefined
    : { durationMin: finalDurationMin, chakraIndex: marker?.chakra ?? chakraId };

  const syncedPayload = overrides
    ? applyPracticeCardOverridesToPayload(publicPayload, overrides)
    : publicPayload;

  return {
    ...syncedPayload,
    ...(overrides ? { overrides } : {}),
    ...(markerIdResolved === false ? { markerIdResolved: false } : {}),
  };
}
