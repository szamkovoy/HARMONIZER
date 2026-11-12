import { handlePayRenewGet } from "../../api/account/payPages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** «Продлить доступ»: ссылка из письма о конце оплаченных 30 дней. */
export async function GET(req: Request) {
  return handlePayRenewGet(req);
}
