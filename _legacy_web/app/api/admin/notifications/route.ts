import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../_utils/supabase";
import { sendExpoPushMessages } from "./expoPush";
import { parseSegment, resolveSegmentUserIds, segmentLabel } from "./segment";

export const runtime = "nodejs";
export const maxDuration = 120; // рассылка большим сегментам не укладывается в дефолтные лимиты

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
  link_url?: string | null;
  segment?: string;
};

/**
 * Создаёт рассылку: notification → deliveries всем получателям сегмента
 * (гарантированная витрина «Мои уведомления») → Expo push тем, у кого есть
 * активные токены. DeviceNotRegistered-токены деактивируются.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const payload = (await req.json()) as SendPayload;
    const title = payload.title?.trim() ?? "";
    if (!title) return json({ error: "Заголовок уведомления обязателен" }, { status: 400 });
    const segment = parseSegment(payload.segment);

    const db = createServiceSupabase();
    const userIds = await resolveSegmentUserIds(db, segment);
    if (userIds.length === 0) {
      return json({ error: "В выбранном сегменте нет пользователей" }, { status: 400 });
    }

    const { data: notification, error: insertError } = await db
      .from("notifications")
      .insert({
        title,
        body: payload.body?.trim() ?? "",
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

    const { data: tokens, error: tokensError } = await db
      .from("push_tokens")
      .select("token")
      .eq("is_active", true)
      .in("user_id", userIds);
    if (tokensError) throw tokensError;

    const messages = (tokens ?? []).map(({ token }) => ({
      to: token,
      title,
      body: payload.body?.trim() ?? "",
      data: notification.link_url ? { url: notification.link_url } : undefined,
    }));
    const outcome = await sendExpoPushMessages(messages);

    if (outcome.staleTokens.length > 0) {
      await db.from("push_tokens").update({ is_active: false }).in("token", outcome.staleTokens);
    }

    const { data: updated, error: updateError } = await db
      .from("notifications")
      .update({
        push_sent_count: outcome.okCount,
        push_error_count: outcome.errorCount,
        sent_at: new Date().toISOString(),
      })
      .eq("id", notification.id)
      .select("*")
      .single();
    if (updateError) throw updateError;

    return json({ notification: updated });
  } catch (error) {
    return errorResponse(error);
  }
}
