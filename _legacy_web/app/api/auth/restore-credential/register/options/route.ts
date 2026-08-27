/**
 * POST /api/auth/restore-credential/register/options
 * Authenticated — returns WebAuthn creation options for Restore Credentials.
 */
import {
  createRestoreRegistrationOptions,
  normalizeAndroidPackage,
} from "../../../../_utils/webauthnRestore";
import { createServiceSupabase, json, requireUser } from "../../../../_utils/supabase";

export const runtime = "nodejs";
export const maxDuration = 30;

type Body = {
  androidPackage?: string;
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

    const androidPackage = normalizeAndroidPackage(body.androidPackage ?? "");
    const db = createServiceSupabase();
    const { data: profile } = await db
      .from("users")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle();

    const options = await createRestoreRegistrationOptions({
      userId: user.id,
      email: user.email ?? "",
      displayName: profile?.display_name ?? null,
      androidPackage,
    });

    return json({ ok: true, options });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "invalid_android_package") {
      return json({ ok: false, code: "invalid_android_package" }, { status: 400 });
    }
    console.error("restore-credential/register/options", e);
    return json({ ok: false, code: "server_error" }, { status: 500 });
  }
}
