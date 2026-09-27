const PIXEL_GIF = Uint8Array.from(
  atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"),
  (char) => char.charCodeAt(0),
);

function trackingSecret(): string {
  return (
    process.env.EMAIL_TRACKING_SECRET?.trim()
    || process.env.EMAIL_UNSUBSCRIBE_SECRET?.trim()
    || ""
  );
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Edge-safe twin of `parseEmailTrackToken` (Web Crypto, no Node `crypto`). */
export async function parseEmailTrackTokenEdge(raw: string | null): Promise<string | null> {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const secret = trackingSecret();
  if (!secret || !value.includes(".")) {
    return /^[0-9a-f-]{36}$/i.test(value) ? value : null;
  }
  const [id, sig] = value.split(".");
  if (!id || !sig || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const expected = (await sha256Hex(`${secret}:track:${id}`)).slice(0, 32);
  if (!timingSafeEqualHex(sig, expected)) return null;
  return id;
}

export function trackingPixelResponse(): Response {
  return new Response(PIXEL_GIF, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      "Content-Length": String(PIXEL_GIF.byteLength),
    },
  });
}

/** One PostgREST RPC. Service role only; failures must not surface to the mail client. */
export async function recordEmailOpen(trackId: string): Promise<void> {
  const base = (
    process.env.NEXT_PUBLIC_SUPABASE_URL
    || process.env.SUPABASE_URL
    || ""
  ).replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!base || !key) return;
  const res = await fetch(`${base}/rest/v1/rpc/record_first_party_email_open`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_track_id: trackId }),
  });
  if (!res.ok) {
    throw new Error(`record_first_party_email_open ${res.status}`);
  }
}
