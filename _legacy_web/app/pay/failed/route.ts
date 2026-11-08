import { handlePayFailedGet } from "../../api/account/payPages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** «Оплата не удалась»: Lava failure_return_url и отказ ЮKassa. */
export async function GET(req: Request) {
  return handlePayFailedGet(req);
}
