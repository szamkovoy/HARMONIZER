import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { ensureMembershipForActiveContract, type FulfillContractRow } from "./fulfillPaymentContract";
import { tierCheckoutBlocks } from "./tierCheckout";

const DAY = 24 * 60 * 60 * 1000;
const GRACE_MS = 48 * 60 * 60 * 1000;
const USER_ID = "8f0c7a1e-0000-4000-8000-000000000001";

function isoFromNow(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

function contract(overrides: Partial<FulfillContractRow> = {}): FulfillContractRow {
  return {
    user_id: USER_ID,
    contract_id: "contract-1",
    tier: "oracle",
    status: "active",
    product_kind: "subscription",
    product_ref: null,
    provider: "lavatop",
    current_period_end: isoFromNow(10 * DAY),
    ...overrides,
  };
}

/** Fluent stub: contracts list, user row, and recorded users updates. */
function dbStub(opts: {
  contracts: Array<Record<string, unknown>>;
  user: { membership_tier: string | null; membership_expires_at: string | null } | null;
}) {
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    from(table: string) {
      const data = table === "payment_contracts" ? opts.contracts : table === "users" ? opts.user : null;
      const result = { data, error: null as null };
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      for (const method of ["select", "eq", "order", "limit", "in"]) chain[method] = self;
      chain.maybeSingle = () => Promise.resolve(result);
      chain.update = (patch: Record<string, unknown>) => {
        updates.push(patch);
        return chain;
      };
      chain.then = (resolve: (value: typeof result) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject);
      return chain;
    },
  };
  return { db: db as unknown as SupabaseClient, updates };
}

describe("tierCheckoutBlocks", () => {
  it("does not block a subscription or a pass when the active period ended 3 days ago", async () => {
    const { db } = dbStub({
      contracts: [
        {
          tier: "master",
          status: "active",
          current_period_end: isoFromNow(-3 * DAY),
        },
      ],
      user: { membership_tier: "free", membership_expires_at: null },
    });

    await expect(tierCheckoutBlocks(db, { userId: USER_ID, tier: "oracle" })).resolves.toEqual({
      subscription: null,
      pass: null,
    });
    await expect(tierCheckoutBlocks(db, { userId: USER_ID, tier: "master" })).resolves.toEqual({
      subscription: null,
      pass: null,
    });
  });
});

describe("ensureMembershipForActiveContract", () => {
  it("extends membership when the user period is shorter than the paid one", async () => {
    const end = new Date(Date.now() + 10 * DAY);
    const { db, updates } = dbStub({
      contracts: [],
      user: { membership_tier: "oracle", membership_expires_at: isoFromNow(DAY) },
    });

    const granted = await ensureMembershipForActiveContract(
      db,
      contract({ tier: "oracle", current_period_end: end.toISOString() }),
    );

    expect(granted).toBe(true);
    expect(updates).toEqual([
      {
        membership_tier: "oracle",
        membership_expires_at: new Date(end.getTime() + GRACE_MS).toISOString(),
      },
    ]);
  });

  it("leaves a higher paid tier untouched", async () => {
    const { db, updates } = dbStub({
      contracts: [],
      user: { membership_tier: "master", membership_expires_at: isoFromNow(20 * DAY) },
    });

    const granted = await ensureMembershipForActiveContract(
      db,
      contract({ tier: "oracle", current_period_end: isoFromNow(10 * DAY) }),
    );

    expect(granted).toBe(false);
    expect(updates).toEqual([]);
  });

  it("does nothing when the paid period and its grace are already over", async () => {
    const { db, updates } = dbStub({
      contracts: [],
      user: { membership_tier: "oracle", membership_expires_at: isoFromNow(-DAY) },
    });

    const granted = await ensureMembershipForActiveContract(
      db,
      contract({ current_period_end: isoFromNow(-3 * DAY) }),
    );

    expect(granted).toBe(false);
    expect(updates).toEqual([]);
  });
});
