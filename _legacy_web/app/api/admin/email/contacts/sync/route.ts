import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../../_utils/supabase";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Upsert email_contacts from auth.users + public.users (does not wipe unsubscribe). */
export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const db = createServiceSupabase();
    const { data, error } = await db.rpc("sync_email_contacts_from_users");
    if (error) throw error;
    return json({ result: data });
  } catch (error) {
    return errorResponse(error);
  }
}
