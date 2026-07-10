// @ts-nocheck
import { assertCronSecret, createServiceClient, isOptions, json } from "../_shared/supabase.ts";

const BATCH_LIMIT = 100;
const MAX_BATCHES = 10;

Deno.serve(async (req) => {
  if (isOptions(req)) return new Response("ok");
  const unauthorized = assertCronSecret(req);
  if (unauthorized) return unauthorized;

  try {
    const db = createServiceClient();
    let reconciledCount = 0;
    let batchCount = 0;

    while (batchCount < MAX_BATCHES) {
      const { data, error } = await db.rpc("reconcile_expired_memberships", {
        p_limit: BATCH_LIMIT,
      });
      if (error) throw error;

      const batchSize = typeof data === "number" ? data : Number(data ?? 0);
      reconciledCount += batchSize;
      batchCount += 1;
      if (batchSize < BATCH_LIMIT) break;
    }

    return json({ ok: true, reconciledCount, batches: batchCount });
  } catch (error) {
    console.error("[reconcile-expired-memberships]", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
});
