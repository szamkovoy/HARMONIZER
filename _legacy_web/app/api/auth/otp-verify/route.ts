/**
 * POST /api/auth/otp-verify
 *
 * Store-review path: if email matches STORE_REVIEW_EMAIL and code matches
 * STORE_REVIEW_OTP → mint a real Supabase session (generateLink + verifyOtp)
 * and ensure Master / onboarded profile. Otherwise `{ mode: "not_review" }`
 * so the client falls back to GoTrue `verifyOtp`.
 */
import { createClient } from "@supabase/supabase-js";

import { ensureStoreReviewProfile } from "../../_utils/ensureStoreReviewProfile";
import {
  getStoreReviewEmail,
  isStoreReviewEmail,
  normalizeStoreReviewEmail,
  otpMatchesStoreReview,
  storeReviewSecretsConfigured,
} from "../../_utils/storeReviewAuth";
import { createServiceSupabase, json } from "../../_utils/supabase";

export const runtime = "nodejs";
export const maxDuration = 30;

type Body = {
  email?: string;
  code?: string;
};

type LimitRow = {
  ok?: boolean;
  code?: string;
  retry_after_seconds?: number;
};

async function mintSessionForEmail(email: string) {
  const admin = createServiceSupabase();
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!supabaseUrl || !anonKey) {
    throw new Error("Supabase anon client is not configured");
  }

  let link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error || !link.data?.properties?.hashed_token) {
    const created = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: "Alex" },
    });
    if (
      created.error &&
      !/already|registered|exists|duplicate/i.test(created.error.message ?? "")
    ) {
      throw created.error;
    }
    link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  }

  const hashed = link.data?.properties?.hashed_token;
  if (link.error || !hashed) {
    throw link.error ?? new Error("generateLink failed");
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await userClient.auth.verifyOtp({
    token_hash: hashed,
    type: "email",
  });
  if (error || !data.session) {
    throw error ?? new Error("verifyOtp failed");
  }
  return data.session;
}

export async function POST(req: Request) {
  try {
    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return json({ ok: false, code: "invalid_json" }, { status: 400 });
    }

    const email = normalizeStoreReviewEmail(body.email ?? "");
    const code = String(body.code ?? "");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ ok: false, code: "invalid_email" }, { status: 400 });
    }

    if (!isStoreReviewEmail(email)) {
      return json({ mode: "not_review" });
    }

    if (!storeReviewSecretsConfigured()) {
      console.error("otp-verify: STORE_REVIEW_EMAIL set without STORE_REVIEW_OTP (or empty)");
      return json({ ok: false, code: "server_misconfigured" }, { status: 503 });
    }

    // Defense in depth — same verify caps as normal OTP.
    const db = createServiceSupabase();
    const { data: allowed, error: checkError } = await db.rpc("otp_check_verify_allowed", {
      p_email: email,
    });
    if (checkError) {
      console.warn("otp-verify: otp_check_verify_allowed", checkError.message);
    } else {
      const row = (allowed ?? {}) as LimitRow;
      if (row.ok === false) {
        return json(
          {
            mode: "review",
            ok: false,
            code: row.code ?? "verify_limit",
            retry_after_seconds: row.retry_after_seconds,
          },
          { status: 429 },
        );
      }
    }

    if (!otpMatchesStoreReview(code)) {
      await db.rpc("otp_record_verify_failure", { p_email: email }).then(({ error }) => {
        if (error) console.warn("otp-verify: otp_record_verify_failure", error.message);
      });
      return json({ mode: "review", ok: false, code: "invalid_otp" }, { status: 401 });
    }

    const session = await mintSessionForEmail(email);
    await ensureStoreReviewProfile(db, session.user.id);

    // Belt-and-suspenders: never leave a mismatched allowlist email without the flag.
    if (normalizeStoreReviewEmail(session.user.email ?? "") !== getStoreReviewEmail()) {
      console.error("otp-verify: session email mismatch after mint");
      return json({ ok: false, code: "server_error" }, { status: 500 });
    }

    return json({
      mode: "review",
      ok: true,
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      expires_at: session.expires_at,
      token_type: session.token_type ?? "bearer",
    });
  } catch (e) {
    console.error("otp-verify", e);
    return json({ ok: false, code: "server_error" }, { status: 500 });
  }
}
