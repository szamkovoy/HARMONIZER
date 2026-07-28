import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";

export const runtime = "nodejs";

const STATUSES = new Set(["active", "unsubscribed", "suppressed", "complained"]);

/**
 * Contacts by marketing_status for deliverability drill-down.
 * ?status=active|unsubscribed|suppressed|complained
 */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const url = new URL(req.url);
    const status = (url.searchParams.get("status") ?? "").trim();
    if (!STATUSES.has(status)) {
      return json(
        { error: "Укажите status=active|unsubscribed|suppressed|complained" },
        { status: 400 },
      );
    }

    const db = createServiceSupabase();
    const { data: contacts, error } = await db
      .from("email_contacts")
      .select("id, email, email_normalized, marketing_status, user_id, locale, updated_at")
      .eq("marketing_status", status)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw error;

    const userIds = [
      ...new Set(
        (contacts ?? [])
          .map((c) => c.user_id as string | null)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const nameByUserId = new Map<string, string>();
    if (userIds.length) {
      const { data: users } = await db
        .from("users")
        .select("id, display_name")
        .in("id", userIds);
      for (const u of users ?? []) {
        const n = (u.display_name ?? "").trim();
        if (n) nameByUserId.set(u.id, n);
      }
    }

    return json({
      status,
      contacts: (contacts ?? []).map((c) => ({
        id: c.id,
        email: c.email_normalized || c.email,
        marketing_status: c.marketing_status,
        user_id: c.user_id,
        display_name: c.user_id ? nameByUserId.get(c.user_id) ?? null : null,
        locale: c.locale,
        updated_at: c.updated_at,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
