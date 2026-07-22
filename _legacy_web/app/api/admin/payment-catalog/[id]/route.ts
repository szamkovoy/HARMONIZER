import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";

export const runtime = "nodejs";

type PatchBody = {
  title?: string;
  description?: string | null;
  /** Опционально: правка цены (RUB и др. в каталоге). */
  amount?: number;
  active?: boolean;
};

/**
 * Правка title/description (показываются в description платежа ЮKassa).
 * Цена и тип продукта тоже можно менять; tier/provider/currency — нет.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    if (!id?.trim()) return json({ error: "id required" }, { status: 400 });

    const body = (await req.json().catch(() => null)) as PatchBody | null;
    if (!body) return json({ error: "Invalid JSON" }, { status: 400 });

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (!title) return json({ error: "title must be non-empty" }, { status: 400 });
      if (title.length > 128) {
        return json({ error: "title max 128 chars (YooKassa description limit)" }, { status: 400 });
      }
      patch.title = title;
    }

    if (body.description !== undefined) {
      const desc =
        body.description == null ? null : String(body.description).trim() || null;
      if (desc && desc.length > 128) {
        return json(
          { error: "description max 128 chars (YooKassa description limit)" },
          { status: 400 },
        );
      }
      patch.description = desc;
    }

    if (body.amount !== undefined) {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return json({ error: "amount must be a positive number" }, { status: 400 });
      }
      patch.amount = amount;
    }

    if (body.active !== undefined) {
      patch.active = Boolean(body.active);
    }

    if (Object.keys(patch).length <= 1) {
      return json({ error: "Nothing to update" }, { status: 400 });
    }

    const db = createServiceSupabase();
    const { data, error } = await db
      .from("payment_catalog")
      .update(patch)
      .eq("id", id)
      .select(
        "id, provider, tier, currency, amount, title, description, product_kind, active, updated_at",
      )
      .maybeSingle();
    if (error) throw error;
    if (!data) return json({ error: "Not found" }, { status: 404 });
    return json({ item: data });
  } catch (error) {
    return errorResponse(error);
  }
}
