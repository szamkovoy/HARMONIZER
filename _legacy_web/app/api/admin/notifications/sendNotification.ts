import { parseStringRecord } from "../../_utils/contentLocaleFallback";
import {
  resolveExactNotificationCopy,
  truncatePushBody,
} from "../../_utils/notificationCopy";
import { createServiceSupabase } from "../../_utils/supabase";
import { REMOTE_PUSH_CHANNEL_ID, sendExpoPushMessages } from "./expoPush";
import { parseSegment, resolveSegmentUserIds, segmentLabel } from "./segment";

type Db = ReturnType<typeof createServiceSupabase>;

export type NotificationCopyInput = {
  title: string;
  body: string;
  titleI18n: Record<string, string>;
  bodyI18n: Record<string, string>;
  linkUrl: string | null;
  segmentRaw: string;
};

/**
 * Deliveries + Expo push for an existing notifications row.
 * Sets recipient_count / push_* / sent_at. Refuses if already sent.
 */
export async function sendExistingNotification(
  db: Db,
  notificationId: string,
): Promise<{
  notification: Record<string, unknown>;
  skipped_no_locale_copy: number;
}> {
  const { data: notification, error } = await db
    .from("notifications")
    .select("*")
    .eq("id", notificationId)
    .maybeSingle();
  if (error) throw error;
  if (!notification) {
    const err = new Error("Уведомление не найдено");
    (err as Error & { status: number }).status = 404;
    throw err;
  }
  if (notification.sent_at) {
    const err = new Error("Уведомление уже отправлено");
    (err as Error & { status: number }).status = 409;
    throw err;
  }

  const input: NotificationCopyInput = {
    title: (notification.title as string) ?? "",
    body: (notification.body as string) ?? "",
    titleI18n: parseStringRecord(notification.title_i18n),
    bodyI18n: parseStringRecord(notification.body_i18n),
    linkUrl: (notification.link_url as string | null) ?? null,
    segmentRaw: (notification.segment as string) ?? "all",
  };

  return deliverNotification(db, notificationId, input, {
    updateSegmentLabel: true,
  });
}

/** Create row + deliver immediately (user-card quick push). */
export async function createAndSendNotification(
  db: Db,
  input: NotificationCopyInput,
): Promise<{
  notification: Record<string, unknown>;
  skipped_no_locale_copy: number;
}> {
  const segment = parseSegment(input.segmentRaw);
  const label = await segmentLabel(db, segment);
  const displayTitle =
    input.title ||
    input.titleI18n.en ||
    Object.values(input.titleI18n).find((v) => v.trim()) ||
    "Уведомление";

  const { data: notification, error: insertError } = await db
    .from("notifications")
    .insert({
      title: input.title || displayTitle,
      body: input.body,
      title_i18n: input.titleI18n,
      body_i18n: input.bodyI18n,
      link_url: input.linkUrl,
      segment: input.segmentRaw,
      segment_label: label,
      recipient_count: 0,
    })
    .select("*")
    .single();
  if (insertError) throw insertError;

  return deliverNotification(db, notification.id as string, {
    ...input,
    title: (notification.title as string) || input.title,
    body: (notification.body as string) ?? input.body,
  });
}

