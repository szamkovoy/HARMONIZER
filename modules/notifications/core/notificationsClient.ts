import { parseStringRecord } from "@/modules/i18n";
import { resolveNotificationCopy } from "@/modules/notifications/core/resolveNotificationCopy";
import { getSupabase } from "@/services/supabase";

export type MyNotification = {
  notificationId: string;
  title: string;
  body: string;
  linkUrl: string | null;
  createdAt: string;
  readAt: string | null;
};

/** Лента «Мои уведомления»: deliveries + текст через resolveNotificationCopy. */
export async function fetchMyNotifications(
  userId: string,
  locale: string,
): Promise<MyNotification[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("notification_deliveries")
    .select(
      "read_at, created_at, notifications(id, title, body, title_i18n, body_i18n, link_url, created_at)",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    if (__DEV__) console.warn("[notifications] list load failed", error.message);
    return [];
  }
  return (data ?? [])
    .map((row) => {
      const n = row.notifications as {
        id: string;
        title: string;
        body: string;
        title_i18n?: unknown;
        body_i18n?: unknown;
        link_url: string | null;
        created_at: string;
      } | null;
      if (!n) return null;
      const { title, body } = resolveNotificationCopy(locale, {
        title: n.title,
        body: n.body,
        titleI18n: parseStringRecord(n.title_i18n),
        bodyI18n: parseStringRecord(n.body_i18n),
      });
      return {
        notificationId: n.id,
        title,
        body,
        linkUrl: n.link_url ?? null,
        createdAt: n.created_at,
        readAt: row.read_at ?? null,
      };
    })
    .filter((item): item is MyNotification => item !== null);
}

export async function fetchUnreadNotificationCount(userId: string): Promise<number> {
  const supabase = getSupabase();
  if (!supabase) return 0;
  const { count, error } = await supabase
    .from("notification_deliveries")
    .select("notification_id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) {
    if (__DEV__) console.warn("[notifications] unread count failed", error.message);
    return 0;
  }
  return count ?? 0;
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase
    .from("notification_deliveries")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error && __DEV__) console.warn("[notifications] mark read failed", error.message);
}
