import type { Database } from "@/services/supabase-types";

export type TvSessionRow = Database["public"]["Tables"]["tv_sessions"]["Row"];

export type TvSessionStatus = "waiting" | "playing" | "paused" | "stopped" | "closed";

export type RemotePlayErrorCode =
  | "invalid_code"
  | "not_found"
  | "expired"
  | "already_linked"
  | "not_connected"
  | "missing_vimeo"
  | "supabase_error";

export class RemotePlayError extends Error {
  code: RemotePlayErrorCode;

  constructor(code: RemotePlayErrorCode, message: string) {
    super(message);
    this.name = "RemotePlayError";
    this.code = code;
  }
}

export function normalizePairingCode(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 4);
}

export function isTvSessionActive(session: TvSessionRow | null | undefined, now = new Date()): session is TvSessionRow {
  if (!session) return false;
  return session.status !== "closed" && new Date(session.expires_at).getTime() > now.getTime();
}
