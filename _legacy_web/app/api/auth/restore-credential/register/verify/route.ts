/**
 * POST /api/auth/restore-credential/register/verify
 * Authenticated — verifies registration response and stores restore credential.
 */
import type { RegistrationResponseJSON } from "@simplewebauthn/server";

import { normalizeAndroidPackage, verifyRestoreRegistration } from "../../../../_utils/webauthnRestore";
import { json, requireUser } from "../../../../_utils/supabase";

export const runtime = "nodejs";
export const maxDuration = 30;

type Body = {
  androidPackage?: string;
  credential?: RegistrationResponseJSON;
};

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
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
    const result = await verifyRestoreRegistration({
      userId: user.id,
      androidPackage,
      credential: body.credential,
    });

    return json({ ok: true, credentialId: result.credentialId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "invalid_android_package") {
      return json({ ok: false, code: "invalid_android_package" }, { status: 400 });
    }
    if (msg.startsWith("registration_not_verified") || msg.startsWith("challenge_")) {
      return json({ ok: false, code: "verification_failed" }, { status: 401 });
    }
    console.error("restore-credential/register/verify", e);
    return json({ ok: false, code: "server_error" }, { status: 500 });
  }
}
