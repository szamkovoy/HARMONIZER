/**
 * POST /api/auth/restore-credential/auth/options
 * Unauthenticated — returns WebAuthn request options for restore on a new device.
 */
import {
  createRestoreAuthenticationOptions,
  normalizeAndroidPackage,
} from "../../../../_utils/webauthnRestore";
import { json } from "../../../../_utils/supabase";

export const runtime = "nodejs";
export const maxDuration = 30;

type Body = {
  androidPackage?: string;
};

export async function POST(req: Request) {
  try {
    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return json({ ok: false, code: "invalid_json" }, { status: 400 });
    }

    const androidPackage = normalizeAndroidPackage(body.androidPackage ?? "");
    const options = await createRestoreAuthenticationOptions({ androidPackage });

    return json({ ok: true, options });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "invalid_android_package") {
      return json({ ok: false, code: "invalid_android_package" }, { status: 400 });
    }
    console.error("restore-credential/auth/options", e);
    return json({ ok: false, code: "server_error" }, { status: 500 });
  }
}
