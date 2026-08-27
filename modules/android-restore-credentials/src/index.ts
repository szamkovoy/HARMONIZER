import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

type AndroidRestoreCredentialsNative = {
  isSupported?(): boolean;
  createRestoreCredential?(requestJson: string, cloudBackup: boolean): Promise<string>;
  getRestoreCredential?(requestJson: string): Promise<string | null>;
  clearRestoreCredentialState?(): Promise<void>;
};

const nativeModule =
  requireOptionalNativeModule<AndroidRestoreCredentialsNative>("AndroidRestoreCredentials");

/** Android 9+ with Credential Manager module present in the dev/prod client. */
export function isRestoreCredentialsNativeSupported(): boolean {
  if (Platform.OS !== "android") return false;
  if (!nativeModule?.isSupported) return false;
  try {
    return nativeModule.isSupported() === true;
  } catch {
    return false;
  }
}

export async function nativeCreateRestoreCredential(
  requestJson: string,
  cloudBackup: boolean,
): Promise<string> {
  if (!nativeModule?.createRestoreCredential) {
    throw new Error("AndroidRestoreCredentials native module unavailable");
  }
  return nativeModule.createRestoreCredential(requestJson, cloudBackup);
}

export async function nativeGetRestoreCredential(requestJson: string): Promise<string | null> {
  if (!nativeModule?.getRestoreCredential) return null;
  try {
    return await nativeModule.getRestoreCredential(requestJson);
  } catch {
    return null;
  }
}

export async function nativeClearRestoreCredentialState(): Promise<void> {
  if (!nativeModule?.clearRestoreCredentialState) return;
  try {
    await nativeModule.clearRestoreCredentialState();
  } catch {
    // Best-effort on sign-out.
  }
}
