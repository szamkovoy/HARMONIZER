export const runtime = "edge";

const ASSET_RE =
  /^https:\/\/([a-z0-9]+)\.supabase\.co\/storage\/v1\/object\/public\/email-assets\/.+/i;

function allowedSupabaseHost(): string | null {
  const raw =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "";
  try {
    return raw ? new URL(raw).host : null;
  } catch {
    return null;
  }
}

/**
 * Cacheable proxy for marketing email images.
 * Supabase public URLs often respond with Cache-Control: no-cache; mail clients
 * then re-download on every open. We re-serve with a long max-age from the edge.
 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("u")?.trim() ?? "";
  if (!ASSET_RE.test(raw)) {
    return new Response("Bad asset URL", { status: 400 });
  }

  const allowedHost = allowedSupabaseHost();
  const target = new URL(raw);
  if (allowedHost && target.host !== allowedHost) {
    return new Response("Forbidden host", { status: 403 });
  }

  const upstream = await fetch(raw, {
    next: { revalidate: 31536000 },
  });
  if (!upstream.ok) {
    return new Response("Upstream error", { status: upstream.status });
  }

  const contentType = upstream.headers.get("content-type") || "image/jpeg";
  const body = await upstream.arrayBuffer();
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Length": String(body.byteLength),
    },
  });
}
