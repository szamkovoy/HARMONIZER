import {
  FileSystemUploadType,
  getInfoAsync,
  readAsStringAsync,
  uploadAsync,
} from "expo-file-system/legacy";

import {
  getAffirmationByIdUrl,
  getAffirmationsGenerateUrl,
  getAffirmationsPracticeCompleteUrl,
  getAffirmationsUploadsUrl,
  getAffirmationsUrl,
  getCommunicatorApiBaseUrl,
} from "@/services/communicatorConfig";
import { getSupabase } from "@/services/supabase";

export type AffirmationDto = {
  id: string;
  text: string;
  audioPath: string | null;
  audioSignedUrl: string | null;
  status: "active" | "completed" | "archived";
  currentDay: number;
  lastPracticedAt: string | null;
  cycleStartedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type AffirmationHistoryTurn = {
  role: "user" | "assistant";
  content: string;
};

async function getAccessToken(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  if (!token) throw new Error("offline");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export async function fetchActiveAffirmation(): Promise<AffirmationDto | null> {
  const headers = await authHeaders();
  const res = await fetch(getAffirmationsUrl(), { headers });
  const payload = (await res.json().catch(() => null)) as
    | { affirmation?: AffirmationDto | null; error?: string }
    | null;
  if (!res.ok) throw new Error(payload?.error ?? "fetch_failed");
  return payload?.affirmation ?? null;
}

export async function generateAffirmationOptions(input: {
  message: string;
  history?: AffirmationHistoryTurn[];
  userName?: string | null;
  responseLocale?: string;
}): Promise<string[]> {
  const headers = await authHeaders();
  const res = await fetch(getAffirmationsGenerateUrl(), {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  const payload = (await res.json().catch(() => null)) as
    | { options?: string[]; error?: string }
    | null;
  if (!res.ok || !payload?.options?.length) {
    throw new Error(payload?.error ?? "generate_failed");
  }
  return payload.options;
}

export async function createAffirmation(input: {
  text: string;
  audioPath?: string | null;
}): Promise<AffirmationDto> {
  const headers = await authHeaders();
  const res = await fetch(getAffirmationsUrl(), {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  const payload = (await res.json().catch(() => null)) as
    | { affirmation?: AffirmationDto; error?: string }
    | null;
  if (!res.ok || !payload?.affirmation) {
    throw new Error(payload?.error ?? "create_failed");
  }
  return payload.affirmation;
}

export async function patchAffirmation(
  id: string,
  patch: {
    text?: string;
    audioPath?: string | null;
    status?: "active" | "completed" | "archived";
    resetCycle?: boolean;
  },
): Promise<AffirmationDto> {
  const headers = await authHeaders();
  const res = await fetch(getAffirmationByIdUrl(id), {
    method: "PATCH",
    headers,
    body: JSON.stringify(patch),
  });
  const payload = (await res.json().catch(() => null)) as
    | { affirmation?: AffirmationDto; error?: string }
    | null;
  if (!res.ok || !payload?.affirmation) {
    throw new Error(payload?.error ?? "patch_failed");
  }
  return payload.affirmation;
}

export async function markAffirmationPracticeComplete(
  localDate: string,
): Promise<{ affirmation: AffirmationDto | null; bumped: boolean }> {
  const headers = await authHeaders();
  const res = await fetch(getAffirmationsPracticeCompleteUrl(), {
    method: "POST",
    headers,
    body: JSON.stringify({ localDate }),
  });
  const payload = (await res.json().catch(() => null)) as
    | { affirmation?: AffirmationDto | null; bumped?: boolean; error?: string }
    | null;
  if (!res.ok) throw new Error(payload?.error ?? "complete_failed");
  return {
    affirmation: payload?.affirmation ?? null,
    bumped: Boolean(payload?.bumped),
  };
}

const AFFIRMATION_BUCKET = "affirmation-audio";

function buildSignedUploadUrl(path: string, token: string): string | null {
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  if (!base) return null;
  const url = new URL(
    `${base.replace(/\/$/, "")}/storage/v1/object/upload/sign/${AFFIRMATION_BUCKET}/${path}`,
  );
  url.searchParams.set("token", token);
  return url.toString();
}

export async function uploadAffirmationAudio(uri: string, mimeType: string): Promise<string> {
  const info = await getInfoAsync(uri);
  const sizeBytes = info.exists && !info.isDirectory ? Number(info.size ?? 0) : 0;
  if (!sizeBytes || sizeBytes < 16) throw new Error("empty_audio");

  const headers = await authHeaders();
  const ticketRes = await fetch(getAffirmationsUploadsUrl(), {
    method: "POST",
    headers,
    body: JSON.stringify({ contentType: mimeType, bytes: sizeBytes }),
  });
  const ticket = (await ticketRes.json().catch(() => null)) as
    | { path?: string; token?: string; signedUrl?: string; error?: string }
    | null;
  if (!ticketRes.ok || !ticket?.path || !ticket?.token) {
    throw new Error(ticket?.error ?? "upload_ticket_failed");
  }
  const signedUrl =
    typeof ticket.signedUrl === "string" && ticket.signedUrl.startsWith("http")
      ? ticket.signedUrl
      : buildSignedUploadUrl(ticket.path, ticket.token);
  if (!signedUrl) throw new Error("offline");

  const put = await uploadAsync(signedUrl, uri, {
    httpMethod: "PUT",
    uploadType: FileSystemUploadType.BINARY_CONTENT,
    headers: {
      "Content-Type": mimeType,
      "cache-control": "max-age=3600",
      "x-upsert": "false",
    },
  });
  if (put.status < 200 || put.status >= 300) {
    // Fallback: base64 via service role path is not available; surface error.
    void getCommunicatorApiBaseUrl();
    throw new Error("upload_failed");
  }
  return ticket.path;
}

/** Local calendar YYYY-MM-DD. */
export function localDateYmd(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function readAudioBase64(uri: string): Promise<string> {
  return readAsStringAsync(uri, { encoding: "base64" });
}
