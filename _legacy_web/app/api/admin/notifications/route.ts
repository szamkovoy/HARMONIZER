import { asContentLocale } from "../../_utils/contentLocales";
import { parseStringRecord } from "../../_utils/contentLocaleFallback";
import { resolveNotificationCopy, truncatePushBody } from "../../_utils/notificationCopy";
import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../_utils/supabase";
import { REMOTE_PUSH_CHANNEL_ID, sendExpoPushMessages } from "./expoPush";
import { parseSegment, resolveSegmentUserIds, segmentLabel } from "./segment";

export const runtime = "nodejs";
export const maxDuration = 120;

/** История рассылок (новые сверху). */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const { data, error } = await createServiceSupabase()
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return json({ notifications: data ?? [] });
  } catch (error) {
    return errorResponse(error);
  }
}

type SendPayload = {
  title?: string;
  body?: string;
  title_i18n?: Record<string, string>;
  body_i18n?: Record<string, string>;
  link_url?: string | null;
  segment?: string;
};

function cleanI18nMap(raw: Record<string, string> | undefined): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "ru") continue;
    const locale = asContentLocale(key);
    const text = typeof value === "string" ? value.trim() : "";
    if (locale && text) out[locale] = text;
  }
  return out;
}

/**
 * Создаёт рассылку: notification → deliveries → Expo push.
 * Copy language = users.locale via resolveNotificationCopy (single server entry).
 */
export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const payload = (await req.json()) as SendPayload;
    const title = payload.title?.trim() ?? "";
    const body = payload.body?.trim() ?? "";
    const titleI18n = cleanI18nMap(payload.title_i18n);
    const bodyI18n = cleanI18nMap(payload.body_i18n);

    const hasAnyTitle =
      Boolean(title) || Object.values(titleI18n).some((value) => value.trim());
    if (!hasAnyTitle) {
      return json({ error: "Заголовок уведомления обязателен хотя бы на одном языке" }, { status: 400 });
    }

    const segment = parseSegment(payload.segment);
    const db = createServiceSupabase();
    const userIds = await resolveSegmentUserIds(db, segment);
    if (userIds.length === 0) {
      return json({ error: "В выбранном сегменте нет пользователей" }, { status: 400 });
    }

    const displayTitle =
      title ||
      titleI18n.en ||
      Object.values(titleI18n).find((value) => value.trim()) ||
      "Уведомление";

    const { data: notification, error: insertError } = await db
      .from("notifications")
      .insert({
        title: title || displayTitle,
        body,
        title_i18n: titleI18n,
        body_i18n: bodyI18n,
        link_url: payload.link_url?.trim() || null,
        segment: payload.segment,
        segment_label: await segmentLabel(db, segment),
        recipient_count: userIds.length,
      })
      .select("*")
      .single();
    if (insertError) throw insertError;

    const DELIVERY_CHUNK = 500;
    for (let i = 0; i < userIds.length; i += DELIVERY_CHUNK) {
      const { error: deliveryError } = await db.from("notification_deliveries").insert(
        userIds.slice(i, i + DELIVERY_CHUNK).map((userId) => ({
          notification_id: notification.id,
          user_id: userId,
        })),
      );
      if (deliveryError) throw deliveryError;
    }

    const { data: userRows, error: usersError } = await db
      .from("users")
      .select("id, locale")
      .in("id", userIds);
    if (usersError) throw usersError;
    const localeByUser = new Map<string, string | null>();
    for (const row of userRows ?? []) {
      localeByUser.set(row.id, row.locale ?? null);
    }

    const { data: tokens, error: tokensError } = await db
      .from("push_tokens")
      .select("token, user_id")
      .eq("is_active", true)
      .in("user_id", userIds);
    if (tokensError) throw tokensError;

    const storedTitle = notification.title as string;
    const storedBody = (notification.body as string) ?? "";
    const storedTitleI18n = parseStringRecord(notification.title_i18n);
    const storedBodyI18n = parseStringRecord(notification.body_i18n);
    const linkUrl = (notification.link_url as string | null) ?? null;
    const copySource = {
      title: storedTitle,
      body: storedBody,
      titleI18n: storedTitleI18n,
      bodyI18n: storedBodyI18n,
    };

    const messages = (tokens ?? []).map(({ token, user_id }) => {
      const { title: pushTitle, body: pushBody } = resolveNotificationCopy(
        localeByUser.get(user_id) ?? "ru",
        copySource,
      );
      return {
        to: token,
        title: pushTitle,
        body: truncatePushBody(pushBody),
        channelId: REMOTE_PUSH_CHANNEL_ID,
        data: {
          notificationId: notification.id,
          title: pushTitle,
          // Full body for in-app reader (alert body stays truncated).
          body: pushBody.slice(0, 2000),
          ...(linkUrl ? { url: linkUrl } : {}),
        },
      };
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

    // Finalize row before returning so a late undici socket close cannot leave sent_at null.
    const { data: updated, error: updateError } = await db
      .from("notifications")
      .update({
        push_sent_count: outcome.okCount,
        push_error_count: outcome.errorCount,
        sent_at: new Date().toISOString(),
      })
      .eq("id", notification.id)
      .select("id, title, body, title_i18n, body_i18n, link_url, segment, segment_label, recipient_count, push_sent_count, push_error_count, sent_at, created_at")
      .single();
    if (updateError) throw updateError;

    return json({ notification: updated });
  } catch (error) {
    return errorResponse(error);
  }
}
