import { requireSupabase } from "@/services/supabase";
import { isTvSessionActive, normalizePairingCode, RemotePlayError, type TvSessionRow, type TvSessionStatus } from "./types";

const ACTIVE_SELECT = "id,pairing_code,vimeo_id,audiotrack,status,user_id,expires_at,created_at,updated_at";

function assertVimeoId(vimeoId: string | null | undefined): string {
  const trimmed = vimeoId?.trim();
  if (!trimmed) {
    throw new RemotePlayError("missing_vimeo", "У этой асаны пока нет Vimeo ID.");
  }
  return trimmed;
}

function normalizeCodeOrThrow(pairingCode: string): string {
  const code = normalizePairingCode(pairingCode);
  if (code.length !== 4) {
    throw new RemotePlayError("invalid_code", "Введите 4 символа кода с экрана ТВ.");
  }
  return code;
}

function asRemotePlayError(error: unknown, fallback: string): RemotePlayError {
  if (error instanceof RemotePlayError) return error;
  return new RemotePlayError("supabase_error", error instanceof Error ? error.message : fallback);
}

export async function getActiveRemotePlaySession(userId: string): Promise<TvSessionRow | null> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("tv_sessions")
    .select(ACTIVE_SELECT)
    .eq("user_id", userId)
    .neq("status", "closed")
    .gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw asRemotePlayError(error, "Не удалось проверить подключение к ТВ.");
  return data && isTvSessionActive(data) ? data : null;
}

export async function linkDevice(pairingCode: string, userId: string): Promise<TvSessionRow> {
  const code = normalizeCodeOrThrow(pairingCode);
  const supabase = requireSupabase();

  const { data: session, error } = await supabase
    .from("tv_sessions")
    .select(ACTIVE_SELECT)
    .eq("pairing_code", code)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw asRemotePlayError(error, "Не удалось найти ТВ-сессию.");
  if (!session) throw new RemotePlayError("not_found", "Код не найден.");
  if (!isTvSessionActive(session)) throw new RemotePlayError("expired", "Сессия истекла. Обновите страницу на ТВ.");
  if (session.user_id && session.user_id !== userId) {
    throw new RemotePlayError("already_linked", "Этот ТВ-код уже привязан к другому пользователю.");
  }

  const { data: updated, error: updateError } = await supabase
    .from("tv_sessions")
    .update({ user_id: userId })
    .eq("id", session.id)
    .select(ACTIVE_SELECT)
    .single();

  if (updateError) throw asRemotePlayError(updateError, "Не удалось привязать ТВ.");
  return updated;
}

export async function playVimeoOnRemote(
  sessionId: string,
  vimeoId: string,
  audiotrack?: string,
): Promise<TvSessionRow> {
  const supabase = requireSupabase();
  const track = audiotrack?.trim() || null;
  const { data, error } = await supabase
    .from("tv_sessions")
    .update({
      vimeo_id: assertVimeoId(vimeoId),
      audiotrack: track,
      status: "playing",
    })
    .eq("id", sessionId)
    .select(ACTIVE_SELECT)
    .single();

  if (error) throw asRemotePlayError(error, "Не удалось запустить видео на ТВ.");
  if (!isTvSessionActive(data)) throw new RemotePlayError("expired", "Сессия истекла. Подключите ТВ заново.");
  return data;
}

export async function setRemotePlaybackStatus(sessionId: string, status: Extract<TvSessionStatus, "playing" | "paused">): Promise<TvSessionRow> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("tv_sessions")
    .update({ status })
    .eq("id", sessionId)
    .select(ACTIVE_SELECT)
    .single();

  if (error) throw asRemotePlayError(error, "Не удалось обновить статус ТВ.");
  if (!isTvSessionActive(data)) throw new RemotePlayError("expired", "Сессия истекла. Подключите ТВ заново.");
  return data;
}

export async function stopRemotePlayback(sessionId: string): Promise<TvSessionRow> {
  const supabase = requireSupabase();
  // Only flip the status to "stopped" — keep vimeo_id/audiotrack so the phone
  // can replay the same practice (and so `resume()` remounts the player on the
  // TV). Clearing vimeo_id here left the session in a state where the TV-side
  // `status === "playing" && next.vimeo_id` branch never matched again, so the
  // phone showed "playing" while the TV sat idle — the "stuck remote" symptom.
  const { data, error } = await supabase
    .from("tv_sessions")
    .update({ status: "stopped" })
    .eq("id", sessionId)
    .select(ACTIVE_SELECT)
    .single();

  if (error) throw asRemotePlayError(error, "Не удалось остановить видео на ТВ.");
  if (!isTvSessionActive(data)) throw new RemotePlayError("expired", "Сессия истекла. Подключите ТВ заново.");
  return data;
}
