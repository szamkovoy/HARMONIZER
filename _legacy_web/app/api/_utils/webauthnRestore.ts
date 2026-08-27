/**
 * Android Restore Credentials — server-side WebAuthn helpers (SimpleWebAuthn).
 * Used by /api/auth/restore-credential/* routes.
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoUint8Array, isoBase64URL } from "@simplewebauthn/server/helpers";
import { createClient } from "@supabase/supabase-js";

import { createServiceSupabase } from "./supabase";

const RP_NAME = "Harmonizer";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

type StoredCredential = {
  user_id: string;
  credential_id: string;
  public_key: string; // base64 from bytea
  counter: number;
  transports: string[];
  rp_id: string;
};

function normalizeAndroidPackage(raw: string): string {
  const pkg = raw.trim();
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i.test(pkg)) {
    throw new Error("invalid_android_package");
  }
  return pkg;
}

/** Map android package → expected WebAuthn origin (android:apk-key-hash:…). */
function expectedOriginsForPackage(androidPackage: string): string[] {
  const raw = process.env.WEBAUTHN_ANDROID_ORIGINS?.trim();
  if (!raw) return [];
  try {
    const map = JSON.parse(raw) as Record<string, string>;
    const origin = map[androidPackage]?.trim();
    return origin ? [origin] : [];
  } catch {
    return [];
  }
}

function resolveExpectedOrigin(rpID: string, clientOrigin: string | undefined): string | string[] {
  const allowed = expectedOriginsForPackage(rpID);
  if (allowed.length > 0) return allowed;
  if (!clientOrigin?.startsWith("android:apk-key-hash:")) {
    throw new Error("invalid_origin");
  }
  return [clientOrigin];
}

async function storeChallenge(params: {
  challenge: string;
  flow: "registration" | "authentication";
  rpId: string;
  userId?: string;
}) {
  const db = createServiceSupabase();
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
  const { error } = await db.from("restore_credential_challenges").insert({
    challenge: params.challenge,
    flow: params.flow,
    rp_id: params.rpId,
    user_id: params.userId ?? null,
    expires_at: expiresAt,
  });
  if (error) throw new Error(`challenge_store_failed:${error.message}`);
}

async function consumeChallenge(challenge: string, flow: "registration" | "authentication") {
  const db = createServiceSupabase();
  const { data, error } = await db
    .from("restore_credential_challenges")
    .select("id, user_id, rp_id, expires_at")
    .eq("challenge", challenge)
    .eq("flow", flow)
    .maybeSingle();
  if (error || !data) throw new Error("challenge_not_found");
  if (new Date(data.expires_at).getTime() < Date.now()) {
    await db.from("restore_credential_challenges").delete().eq("id", data.id);
    throw new Error("challenge_expired");
  }
  await db.from("restore_credential_challenges").delete().eq("id", data.id);
  return data as { user_id: string | null; rp_id: string };
}

async function getCredentialById(credentialId: string): Promise<StoredCredential | null> {
  const db = createServiceSupabase();
  const { data, error } = await db
    .from("user_restore_credentials")
    .select("user_id, credential_id, public_key, counter, transports, rp_id")
    .eq("credential_id", credentialId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as {
    user_id: string;
    credential_id: string;
    public_key: unknown;
    counter: number;
    transports: string[] | null;
    rp_id: string;
  };
  let publicKeyB64: string;
  if (typeof row.public_key === "string") {
    publicKeyB64 = row.public_key;
  } else if (row.public_key instanceof Uint8Array) {
    publicKeyB64 = Buffer.from(row.public_key).toString("base64");
  } else {
    publicKeyB64 = Buffer.from(row.public_key as ArrayBuffer).toString("base64");
  }
  return {
    user_id: row.user_id,
    credential_id: row.credential_id,
    public_key: publicKeyB64,
    counter: Number(row.counter ?? 0),
    transports: row.transports ?? [],
    rp_id: row.rp_id,
  };
}

export async function createRestoreRegistrationOptions(params: {
  userId: string;
  email: string;
  displayName?: string | null;
  androidPackage: string;
}) {
  const rpID = normalizeAndroidPackage(params.androidPackage);
  const userID = isoUint8Array.fromUTF8String(params.userId);

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: params.email,
    userDisplayName: params.displayName?.trim() || params.email,
    userID,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
  });

  await storeChallenge({
    challenge: options.challenge,
    flow: "registration",
    rpId: rpID,
    userId: params.userId,
  });

  return options;
}

