import { haltCampaignSend } from "../../../../../_utils/emailCampaignSend";
import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../../../_utils/supabase";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Stop the in-flight wave. Already accepted Resend sends stay sent. */
export async function POST(req: Request, ctx: Ctx) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const result = await haltCampaignSend(createServiceSupabase(), id);
    if (!result.ok) {
      return json({ error: result.error }, { status: 409 });
    }
    return json({ ok: true, status: result.status });
  } catch (error) {
    return errorResponse(error);
  }
}
