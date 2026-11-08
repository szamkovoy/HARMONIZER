import { handlePayReturnGet } from "../../api/account/payPages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Возврат из ЮKassa (у неё один return_url на успех и отказ). */
export async function GET(req: Request) {
  return handlePayReturnGet(req);
}
