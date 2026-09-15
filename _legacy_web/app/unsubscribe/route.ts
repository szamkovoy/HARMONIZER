import {
  handleMarketingUnsubscribeGet,
  handleMarketingUnsubscribePost,
} from "../api/_utils/emailUnsubscribe";

export const runtime = "nodejs";

/** Canonical public unsubscribe URL: /unsubscribe?t=… */
export async function GET(req: Request) {
  return handleMarketingUnsubscribeGet(req);
}

/** List-Unsubscribe=One-Click (RFC 8058). */
export async function POST(req: Request) {
  return handleMarketingUnsubscribePost(req);
}
