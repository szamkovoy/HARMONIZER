/**
 * Public fallback proxy for landing payment widgets.
 *
 * Browsers on landing pages load widget config and create invoices through
 * https://harmonizer.zamkovoi.yoga (REG.RU reverse proxy → Vercel). That chain
 * occasionally fails for RU visitors (REG.RU → Vercel leg is throttled by RKN
 * and shared-hosting PHP workers can saturate). widget.js therefore retries
 * this Supabase Edge Function as an independent second path, and direct
 * Vercel (`harmonizer-ten.vercel.app`) as a third.
 *
 * Contract: forwards any `/api/widget/*` request to Vercel verbatim
 * (method, body, most headers) and streams the response back. Everything
 * else is 404 — this is a narrow widget pipe, not an open proxy.
 *
 * URL shape: https://<project>.supabase.co/functions/v1/hz-proxy/api/widget/<id>?…
 */

const UPSTREAM = "https://harmonizer-ten.vercel.app";
const ALLOWED_PREFIX = "/api/widget/";

// ms per upstream attempt; widget.js also has its own fetch timeout.
const UPSTREAM_TIMEOUT_MS = 15_000;

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

Deno.serve(async (request: Request): Promise<Response> => {
  const url = new URL(request.url);

  // Supabase serves the function under /functions/v1/hz-proxy, but req.url
  // may arrive with either that full prefix or just /hz-proxy. The forwarded
  // API path always starts at the first "/api/" segment.
  const apiAt = url.pathname.indexOf("/api/");
  const subPath = apiAt >= 0 ? url.pathname.slice(apiAt) : "/";

  if (!subPath.startsWith(ALLOWED_PREFIX)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const headers = new Headers();
  for (const [name, value] of request.headers.entries()) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === "host" || lower === "content-length") continue;
    headers.set(name, value);
  }
  // Vercel replaces X-Forwarded-For with our address; ipCountry.ts reads this
  // header for the real visitor country (same convention as the REG.RU proxy).
  const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (clientIp) {
    headers.set("X-Harmonizer-Client-Ip", clientIp);
  }
  headers.set("X-Forwarded-Proto", "https");

  const body = request.method === "GET" || request.method === "HEAD"
    ? undefined
    : await request.arrayBuffer();

  const target = UPSTREAM + subPath + (url.search || "");
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return Response.json({ error: "upstream_unreachable" }, { status: 502 });
  }

  const responseHeaders = new Headers();
  for (const [name, value] of upstream.headers.entries()) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === "content-length") continue;
    if (
      lower === "content-type" &&
      !value.includes("charset=") &&
      (value.startsWith("application/json") || value.startsWith("text/"))
    ) {
      // Raw JSON opened directly in a mobile browser (e.g. the RF reachability
      // test) otherwise renders UTF-8 Cyrillic as mojibake.
      responseHeaders.set(name, value + "; charset=utf-8");
      continue;
    }
    responseHeaders.set(name, value);
  }
  responseHeaders.set("X-Hz-Proxy", "supabase");

  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
});
