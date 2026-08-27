/**
 * POST /api/auth/restore-credential/auth/verify
 * Unauthenticated — verifies restore assertion and mints Supabase session.
 */
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";

import {
  mintSupabaseSessionForUser,
  normalizeAndroidPackage,
  verifyRestoreAuthentication,
} from "../../../../_utils/webauthnRestore";
import { json } from "../../../../_utils/supabase";

export const runtime = "nodejs";
export const maxDuration = 30;

type Body = {
  androidPackage?: string;
  credential?: AuthenticationResponseJSON;
};

export async function POST(req: Request) {
  try {
    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return json({ ok: false, code: "invalid_json" }, { status: 400 });
    }

    if (!body.credential) {
      return json({ ok: false, code: "credential_required" }, { status: 400 });
    }

    const androidPackage = normalizeAndroidPackage(body.androidPackage ?? "");
    const { userId } = await verifyRestoreAuthentication({
      androidPackage,
      credential: body.credential,
    });

    const session = await mintSupabaseSessionForUser(userId);

    return json({
      ok: true,
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      expires_at: session.expires_at,
      token_type: session.token_type ?? "bearer",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "invalid_android_package") {
      return json({ ok: false, code: "invalid_android_package" }, { status: 400 });
    }
    if (
      msg.startsWith("authentication_not_verified") ||
      msg.startsWith("credential_not_found") ||
      msg.startsWith("challenge_")
    ) {
      return json({ ok: false, code: "verification_failed" }, { status: 401 });
    }
    console.error("restore-credential/auth/verify", e);
    return json({ ok: false, code: "server_error" }, { status: 500 });
  }
}
