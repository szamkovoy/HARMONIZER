const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const CHUNK = 100; // лимит Expo Push API на один запрос
const EXPO_FETCH_TIMEOUT_MS = 20_000;

/** Android channel id for remote admin pushes (must match `configureLocalNotifications` on device). */
export const REMOTE_PUSH_CHANNEL_ID = "harmonizer_remote";

export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** iOS/Android default alert sound — omit only for intentional silent pushes. */
  sound?: string;
  /** Android delivery priority. */
  priority?: "default" | "normal" | "high";
  /** iOS: active wakes screen + may play sound; passive is silent list-only. */
  interruptionLevel?: "active" | "critical" | "passive" | "timeSensitive";
  /** Android notification channel (must already exist on device if set). */
  channelId?: string;
};

export type ExpoPushOutcome = {
  okCount: number;
  errorCount: number;
  /** Токены, которые Expo пометил DeviceNotRegistered — их надо деактивировать. */
  staleTokens: string[];
};

function isTerminatedFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError" || /aborted|terminated/i.test(error.message)) return true;
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause && typeof cause === "object" && "code" in cause) {
    const code = String((cause as { code?: string }).code ?? "");
    if (code === "UND_ERR_SOCKET" || code === "ECONNRESET") return true;
  }
  return false;
}

/** Шлёт сообщения пачками по 100; ошибки сети одной пачки не роняют остальные. */
export async function sendExpoPushMessages(messages: ExpoPushMessage[]): Promise<ExpoPushOutcome> {
  const outcome: ExpoPushOutcome = { okCount: 0, errorCount: 0, staleTokens: [] };
  for (let i = 0; i < messages.length; i += CHUNK) {
    const chunk = messages.slice(i, i + CHUNK).map((message) => ({
      sound: "default",
      priority: "high" as const,
      interruptionLevel: "active" as const,
      ...message,
    }));
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Avoid undici keep-alive races on Vercel that surface as TypeError: terminated.
          Connection: "close",
        },
        body: JSON.stringify(chunk),
        signal: AbortSignal.timeout(EXPO_FETCH_TIMEOUT_MS),
      });
      // Fully consume body before the isolate tears down sockets.
      const raw = await response.text();
      if (!response.ok) {
        outcome.errorCount += chunk.length;
        console.error("[admin/notifications] expo push HTTP", response.status, raw.slice(0, 200));
        continue;
      }
      let payload: {
        data?: Array<{ status: "ok" | "error"; message?: string; details?: { error?: string } }>;
      } = {};
      try {
        payload = raw ? (JSON.parse(raw) as typeof payload) : {};
      } catch {
        outcome.errorCount += chunk.length;
        console.error("[admin/notifications] expo push bad JSON");
        continue;
      }
      const tickets = payload.data ?? [];
      tickets.forEach((ticket, index) => {
        if (ticket.status === "ok") {
          outcome.okCount += 1;
        } else {
          outcome.errorCount += 1;
          if (ticket.details?.error === "DeviceNotRegistered") {
            outcome.staleTokens.push(chunk[index].to);
          }
        }
      });
      outcome.errorCount += Math.max(0, chunk.length - tickets.length);
    } catch (error) {
      // If Expo already accepted the push, undici may still throw "terminated" on socket close.
      // Count as soft failure for the admin UI counters only when we got no tickets.
      outcome.errorCount += chunk.length;
      if (isTerminatedFetchError(error)) {
        console.warn("[admin/notifications] expo push socket closed (often after accept)", error);
      } else {
        console.error("[admin/notifications] expo push failed", error);
      }
    }
  }
  return outcome;
}
