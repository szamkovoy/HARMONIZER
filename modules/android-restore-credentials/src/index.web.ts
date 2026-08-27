export function isRestoreCredentialsNativeSupported(): boolean {
  return false;
}

export async function nativeCreateRestoreCredential(
  _requestJson: string,
  _cloudBackup: boolean,
): Promise<string> {
  throw new Error("Restore Credentials are Android-only");
}

export async function nativeGetRestoreCredential(_requestJson: string): Promise<string | null> {
  return null;
}

export async function nativeClearRestoreCredentialState(): Promise<void> {
  // no-op
}