async function deliverNotification(
  db: Db,
  notificationId: string,
  input: NotificationCopyInput,
  opts?: { updateSegmentLabel?: boolean },
): Promise<{
  notification: Record<string, unknown>;
  skipped_no_locale_copy: number;
}> {
  const segment = parseSegment(input.segmentRaw);
  const segmentUserIds = await resolveSegmentUserIds(db, segment);
  if (segmentUserIds.length === 0) {
    const err = new Error("В выбранном сегменте нет пользователей");
    (err as Error & { status: number }).status = 400;
    throw err;
  }

  const copySource = {
    title:
      input.title ||
      input.titleI18n.en ||
      Object.values(input.titleI18n).find((v) => v.trim()) ||
      "",
    body: input.body,
    titleI18n: input.titleI18n,
    bodyI18n: input.bodyI18n,
  };

  const { data: userRows, error: usersError } = await db
    .from("users")
    .select("id, locale")
    .in("id", segmentUserIds);
  if (usersError) throw usersError;

  const localeByUser = new Map<string, string | null>();
  for (const row of userRows ?? []) {
    localeByUser.set(row.id, row.locale ?? null);
  }

  const eligibleUserIds: string[] = [];
  const skippedNoLocaleCopy: string[] = [];
  for (const userId of segmentUserIds) {
    const exact = resolveExactNotificationCopy(localeByUser.get(userId) ?? "ru", {
      title: input.title || copySource.title,
      body: input.body,
      titleI18n: input.titleI18n,
      bodyI18n: input.bodyI18n,
    });
    if (exact) eligibleUserIds.push(userId);
    else skippedNoLocaleCopy.push(userId);
  }

  if (eligibleUserIds.length === 0) {
    const err = new Error(
      "Нет получателей с переводом на язык их профиля. Заполните вкладки языков или смените сегмент.",
    );
    (err as Error & { status: number; skipped_no_locale_copy: number }).status = 400;
    (err as Error & { skipped_no_locale_copy: number }).skipped_no_locale_copy =
      skippedNoLocaleCopy.length;
    throw err;
  }

  const linkUrl = input.linkUrl;
  const storedSource = {
    title: copySource.title,
    body: copySource.body,
    titleI18n: copySource.titleI18n,
    bodyI18n: copySource.bodyI18n,
  };

  const deliveryRows = eligibleUserIds.flatMap((userId) => {
    const exact = resolveExactNotificationCopy(
      localeByUser.get(userId) ?? "ru",
      storedSource,
    );
    if (!exact) return [];
    return [
      {
        notification_id: notificationId,
        user_id: userId,
        kind: "admin" as const,
        title: exact.title,
        body: exact.body,
        link_url: linkUrl,
      },
    ];
  });

  const DELIVERY_CHUNK = 500;
  for (let i = 0; i < deliveryRows.length; i += DELIVERY_CHUNK) {
    const { error: deliveryError } = await db
      .from("notification_deliveries")
      .insert(deliveryRows.slice(i, i + DELIVERY_CHUNK));
    if (deliveryError) throw deliveryError;
  }

  const { data: tokens, error: tokensError } = await db
    .from("push_tokens")
    .select("token, user_id")
    .eq("is_active", true)
    .in("user_id", eligibleUserIds);
  if (tokensError) throw tokensError;

  const messages = (tokens ?? []).flatMap(({ token, user_id }) => {
    const exact = resolveExactNotificationCopy(
      localeByUser.get(user_id) ?? "ru",
      storedSource,
    );
    if (!exact) return [];
    return [
      {
        to: token,
        title: exact.title,
        body: truncatePushBody(exact.body),
        channelId: REMOTE_PUSH_CHANNEL_ID,
        data: {
          notificationId,
          title: exact.title,
          body: exact.body.slice(0, 2000),
          ...(linkUrl ? { url: linkUrl } : {}),
        },
      },
    ];
  });

  let outcome = { okCount: 0, errorCount: 0, staleTokens: [] as string[] };
  try {
    outcome = await sendExpoPushMessages(messages);
    if (outcome.staleTokens.length > 0) {
      const { error: staleError } = await db
        .from("push_tokens")
        .update({ is_active: false })
        .in("token", outcome.staleTokens);
      if (staleError) console.error("[admin/notifications] stale token update", staleError);
    }
  } catch (pushError) {
    console.error("[admin/notifications] push phase failed", pushError);
    outcome = {
      okCount: 0,
      errorCount: messages.length,
      staleTokens: [],
    };
  }

  const patch: Record<string, unknown> = {
    recipient_count: eligibleUserIds.length,
    push_sent_count: outcome.okCount,
    push_error_count: outcome.errorCount,
    sent_at: new Date().toISOString(),
  };
  if (opts?.updateSegmentLabel) {
    patch.segment_label = await segmentLabel(db, segment);
  }

  const { data: updated, error: updateError } = await db
    .from("notifications")
    .update(patch)
    .eq("id", notificationId)
    .select(
      "id, title, body, title_i18n, body_i18n, link_url, segment, segment_label, recipient_count, push_sent_count, push_error_count, sent_at, created_at",
    )
    .single();
  if (updateError) throw updateError;

  return {
    notification: updated as Record<string, unknown>,
    skipped_no_locale_copy: skippedNoLocaleCopy.length,
  };
}
