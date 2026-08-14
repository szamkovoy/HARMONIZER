import { createServiceSupabase } from "@legacy/app/api/_utils/supabase";

export type AffirmationRow = {
  id: string;
  user_id: string;
  text: string;
  audio_url: string | null;
  status: "active" | "completed" | "archived";
  current_day: number;
  last_practiced_at: string | null;
  cycle_started_at: string;
  created_at: string;
  updated_at: string;
};

export const AFFIRMATION_SELECT =
  "id, user_id, text, audio_url, status, current_day, last_practiced_at, cycle_started_at, created_at, updated_at";

async function signedAudioUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const storage = createServiceSupabase().storage.from("affirmation-audio");
  const { data, error } = await storage.createSignedUrl(path, 60 * 60 * 6);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function serializeAffirmation(row: AffirmationRow) {
  return {
    id: row.id,
    text: row.text,
    audioPath: row.audio_url,
    audioSignedUrl: await signedAudioUrl(row.audio_url),
    status: row.status,
    currentDay: row.current_day,
    lastPracticedAt: row.last_practiced_at,
    cycleStartedAt: row.cycle_started_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
