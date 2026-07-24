// @ts-nocheck
/**
 * Minutely cron: claim published webinars whose starts_at just passed,
 * insert inbox deliveries + Expo push for registrants (users.locale).
 */
import { REMOTE_PUSH_CHANNEL_ID, sendExpoPushMessages, truncatePushBody } from "../_shared/expoPush.ts";
import { assertCronSecret, createServiceClient, isOptions, json } from "../_shared/supabase.ts";
import { pickExactWebinarTitle, webinarStartCopy } from "../_shared/webinarStartCopy.ts";

const CATCH_UP_MS = 15 * 60 * 1000;
const LOOKAHEAD_MS = 30 * 1000;

Deno.serve(async (req) => {
  if (isOptions(req)) return new Response("ok");
  const unauthorized = assertCronSecret(req);
  if (unauthorized) return unauthorized;

  try {
    const db = createServiceClient();
    const now = Date.now();
    const windowStart = new Date(now - CATCH_UP_MS).toISOString();
    const windowEnd = new Date(now + LOOKAHEAD_MS).toISOString();

    const { data: due, error: dueError } = await db
      .from("webinars")
      .select("id, title, title_i18n, join_url, starts_at")
      .eq("is_published", true)
      .is("start_notified_at", null)
      .not("join_url", "is", null)
      .gte("starts_at", windowStart)
      .lte("starts_at", windowEnd)
      .order("starts_at", { ascending: true })
      .limit(20);
    if (dueError) throw dueError;
    if (!due?.length) {
      return json({ ok: true, webinars: 0, deliveries: 0, pushOk: 0, pushErr: 0 });
    }

    let deliveries = 0;
    let pushOk = 0;
    let pushErr = 0;
    const claimedIds: string[] = [];

    for (const webinar of due) {
      const joinUrl = typeof webinar.join_url === "string" ? webinar.join_url.trim() : "";
      if (!joinUrl) continue;

      const { data: claimed, error: claimError } = await db
        .from("webinars")
        .update({ start_notified_at: new Date().toISOString() })
        .eq("id", webinar.id)
        .is("start_notified_at", null)
        .select("id")
        .maybeSingle();
      if (claimError) throw claimError;
      if (!claimed) continue;
      claimedIds.push(webinar.id);

      const { data: regs, error: regsError } = await db
        .from("webinar_registrations")
        .select("user_id")
        .eq("webinar_id", webinar.id);
      if (regsError) throw regsError;
      const userIds = (regs ?? []).map((r) => r.user_id).filter(Boolean);
      if (userIds.length === 0) continue;

      const { data: users, error: usersError } = await db
        .from("users")
        .select("id, locale")
        .in("id", userIds);
      if (usersError) throw usersError;
      const localeByUser = new Map((users ?? []).map((u) => [u.id, u.locale ?? "ru"]));

      const titleI18n =
        webinar.title_i18n && typeof webinar.title_i18n === "object"
          ? (webinar.title_i18n as Record<string, string>)
          : {};

      const deliveryRows = [];
      const copyByUser = new Map();
      for (const userId of userIds) {
        const locale = localeByUser.get(userId) ?? "ru";
        const webinarTitle = pickExactWebinarTitle(locale, webinar.title ?? "", titleI18n);
        const copy = webinarStartCopy(locale, webinarTitle);
        copyByUser.set(userId, copy);
        deliveryRows.push({
          notification_id: null,
          user_id: userId,
          kind: "webinar_start",
          title: copy.title,
          body: copy.body,
          link_url: joinUrl,
          source_key: `webinar_start:${webinar.id}`,
        });
      }

      for (const row of deliveryRows) {
        const { error: oneErr } = await db.from("notification_deliveries").insert(row);
        if (oneErr) {
          if (/duplicate|unique/i.test(oneErr.message)) continue;
          throw oneErr;
        }
        deliveries += 1;
      }

      const { data: tokens, error: tokensError } = await db
        .from("push_tokens")
        .select("token, user_id")
        .eq("is_active", true)
        .in("user_id", userIds);
      if (tokensError) throw tokensError;

      const messages = (tokens ?? []).flatMap(({ token, user_id }) => {
        const copy = copyByUser.get(user_id);
        if (!copy) return [];
        return [
          {
            to: token,
            title: copy.title,
            body: truncatePushBody(copy.body),
            channelId: REMOTE_PUSH_CHANNEL_ID,
            data: {
              kind: "webinar_start",
              webinarId: webinar.id,
              title: copy.title,
              body: copy.body,
              url: joinUrl,
            },
          },
        ];
      });

      const outcome = await sendExpoPushMessages(messages);
      pushOk += outcome.okCount;
      pushErr += outcome.errorCount;
      if (outcome.staleTokens.length > 0) {
        await db.from("push_tokens").update({ is_active: false }).in("token", outcome.staleTokens);
      }
    }

    return json({
      ok: true,
      webinars: claimedIds.length,
      deliveries,
      pushOk,
      pushErr,
      claimedIds,
    });
  } catch (error) {
    console.error("[notify-webinar-start]", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
});
