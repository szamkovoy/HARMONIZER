import type { OutboundEmail, SendResult } from "../types.ts";

function formatFrom(fromName: string, fromEmail: string): string {
  const name = fromName.trim();
  if (!name) return fromEmail;
  // Resend accepts UTF-8 in JSON; quote the display name if it has specials.
  if (/^[A-Za-z0-9 ._-]+$/.test(name)) return `${name} <${fromEmail}>`;
  const escaped = name.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `"${escaped}" <${fromEmail}>`;
}

/** Send via Resend HTTPS API (channel-specific API key passed in). */
export async function sendViaResend(
  apiKey: string,
  mail: OutboundEmail,
): Promise<SendResult> {
  if (!apiKey) {
    return { ok: false, detail: "Resend API key is empty for this mail channel" };
  }
  // Hard cap so a stalled Resend connection can never hang the GoTrue
  // send-email hook (and thus signInWithOtp) indefinitely.
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 12000);
  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: formatFrom(mail.fromName, mail.fromEmail),
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        ...(mail.headers && Object.keys(mail.headers).length
          ? { headers: mail.headers }
          : {}),
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    return {
      ok: false,
      detail: `Resend fetch failed: ${e instanceof Error ? e.name : String(e)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      ok: false,
      detail: `Resend HTTP ${res.status}${body ? `: ${body.slice(0, 400)}` : ""}`,
    };
  }
  return { ok: true };
}
