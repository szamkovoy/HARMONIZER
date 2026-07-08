const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const CHUNK = 100; // лимит Expo Push API на один запрос

export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

export type ExpoPushOutcome = {
  okCount: number;
  errorCount: number;
  /** Токены, которые Expo пометил DeviceNotRegistered — их надо деактивировать. */
  staleTokens: string[];
};

/** Шлёт сообщения пачками по 100; ошибки сети одной пачки не роняют остальные. */
export async function sendExpoPushMessages(messages: ExpoPushMessage[]): Promise<ExpoPushOutcome> {
  const outcome: ExpoPushOutcome = { okCount: 0, errorCount: 0, staleTokens: [] };
  for (let i = 0; i < messages.length; i += CHUNK) {
    const chunk = messages.slice(i, i + CHUNK);
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chunk),
      });
      if (!response.ok) {
        outcome.errorCount += chunk.length;
        console.error("[admin/notifications] expo push HTTP", response.status);
        continue;
      }
      const payload = (await response.json()) as {
        data?: Array<{ status: "ok" | "error"; message?: string; details?: { error?: string } }>;
      };
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
      // Если Expo вернул меньше тикетов, чем сообщений — остаток считаем ошибками.
      outcome.errorCount += Math.max(0, chunk.length - tickets.length);
    } catch (error) {
      outcome.errorCount += chunk.length;
      console.error("[admin/notifications] expo push failed", error);
    }
  }
  return outcome;
}
