// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.101.1";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
      ...(init.headers ?? {}),
    },
  });
}

/**
 * Supabase API gateway answers `502/503/504 {"message":"Gateway Timeout"}` after ~5s on the
 * first PostgREST request after an idle gap (keep-alive race gateway↔PostgREST); the request
 * never reaches Postgres, so a retry succeeds. Idempotent reads (GET/HEAD) are retried up to
 * twice; writes and POST RPC are never retried. Mirrors `_legacy_web/app/api/_utils/supabase.ts`.
 */
const GATEWAY_RETRY_STATUSES = new Set([502, 503, 504]);
const GATEWAY_RETRY_DELAYS_MS = [300, 800];

export function shouldRetryGatewayResponse(status: number, method: string, attempt: number): boolean {
  if (attempt >= GATEWAY_RETRY_DELAYS_MS.length) return false;
  const normalized = method.toUpperCase();
  if (normalized !== "GET" && normalized !== "HEAD") return false;
  return GATEWAY_RETRY_STATUSES.has(status);
}

async function fetchWithGatewayRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  let response = await fetch(input, init);
  for (let attempt = 0; ; attempt += 1) {
    if (!shouldRetryGatewayResponse(response.status, method, attempt)) return response;
    if (init?.signal?.aborted) return response;
    await new Promise((resolve) => setTimeout(resolve, GATEWAY_RETRY_DELAYS_MS[attempt]));
    if (init?.signal?.aborted) return response;
    response = await fetch(input, init);
  }
}

export function createServiceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: { fetch: fetchWithGatewayRetry },
  });
}

export function assertCronSecret(req: Request): Response | null {
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected) {
    return json({ error: "CRON_SECRET is required" }, { status: 500 });
  }

  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const header = req.headers.get("x-cron-secret");
  if (bearer === expected || header === expected) return null;

  return json({ error: "Unauthorized" }, { status: 401 });
}

export function isOptions(req: Request): boolean {
  return req.method === "OPTIONS";
}

export function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
