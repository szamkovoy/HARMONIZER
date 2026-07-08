import { getSupabase } from "@/services/supabase";

export type WebinarItem = {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  joinUrl: string | null;
  recordingUrl: string | null;
};

function mapRow(row: {
  id: string;
  title: string;
  description: string;
  starts_at: string;
  join_url: string | null;
  recording_url: string | null;
}): WebinarItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    startsAt: row.starts_at,
    joinUrl: row.join_url ?? null,
    recordingUrl: row.recording_url ?? null,
  };
}

const SELECT = "id, title, description, starts_at, join_url, recording_url";

/** Ближайший предстоящий опубликованный вебинар (для баннера на главной). */
export async function fetchUpcomingWebinar(): Promise<WebinarItem | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("webinars")
    .select(SELECT)
    .gte("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (__DEV__) console.warn("[webinars] upcoming load failed", error.message);
    return null;
  }
  return data ? mapRow(data) : null;
}

/** Опубликованные вебинары: предстоящие (по возрастанию) + прошедшие с записью (по убыванию). */
export async function fetchWebinars(): Promise<{ upcoming: WebinarItem[]; past: WebinarItem[] }> {
  const supabase = getSupabase();
  if (!supabase) return { upcoming: [], past: [] };
  const { data, error } = await supabase
    .from("webinars")
    .select(SELECT)
    .order("starts_at", { ascending: false })
    .limit(100);
  if (error) {
    if (__DEV__) console.warn("[webinars] list load failed", error.message);
    return { upcoming: [], past: [] };
  }
  const now = Date.now();
  const items = (data ?? []).map(mapRow);
  return {
    upcoming: items.filter((w) => new Date(w.startsAt).getTime() >= now).reverse(),
    past: items.filter((w) => new Date(w.startsAt).getTime() < now && w.recordingUrl),
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
  return data ? mapRow(data) : null;
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
    ? (await supabase.from("webinar_registrations").upsert(
        { webinar_id: webinarId, user_id: userId },
        { onConflict: "webinar_id,user_id", ignoreDuplicates: true },
      ))
    : (await supabase.from("webinar_registrations").delete().eq("webinar_id", webinarId).eq("user_id", userId));
  if (error && __DEV__) console.warn("[webinars] registration toggle failed", error.message);
}