export async function verifyRestoreRegistration(params: {
  userId: string;
  androidPackage: string;
  credential: RegistrationResponseJSON;
}) {
  const rpID = normalizeAndroidPackage(params.androidPackage);

  const clientData = JSON.parse(
    Buffer.from(params.credential.response.clientDataJSON, "base64url").toString("utf8"),
  ) as { challenge?: string; origin?: string };
  const challenge = clientData.challenge ?? "";
  if (!challenge) throw new Error("challenge_missing");

  const consumed = await consumeChallenge(challenge, "registration");
  if (consumed.user_id && consumed.user_id !== params.userId) {
    throw new Error("challenge_user_mismatch");
  }
  if (consumed.rp_id !== rpID) {
    throw new Error("challenge_rp_mismatch");
  }

  const verification = await verifyRegistrationResponse({
    response: params.credential,
    expectedChallenge: challenge,
    expectedOrigin: resolveExpectedOrigin(rpID, clientData.origin),
    expectedRPID: rpID,
    requireUserVerification: true,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("registration_not_verified");
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const credentialID = credential.id;
  const credentialPublicKey = credential.publicKey;
  const counter = credential.counter;

  const db = createServiceSupabase();
  const credentialIdB64 =
    typeof credentialID === "string"
      ? credentialID
      : Buffer.from(credentialID).toString("base64url");
  const { error } = await db.from("user_restore_credentials").upsert(
    {
      user_id: params.userId,
      credential_id: credentialIdB64,
      public_key: Buffer.from(credentialPublicKey),
      counter,
      transports: params.credential.response.transports ?? [],
      rp_id: rpID,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(`credential_store_failed:${error.message}`);

  return {
    credentialId: credentialIdB64,
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
  };
}

export async function createRestoreAuthenticationOptions(params: { androidPackage: string }) {
  const rpID = normalizeAndroidPackage(params.androidPackage);

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: [],
    userVerification: "required",
  });

  await storeChallenge({
    challenge: options.challenge,
    flow: "authentication",
    rpId: rpID,
  });

  return options;
}

export async function verifyRestoreAuthentication(params: {
  androidPackage: string;
  credential: AuthenticationResponseJSON;
}) {
  const rpID = normalizeAndroidPackage(params.androidPackage);

  const clientData = JSON.parse(
    Buffer.from(params.credential.response.clientDataJSON, "base64url").toString("utf8"),
  ) as { challenge?: string; origin?: string };
  const challenge = clientData.challenge ?? "";
  const consumed = await consumeChallenge(challenge, "authentication");
  if (consumed.rp_id !== rpID) {
    throw new Error("challenge_rp_mismatch");
  }

  const credentialIdB64 = params.credential.id;
  const stored = await getCredentialById(credentialIdB64);
  if (!stored || stored.rp_id !== rpID) {
    throw new Error("credential_not_found");
  }

  const verification = await verifyAuthenticationResponse({
    response: params.credential,
    expectedChallenge: challenge,
    expectedOrigin: resolveExpectedOrigin(rpID, clientData.origin),
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: {
      id: stored.credential_id,
      publicKey: isoBase64URL.toBuffer(stored.public_key),
      counter: stored.counter,
      transports: stored.transports as AuthenticatorTransportFuture[],
    },
  });

  if (!verification.verified) {
    throw new Error("authentication_not_verified");
  }

  const db = createServiceSupabase();
  await db
    .from("user_restore_credentials")
    .update({
      counter: verification.authenticationInfo.newCounter,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", stored.user_id);

  return { userId: stored.user_id };
}

export async function revokeRestoreCredential(userId: string) {
  const db = createServiceSupabase();
  await db.from("user_restore_credentials").delete().eq("user_id", userId);
}

export async function mintSupabaseSessionForUser(userId: string) {
  const db = createServiceSupabase();
  const { data: userRow, error: userError } = await db.auth.admin.getUserById(userId);
  if (userError || !userRow?.user?.email) {
    throw new Error("user_not_found");
  }
  const email = userRow.user.email;

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!supabaseUrl || !anonKey) {
    throw new Error("supabase_not_configured");
  }

  const link = await db.auth.admin.generateLink({ type: "magiclink", email });
  const hashed = link.data?.properties?.hashed_token;
  if (link.error || !hashed) {
    throw link.error ?? new Error("generateLink failed");
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await userClient.auth.verifyOtp({
    token_hash: hashed,
    type: "email",
  });
  if (error || !data.session) {
    throw error ?? new Error("verifyOtp failed");
  }
  return data.session;
}

export { normalizeAndroidPackage };
