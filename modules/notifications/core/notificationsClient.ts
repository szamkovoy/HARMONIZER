import { parseStringRecord } from "@/modules/i18n";
import { resolveNotificationCopy } from "@/modules/notifications/core/resolveNotificationCopy";
import { getSupabase } from "@/services/supabase";

export type MyNotification = {
  /** Surrogate delivery id (stable list key / mark-read). */
  id: string;
  /** Admin broadcast id when kind=admin; otherwise null. */
  notificationId: string | null;
  kind: "admin" | "opportunity" | "webinar_start" | string;
  title: string;
  body: string;
  linkUrl: string | null;
  createdAt: string;
  readAt: string | null;
};

const LIST_FETCH_TIMEOUT_MS = 12_000;
/** Inbox на клиенте: только недавние доставки (продуктовый лимит UI). */
export const MY_NOTIFICATIONS_LIST_LIMIT = 10;

type DeliveryListRow = {
  id: string;
  kind: string;
  title: string | null;
  body: string | null;
  link_url: string | null;
  read_at: string | null;
  created_at: string;
  notification_id: string | null;
  notifications: {
    id: string;
    title: string;
    body: string;
    title_i18n?: unknown;
    body_i18n?: unknown;
    link_url: string | null;
    created_at: string;
  } | null;
};

function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Лента «Мои уведомления»: snapshot на delivery, fallback soft-resolve для старых admin rows. */
export async function fetchMyNotifications(
  userId: string,
  locale: string,
): Promise<MyNotification[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  try {
    const { data, error } = await withTimeout(
      supabase
        .from("notification_deliveries")
        .select(
          "id, kind, title, body, link_url, read_at, created_at, notification_id, notifications(id, title, body, title_i18n, body_i18n, link_url, created_at)",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(MY_NOTIFICATIONS_LIST_LIMIT),
      LIST_FETCH_TIMEOUT_MS,
      "notifications list",
    );
    if (error) {
      if (__DEV__) console.warn("[notifications] list load failed", error.message);
      throw error;
    }
    return ((data ?? []) as unknown as DeliveryListRow[])
      .map((row) => {
        const snapshotTitle = (row.title ?? "").trim();
        const snapshotBody = row.body ?? "";
        const snapshotLink = row.link_url ?? null;
        if (snapshotTitle) {
          return {
            id: row.id,
            notificationId: row.notification_id,
            kind: row.kind ?? "admin",
            title: snapshotTitle,
            body: snapshotBody,
            linkUrl: snapshotLink,
            createdAt: row.created_at,
            readAt: row.read_at ?? null,
          };
        }
        const n = row.notifications;
        if (!n) return null;
        const { title, body } = resolveNotificationCopy(locale, {
          title: n.title,
          body: n.body,
          titleI18n: parseStringRecord(n.title_i18n),
          bodyI18n: parseStringRecord(n.body_i18n),
        });
        return {
          id: row.id,
          notificationId: n.id,
          kind: row.kind ?? "admin",
          title,
          body,
          linkUrl: snapshotLink ?? n.link_url ?? null,
          createdAt: n.created_at,
          readAt: row.read_at ?? null,
        };
      })
      .filter((item): item is MyNotification => item !== null);
  } catch (error) {
    if (__DEV__) {
      console.warn(
        "[notifications] list load failed",
        error instanceof Error ? error.message : error,
      );
    }
    throw error instanceof Error ? error : new Error("notifications list failed");
  }
}

export async function fetchUnreadNotificationCount(userId: string): Promise<number> {
  const supabase = getSupabase();
  if (!supabase) return 0;
  const { count, error } = await supabase
    .from("notification_deliveries")
    .select("id", { count: "exact", head: true })
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

/** Mark one delivery read by surrogate id or admin notification_id. */
export async function markNotificationRead(
  userId: string,
  deliveryOrNotificationId: string,
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase || !deliveryOrNotificationId) return;
  const now = new Date().toISOString();
  const { data: byPk } = await supabase
    .from("notification_deliveries")
    .update({ read_at: now })
    .eq("user_id", userId)
    .eq("id", deliveryOrNotificationId)
    .is("read_at", null)
    .select("id");
  if (byPk && byPk.length > 0) return;

  const { error } = await supabase
    .from("notification_deliveries")
    .update({ read_at: now })
    .eq("user_id", userId)
    .eq("notification_id", deliveryOrNotificationId)
    .is("read_at", null);
  if (error && __DEV__) console.warn("[notifications] mark one failed", error.message);
}
