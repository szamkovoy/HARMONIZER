import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";
import { findLavaOffer } from "../../../account/lava";
import { WIDGET_LOCALES } from "../../../../../lib/paymentWidget/copy";
import { CATALOG_SELECT, withLavaOffers } from "../catalogItem";

export const runtime = "nodejs";

type PatchBody = {
  title?: string;
  description?: string | null;
  /** Опционально: правка цены (RUB и др. в каталоге). */
  amount?: number;
  active?: boolean;
  /** Оффер Lava (не продукт); null — отвязать. */
  lava_offer_id?: string | null;
  webinar_credits?: number | null;
  webinar_window_days?: number | null;
  letter_subject_i18n?: Record<string, string>;
  letter_body_i18n?: Record<string, string>;
};

function localeMap(raw: unknown, maxLen: number): Record<string, string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const locale of WIDGET_LOCALES) {
    const v = (raw as Record<string, unknown>)[locale];
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (t) out[locale] = t.slice(0, maxLen);
  }
  return out;
}

function optionalPositiveInt(value: unknown): number | null | "invalid" {
  if (value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 1000) return "invalid";
  return n;
}

/**
 * Правка продукта каталога: title/description (description платежа ЮKassa),
 * цена RUB, оффер Lava, письмо покупателю, параметры пропуска на вебинары.
 * tier/provider/currency/тип — нет.
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

    if (body.lava_offer_id !== undefined) {
      const offerId = body.lava_offer_id == null ? "" : String(body.lava_offer_id).trim();
      if (offerId) {
        const found = await findLavaOffer(offerId);
        if (!found) return json({ error: "Оффер Lava не найден" }, { status: 400 });
      }
      patch.lava_offer_id = offerId || null;
    }

    for (const key of ["webinar_credits", "webinar_window_days"] as const) {
      if (body[key] === undefined) continue;
      const n = optionalPositiveInt(body[key]);
      if (n === "invalid") return json({ error: `${key} must be a positive integer` }, { status: 400 });
      patch[key] = n;
    }

    if (body.letter_subject_i18n !== undefined) {
      const map = localeMap(body.letter_subject_i18n, 200);
      if (!map) return json({ error: "letter_subject_i18n must be an object" }, { status: 400 });
      patch.letter_subject_i18n = map;
    }
    if (body.letter_body_i18n !== undefined) {
      const map = localeMap(body.letter_body_i18n, 20000);
      if (!map) return json({ error: "letter_body_i18n must be an object" }, { status: 400 });
      patch.letter_body_i18n = map;
    }

    if (Object.keys(patch).length <= 1) {
      return json({ error: "Nothing to update" }, { status: 400 });
    }

    const db = createServiceSupabase();
    const { data, error } = await db
      .from("payment_catalog")
      .update(patch)
      .eq("id", id)
      .select(CATALOG_SELECT)
      .maybeSingle();
    if (error) throw error;
    if (!data) return json({ error: "Not found" }, { status: 404 });
    const { items } = await withLavaOffers([data as Record<string, unknown>]);
    return json({ item: items[0] });
  } catch (error) {
    return errorResponse(error);
  }
}
