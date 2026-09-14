import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { verifyAccessTokenLocally } from "./supabase";

function b64url(input: Uint8Array | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function makeKeyPair() {
  return crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
}

async function signToken(privateKey: CryptoKey, header: Record<string, unknown>, payload: Record<string, unknown>) {
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${b64url(new Uint8Array(sig))}`;
}

describe("verifyAccessTokenLocally", () => {
  const fetchMock = vi.fn();
  let jwk: JsonWebKey;
  let privateKey: CryptoKey;

  beforeEach(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    const pair = await makeKeyPair();
    privateKey = pair.privateKey;
    jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ keys: [{ ...jwk, kid: "kid-1", alg: "ES256", use: "sig" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts a token signed by the project key and caches the JWKS", async () => {
    // Fresh module state per test file: first call fetches JWKS.
    const token = await signToken(privateKey, { alg: "ES256", kid: "kid-1", typ: "JWT" }, { sub: "u1", exp: 4102444800 });
    expect(await verifyAccessTokenLocally(token)).toBe(true);
    const calls = fetchMock.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(1);

    const again = await signToken(privateKey, { alg: "ES256", kid: "kid-1" }, { sub: "u2", exp: 4102444800 });
    expect(await verifyAccessTokenLocally(again)).toBe(true);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("rejects a token signed by a different key with the same kid", async () => {
    const other = await makeKeyPair();
    const forged = await signToken(other.privateKey, { alg: "ES256", kid: "kid-1" }, { sub: "u1" });
    expect(await verifyAccessTokenLocally(forged)).toBe(false);
  });

  it("returns null (fallback to probe) for HS256 tokens and unknown kids", async () => {
    const hs = `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify({ sub: "u1" }))}.${b64url("sig")}`;
    expect(await verifyAccessTokenLocally(hs)).toBe(null);

    const unknown = await signToken(privateKey, { alg: "ES256", kid: "kid-rotated" }, { sub: "u1" });
    expect(await verifyAccessTokenLocally(unknown)).toBe(null);
  });
});
