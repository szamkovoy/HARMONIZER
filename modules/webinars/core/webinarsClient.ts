import type { AppLocale } from "@/modules/i18n";
import {
  asContentLocale,
  pickExactLocalizedText,
  pickExactLocalizedUrl,
} from "@/modules/i18n";
import { getSupabase } from "@/services/supabase";
import { isWebinarInJoinWindow } from "@/modules/webinars/core/webinarTiming";

export type WebinarItem = {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  joinUrl: string | null;
  coverUrl: string | null;
  /** Linked published recording post id (same feed object as videos). */
  recordingPostId: string | null;
  /** @deprecated Prefer recordingPostId; kept for legacy rows without a post. */
  recordingUrl: string | null;
  titleI18n: Record<string, string>;
  descriptionI18n: Record<string, string>;
  coverUrlI18n: Record<string, string>;
};

function asStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string" && entry.trim()) out[key] = entry;
  }
  return out;
}

function mapRow(row: {
  id: string;
  title: string;
  description: string;
  starts_at: string;
  join_url: string | null;
  recording_url: string | null;
  cover_url?: string | null;
  title_i18n?: unknown;
  description_i18n?: unknown;
  cover_url_i18n?: unknown;
}): WebinarItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    startsAt: row.starts_at,
    joinUrl: row.join_url ?? null,
    coverUrl: row.cover_url ?? null,
    recordingPostId: null,
    recordingUrl: row.recording_url ?? null,
    titleI18n: asStringMap(row.title_i18n),
    descriptionI18n: asStringMap(row.description_i18n),
    coverUrlI18n: asStringMap(row.cover_url_i18n),
  };
}

/**
 * Announce fields for the active UI locale only (no en/ru fallback).
 * Returns null when this locale has no authored title — hide banner/card.
 */
export function localizeWebinar(item: WebinarItem, locale: AppLocale): WebinarItem | null {
  const contentLocale = asContentLocale(locale) ?? "ru";
  const title = pickExactLocalizedText(contentLocale, item.title, item.titleI18n);
  if (!title) return null;
  return {
    ...item,
    title,
    description: pickExactLocalizedText(contentLocale, item.description, item.descriptionI18n),
    coverUrl: pickExactLocalizedUrl(contentLocale, item.coverUrl, item.coverUrlI18n),
  };
}

const SELECT =
  "id, title, description, starts_at, join_url, recording_url, cover_url, title_i18n, description_i18n, cover_url_i18n";

async function attachRecordingPostIds(items: WebinarItem[]): Promise<WebinarItem[]> {
  if (items.length === 0) return items;
  const supabase = getSupabase();
  if (!supabase) return items;
  const ids = items.map((w) => w.id);
  const { data, error } = await supabase
    .from("posts")
    .select("id, webinar_id, is_published")
    .eq("kind", "webinar_recording")
    .eq("is_published", true)
    .in("webinar_id", ids);
  if (error) {
    if (__DEV__) console.warn("[webinars] recording posts load failed", error.message);
    return items;
  }
  const byWebinar = new Map<string, string>();
  for (const row of data ?? []) {
    if (row.webinar_id) byWebinar.set(row.webinar_id, row.id);
  }
  return items.map((item) => ({
    ...item,
    recordingPostId: byWebinar.get(item.id) ?? null,
  }));
}

/** Ближайший опубликованный вебинар в join-окне с title на `locale` (exact; без en/ru fallback). */
export async function fetchUpcomingWebinar(locale?: AppLocale): Promise<WebinarItem | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("webinars")
    .select(SELECT)
    .eq("is_published", true)
    .gte("starts_at", cutoff)
    .order("starts_at", { ascending: true })
    .limit(10);
  if (error) {
    if (__DEV__) console.warn("[webinars] upcoming load failed", error.message);
    return null;
  }
  const now = Date.now();
  const contentLocale = locale ? (asContentLocale(locale) ?? "ru") : null;
  for (const row of data ?? []) {
    if (!isWebinarInJoinWindow(row.starts_at, now)) continue;
    const item = mapRow(row);
    if (!contentLocale) return item;
    if (localizeWebinar(item, contentLocale)) return item;
  }
  return null;
}

/** Опубликованные: upcoming в join-окне (+ past только для legacy callers; UI strip больше не показывает past). */
export async function fetchWebinars(): Promise<{ upcoming: WebinarItem[]; past: WebinarItem[] }> {
  const supabase = getSupabase();
  if (!supabase) return { upcoming: [], past: [] };
  const { data, error } = await supabase
    .from("webinars")
    .select(SELECT)
    .eq("is_published", true)
    .order("starts_at", { ascending: false })
    .limit(100);
  if (error) {
    if (__DEV__) console.warn("[webinars] list load failed", error.message);
    return { upcoming: [], past: [] };
  }
  const now = Date.now();
  const withRecordings = await attachRecordingPostIds((data ?? []).map(mapRow));
  return {
    upcoming: withRecordings.filter((w) => isWebinarInJoinWindow(w.startsAt, now)).reverse(),
    past: withRecordings.filter((w) => !isWebinarInJoinWindow(w.startsAt, now) && (w.recordingPostId || w.recordingUrl)),
  };
}

export async function fetchWebinar(id: string): Promise<WebinarItem | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.from("webinars").select(SELECT).eq("id", id).maybeSingle();
  if (error) {
    if (__DEV__) console.warn("[webinars] load failed", error.message);
    return null;
  }
  if (!data) return null;
  const [withRecording] = await attachRecordingPostIds([mapRow(data)]);
  return withRecording ?? null;
}

export async function isRegistered(webinarId: string, userId: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { data, error } = await supabase
    .from("webinar_registrations")
    .select("webinar_id")
    .eq("webinar_id", webinarId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (__DEV__) console.warn("[webinars] registration check failed", error.message);
    return false;
  }
  return !!data;
}

export async function setRegistered(webinarId: string, userId: string, registered: boolean): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = registered
    ? await supabase.from("webinar_registrations").upsert(
        { webinar_id: webinarId, user_id: userId },
        { onConflict: "webinar_id,user_id", ignoreDuplicates: true },
      )
    : await supabase.from("webinar_registrations").delete().eq("webinar_id", webinarId).eq("user_id", userId);
  if (error && __DEV__) console.warn("[webinars] registration toggle failed", error.message);
}
