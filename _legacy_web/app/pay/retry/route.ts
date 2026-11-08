import { handlePayRetryPost } from "../../api/account/payPages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Кнопка на /pay/failed или /pay/renew → новый счёт → форма оплаты. */
export async function POST(req: Request) {
  return handlePayRetryPost(req);
}
