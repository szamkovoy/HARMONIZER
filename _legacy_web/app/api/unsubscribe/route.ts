import {
  handleMarketingUnsubscribeGet,
  handleMarketingUnsubscribePost,
} from "../_utils/emailUnsubscribe";

export const runtime = "nodejs";

/** Alias of /unsubscribe — same token, GET page + RFC 8058 POST. */
export async function GET(req: Request) {
  return handleMarketingUnsubscribeGet(req);
}

export async function POST(req: Request) {
  return handleMarketingUnsubscribePost(req);
}
