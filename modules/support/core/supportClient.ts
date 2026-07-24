import { NativeModules } from "react-native";
import {
  FileSystemUploadType,
  getInfoAsync,
  readAsStringAsync,
  uploadAsync,
} from "expo-file-system/legacy";

import { getCommunicatorApiBaseUrl } from "@/services/communicatorConfig";
import { getSupabase } from "@/services/supabase";

export const MAX_SUPPORT_MESSAGE_LENGTH = 4000;
export const MAX_SUPPORT_ATTACHMENTS = 3;
export const MAX_SUPPORT_ATTACHMENT_BYTES = 3_145_728; // 3 MB
export const SUPPORT_ATTACHMENT_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
const SUPPORT_BUCKET = "support-attachments";

export type SupportAttachmentDraft = {
  uri: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
};

export type SupportAttachmentInput = {
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
};

type SignedUploadTicket = {
  path: string;
  token: string;
  signedUrl: string;
};

async function getAccessToken(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

function getStorageApiBaseUrl(): string | null {
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/storage/v1`;
}

/** Build the same signed PUT URL that supabase-js uploadToSignedUrl uses. */
function buildSignedUploadUrl(path: string, token: string): string | null {
  const storageBase = getStorageApiBaseUrl();
  if (!storageBase) return null;
  // Path in URL MUST include bucket — иначе Storage отвечает InvalidSignature.
  const url = new URL(`${storageBase}/object/upload/sign/${SUPPORT_BUCKET}/${path}`);
  url.searchParams.set("token", token);
  return url.toString();
}

/** True only when the current native binary includes expo-image-picker. */
export function isSupportImagePickerAvailable(): boolean {
  return Boolean(
    NativeModules.ExponentImagePicker ||
      NativeModules.ExpoImagePicker ||
      // Newer Expo module registry name
      (NativeModules.ExpoModulesCore &&
        typeof (NativeModules as { ExpoImagePicker?: unknown }).ExpoImagePicker !== "undefined"),
  );
}

/** Prefetch JS module + permission status so the first attach tap is not cold. */
export async function warmSupportImagePicker(): Promise<void> {
  if (!isSupportImagePickerAvailable()) return;
  try {
    const ImagePicker = await import("expo-image-picker");
    if (typeof ImagePicker.getMediaLibraryPermissionsAsync === "function") {
      await ImagePicker.getMediaLibraryPermissionsAsync();
    }
  } catch {
    /* best-effort */
  }
}

/**
 * Pick up to remaining slots from the photo library.
 * Uses ImagePicker compression only (no expo-image-manipulator) so one native
 * module is enough. Returns `{ error: "native" }` if the binary was not rebuilt.
 */
export async function pickSupportScreenshots(
  alreadyCount: number,
): Promise<SupportAttachmentDraft[] | { error: string }> {
  const remaining = MAX_SUPPORT_ATTACHMENTS - alreadyCount;
  if (remaining <= 0) return { error: "limit" };

  if (!isSupportImagePickerAvailable()) {
    return { error: "native" };
  }

  let ImagePicker: typeof import("expo-image-picker");
  try {
    ImagePicker = await import("expo-image-picker");
  } catch {
    return { error: "native" };
  }

  if (typeof ImagePicker.requestMediaLibraryPermissionsAsync !== "function") {
    return { error: "native" };
  }

  try {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return { error: "permission" };

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      // Compress in-picker so we do not need expo-image-manipulator.
      quality: 0.8,
      // iOS: отдать JPEG/PNG вместо HEIC (бакет принимает только jpeg/png/webp).
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (result.canceled || result.assets.length === 0) return [];

    const drafts: SupportAttachmentDraft[] = [];
    for (const asset of result.assets) {
      const prepared = await prepareSupportImage(asset);
      if ("error" in prepared) return prepared;
      drafts.push(prepared);
    }
    return drafts;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/native module|ExponentImagePicker|ExpoImagePicker/i.test(message)) {
      return { error: "native" };
    }
    return { error: "upload" };
  }
}

async function prepareSupportImage(asset: {
  uri: string;
  mimeType?: string | null;
  fileSize?: number;
}): Promise<SupportAttachmentDraft | { error: string }> {
  let mimeType = (asset.mimeType ?? "image/jpeg").toLowerCase();
  if (mimeType === "image/jpg") mimeType = "image/jpeg";

  // HEIC and other non-whitelisted types: ask the user to re-export as JPEG/PNG.
  if (!SUPPORT_ATTACHMENT_MIME.includes(mimeType as (typeof SUPPORT_ATTACHMENT_MIME)[number])) {
    if (mimeType.includes("heic") || mimeType.includes("heif")) {
      return { error: "type" };
    }
    return { error: "type" };
  }

  const sizeBytes = await measureUriBytes(asset.uri, asset.fileSize);
  if (sizeBytes <= 0) return { error: "type" };
  if (sizeBytes > MAX_SUPPORT_ATTACHMENT_BYTES) return { error: "size" };

  return { uri: asset.uri, mimeType, sizeBytes };
}

async function measureUriBytes(uri: string, hintedSize?: number): Promise<number> {
  if (typeof hintedSize === "number" && hintedSize > 0) return hintedSize;
  try {
    const info = await getInfoAsync(uri);
    if (info.exists && typeof info.size === "number" && info.size > 0) {
      return info.size;
    }
  } catch {
    /* fall through */
  }
  return 0;
}

/** RN FormData + Blob from fetch(fileUri) often uploads 0 bytes to Storage — use raw ArrayBuffer. */
function decodeBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/** Prefer fetch→arrayBuffer (native); base64 only as last resort (slow on Android). */
async function readUriAsArrayBuffer(
  uri: string,
): Promise<{ buffer: ArrayBuffer; sizeBytes: number } | { error: string }> {
  try {
    const response = await fetch(uri);
    if (response.ok) {
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > 0) {
        if (buffer.byteLength > MAX_SUPPORT_ATTACHMENT_BYTES) return { error: "size" };
        return { buffer, sizeBytes: buffer.byteLength };
      }
    }
  } catch {
    /* fall through to base64 */
  }

  try {
    const base64 = await readAsStringAsync(uri, { encoding: "base64" });
    if (!base64) return { error: "upload" };
    const buffer = decodeBase64ToArrayBuffer(base64);
    if (buffer.byteLength <= 0) return { error: "upload" };
    if (buffer.byteLength > MAX_SUPPORT_ATTACHMENT_BYTES) return { error: "size" };
    return { buffer, sizeBytes: buffer.byteLength };
  } catch {
    return { error: "upload" };
  }
}

async function requestSignedUpload(
  contentType: string,
  bytes: number,
): Promise<SignedUploadTicket | { error: string }> {
  const token = await getAccessToken();
  if (!token) return { error: "offline" };
  const res = await fetch(`${getCommunicatorApiBaseUrl()}/api/support/uploads`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ contentType, bytes }),
  });
  const payload = (await res.json().catch(() => null)) as
    | { path?: string; token?: string; signedUrl?: string; error?: string }
    | null;
  if (!res.ok || !payload?.path || !payload?.token) {
    return { error: payload?.error ?? "upload" };
  }
  const signedUrl =
    typeof payload.signedUrl === "string" && payload.signedUrl.startsWith("http")
      ? payload.signedUrl
      : buildSignedUploadUrl(payload.path, payload.token);
  if (!signedUrl) return { error: "offline" };
  return { path: payload.path, token: payload.token, signedUrl };
}

async function uploadViaNativePut(
  ticket: SignedUploadTicket,
  draft: SupportAttachmentDraft,
  sizeBytes: number,
): Promise<SupportAttachmentInput | { error: string }> {
  try {
    const result = await uploadAsync(ticket.signedUrl, draft.uri, {
      httpMethod: "PUT",
      uploadType: FileSystemUploadType.BINARY_CONTENT,
      headers: {
        // Как supabase-js uploadToSignedUrl для ArrayBuffer body.
        "Content-Type": draft.mimeType,
        "cache-control": "max-age=3600",
        "x-upsert": "false",
      },
    });
    if (result.status >= 200 && result.status < 300) {
      return {
        storagePath: ticket.path,
        mimeType: draft.mimeType,
        sizeBytes,
      };
    }
    if (__DEV__) {
      console.warn("[support] native upload status", result.status, result.body?.slice?.(0, 240));
    }
    return { error: "upload" };
  } catch (error) {
    if (__DEV__) {
      console.warn(
        "[support] native upload failed",
        error instanceof Error ? error.message : error,
      );
    }
    return { error: "upload" };
  }
}

async function uploadViaSupabaseBuffer(
  draft: SupportAttachmentDraft,
): Promise<SupportAttachmentInput | { error: string }> {
  const supabase = getSupabase();
  if (!supabase) return { error: "offline" };

  const file = await readUriAsArrayBuffer(draft.uri);
  if ("error" in file) return file;

  const ticket = await requestSignedUpload(draft.mimeType, file.sizeBytes);
  if ("error" in ticket) return ticket;

  const { error } = await supabase.storage
    .from(SUPPORT_BUCKET)
    .uploadToSignedUrl(ticket.path, ticket.token, file.buffer, {
      contentType: draft.mimeType,
      cacheControl: "3600",
    });
  if (error) {
    if (__DEV__) console.warn("[support] buffer upload failed", error.message);
    return { error: "upload" };
  }

  return {
    storagePath: ticket.path,
    mimeType: draft.mimeType,
    sizeBytes: file.sizeBytes,
  };
}

/**
 * 1) Native FileSystem.uploadAsync PUT to signed URL (fast, no JS base64).
 * 2) Fallback: fetch(uri).arrayBuffer + supabase uploadToSignedUrl.
 */
async function uploadDraft(
  draft: SupportAttachmentDraft,
): Promise<SupportAttachmentInput | { error: string }> {
  const sizeBytes = await measureUriBytes(draft.uri, draft.sizeBytes);
  if (sizeBytes <= 0) return { error: "type" };
  if (sizeBytes > MAX_SUPPORT_ATTACHMENT_BYTES) return { error: "size" };

  const ticket = await requestSignedUpload(draft.mimeType, sizeBytes);
  if ("error" in ticket) return ticket;

  const native = await uploadViaNativePut(ticket, draft, sizeBytes);
  if (!("error" in native)) return native;

  if (__DEV__) console.warn("[support] falling back to buffer upload");
  return uploadViaSupabaseBuffer(draft);
}

export async function sendSupportMessage(
  userId: string,
  body: string,
  drafts: SupportAttachmentDraft[] = [],
  options?: { isCancelled?: () => boolean },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, message: "offline" };
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, message: "empty" };
  if (drafts.length > MAX_SUPPORT_ATTACHMENTS) return { ok: false, message: "limit" };

  const uploaded: SupportAttachmentInput[] = [];
  const cancelled = () => options?.isCancelled?.() === true;

  try {
    for (const draft of drafts) {
      if (cancelled()) {
        await cleanupUploaded(uploaded.map((u) => u.storagePath));
        return { ok: false, message: "cancelled" };
      }
      const result = await uploadDraft(draft);
      if ("error" in result) {
        await cleanupUploaded(uploaded.map((u) => u.storagePath));
        return { ok: false, message: result.error };
      }
      uploaded.push(result);
    }

    if (cancelled()) {
      await cleanupUploaded(uploaded.map((u) => u.storagePath));
      return { ok: false, message: "cancelled" };
    }

    const { data: message, error } = await supabase
      .from("support_messages")
      .insert({ user_id: userId, body: trimmed.slice(0, MAX_SUPPORT_MESSAGE_LENGTH) })
      .select("id")
      .single();
    if (error || !message?.id) {
      await cleanupUploaded(uploaded.map((u) => u.storagePath));
      return { ok: false, message: error?.message ?? "insert" };
    }

    if (uploaded.length > 0) {
      const rows = uploaded.map((file, index) => ({
        message_id: message.id,
        storage_path: file.storagePath,
        mime_type: file.mimeType,
        size_bytes: file.sizeBytes,
        sort_order: index,
      }));
      const { error: attachError } = await supabase.from("support_message_attachments").insert(rows);
      if (attachError) {
        await supabase.from("support_messages").delete().eq("id", message.id);
        await cleanupUploaded(uploaded.map((u) => u.storagePath));
        return { ok: false, message: attachError.message };
      }
    }

    if (cancelled()) {
      // Сообщение уже в БД — не откатываем; UI просто закрыт.
      return { ok: true };
    }

    return { ok: true };
  } catch (error) {
    await cleanupUploaded(uploaded.map((u) => u.storagePath));
    return {
      ok: false,
      message: error instanceof Error ? error.message : "failed",
    };
  }
}

async function cleanupUploaded(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.storage.from(SUPPORT_BUCKET).remove(paths);
}
