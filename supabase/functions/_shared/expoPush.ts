// @ts-nocheck
/** Minimal Expo push sender for Edge cron (mirror of admin expoPush.ts). */

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const CHUNK = 100;
const EXPO_FETCH_TIMEOUT_MS = 20_000;

export const REMOTE_PUSH_CHANNEL_ID = "harmonizer_remote";

export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  channelId?: string;
};

export type ExpoPushOutcome = {
  okCount: number;
  errorCount: number;
  staleTokens: string[];
};

export async function sendExpoPushMessages(messages: ExpoPushMessage[]): Promise<ExpoPushOutcome> {
  const outcome: ExpoPushOutcome = { okCount: 0, errorCount: 0, staleTokens: [] };
  for (let i = 0; i < messages.length; i += CHUNK) {
    const chunk = messages.slice(i, i + CHUNK).map((message) => ({
      sound: "default",
      priority: "high",
      interruptionLevel: "active",
      ...message,
    }));
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), EXPO_FETCH_TIMEOUT_MS);
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Connection: "close",
        },
        body: JSON.stringify(chunk),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const raw = await response.text();
      if (!response.ok) {
        outcome.errorCount += chunk.length;
        console.error("[expoPush] HTTP", response.status, raw.slice(0, 200));
        continue;
      }
      let payload: {
        data?: Array<{ status: "ok" | "error"; details?: { error?: string } }>;
      } = {};
      try {
        payload = raw ? JSON.parse(raw) : {};
      } catch {
        outcome.errorCount += chunk.length;
        continue;
      }
      const tickets = payload.data ?? [];
      tickets.forEach((ticket, index) => {
        if (ticket.status === "ok") outcome.okCount += 1;
        else {
          outcome.errorCount += 1;
          if (ticket.details?.error === "DeviceNotRegistered") {
            outcome.staleTokens.push(chunk[index].to);
          }
        }
      });
      outcome.errorCount += Math.max(0, chunk.length - tickets.length);
    } catch (error) {
      outcome.errorCount += chunk.length;
      console.error("[expoPush] failed", error);
    }
  }
  return outcome;
}

export function truncatePushBody(body: string, maxChars = 350): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}
