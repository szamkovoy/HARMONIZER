import { refundPaymentContract } from "../../../account/refundPaymentContract";
import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { contractId, mode: "lavatop_mark" | "yookassa_api" | "yookassa_mark" }
 * yookassa_api — только при status=succeeded от ЮKassa меняет статус и тариф;
 * yookassa_mark — ручная пометка как у Lava (после отказа/pending API).
 */
export async function POST(req: Request): Promise<Response> {
  try {
    await requireAdmin(req);
    const body = (await req.json()) as { contractId?: unknown; mode?: unknown };
    const contractId = typeof body.contractId === "string" ? body.contractId.trim() : "";
    const mode =
      body.mode === "yookassa_api" ||
      body.mode === "lavatop_mark" ||
      body.mode === "yookassa_mark"
        ? body.mode
        : null;
    if (!contractId || !mode) {
      return json(
        { error: "Нужны contractId и mode (lavatop_mark|yookassa_api|yookassa_mark)" },
        { status: 400 },
      );
    }

    const result = await refundPaymentContract(createServiceSupabase(), { contractId, mode });
    if (!result.ok) {
      const status =
        result.code === "not_found"
          ? 404
          : result.code === "already_refunded" || result.code === "not_refundable"
            ? 409
            : result.code === "yookassa_api_error" ||
                result.code === "yookassa_pending" ||
                result.code === "yookassa_not_succeeded"
              ? 502
              : 400;
      return json(
        {
          error: result.error,
          code: result.code,
          ...(result.yookassaRefundId ? { yookassaRefundId: result.yookassaRefundId } : {}),
          ...(result.yookassaStatus ? { yookassaStatus: result.yookassaStatus } : {}),
        },
        { status },
      );
    }
    return json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
