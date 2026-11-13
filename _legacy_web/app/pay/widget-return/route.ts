import { handleWidgetReturnGet } from "../../api/widget/widgetReturn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Возврат из ЮKassa после оплаты через виджет: «спасибо» только при прошедшем платеже. */
export async function GET(req: Request) {
  return handleWidgetReturnGet(req);
}
