/** Quick tap vs hold — same threshold as common messenger UX. */
export const MIC_TAP_LOCK_THRESHOLD_MS = 250;

/**
 * After MediaRecorder starts, some Android OEMs (Samsung One UI, Huawei, Oppo…)
 * briefly flip AppState to inactive/background. Discarding there looks like a
 * one-frame “shutter” jerk of the communicator page with no lasting mic ring.
 */
export const MIC_APPSTATE_SETTLE_MS = 1_000;

/** AAC/M4A containers smaller than this are almost always corrupt or empty. */
export const MIN_VOICE_FILE_BYTES = 256;

/** Hold-to-talk while finger is down; tap_toggle stays on until next tap. */
export type MicCaptureMode = "hold" | "tap_toggle";

export function isQuickMicTap(pressDurationMs: number): boolean {
  return pressDurationMs >= 0 && pressDurationMs < MIC_TAP_LOCK_THRESHOLD_MS;
}

export function isInvalidTranscriptionMediaError(message: string): boolean {
  return /invalid media file|could not process file/i.test(message);
}

export function isVoiceRecordingFileTooSmall(
  sizeBytes: number,
  durationMs: number,
  minDurationMs: number,
  minBytes: number = MIN_VOICE_FILE_BYTES,
): boolean {
  return sizeBytes < minBytes || durationMs < minDurationMs;
}

export type MicPressInAction =
  | { type: "start_recording" }
  | { type: "stop_and_send" }
  | { type: "ignore" };

export type MicPressOutAction =
  | { type: "noop" }
  | { type: "enter_tap_toggle" }
  | { type: "stop_and_send" }
  | { type: "cancel_warmup" }
  | { type: "reset_pressable" };

export function resolveMicPressIn(input: {
  uiMode: "VOICE" | "TXT";
  phase: "idle" | "arming" | "recording" | "transcribing" | "error";
  captureMode: MicCaptureMode | null;
  streamBusy: boolean;
  dialogWindDown: boolean;
}): MicPressInAction {
  if (input.uiMode !== "VOICE") return { type: "ignore" };

  if (input.phase === "recording" && input.captureMode === "tap_toggle") {
    return { type: "stop_and_send" };
  }

  if (input.phase !== "idle") return { type: "ignore" };
  if (input.streamBusy || input.dialogWindDown) return { type: "ignore" };

  return { type: "start_recording" };
}

export function resolveMicPressOut(input: {
  pressDurationMs: number;
  phase: "idle" | "arming" | "recording" | "transcribing" | "error";
  captureMode: MicCaptureMode | null;
  hasActiveRecording: boolean;
  micWarmup: boolean;
  awaitingMicPermission: boolean;
}): MicPressOutAction {
  const quickTap = isQuickMicTap(input.pressDurationMs);

  if (input.phase === "recording" && input.hasActiveRecording) {
    if (input.captureMode === "tap_toggle") return { type: "noop" };
    if (input.captureMode === "hold") return { type: "stop_and_send" };
    if (quickTap) return { type: "enter_tap_toggle" };
    return { type: "stop_and_send" };
  }

  if (input.hasActiveRecording && input.phase !== "recording") {
    if (quickTap) return { type: "enter_tap_toggle" };
    return { type: "stop_and_send" };
  }

  // During arming/prepare never cancel on finger-up: Samsung/One UI often
  // releases early (permission dialog, slow createAsync, spurious pressOut).
  // Keep going and lock tap-to-stop — like Telegram/WhatsApp.
  if (input.micWarmup) {
    if (input.awaitingMicPermission) return { type: "noop" };
    return { type: "enter_tap_toggle" };
  }

  return { type: "reset_pressable" };
}

/** Called when native recorder actually starts — never remount Pressable here if finger is down. */
export function captureModeWhenRecordingStarts(
  fingerDown: boolean,
  pendingMode: MicCaptureMode | null,
): MicCaptureMode {
  if (pendingMode === "tap_toggle") return "tap_toggle";
  if (fingerDown) return "hold";
  return "tap_toggle";
}

export type MicAppStatePlatform = "ios" | "android" | "web" | "windows" | "macos";

/**
 * Whether an AppState change should tear down an in-flight / active mic session.
 * Pure helper so OEM quirks stay unit-tested.
 */
export function shouldDiscardMicOnAppState(input: {
  nextState: string;
  platform: MicAppStatePlatform | string;
  awaitingMicPermission: boolean;
  micWarmup: boolean;
  /** Date.now() deadline — ignore discard while settling after createAsync. */
  ignoreAppStateUntilMs: number;
  nowMs: number;
}): boolean {
  if (input.awaitingMicPermission || input.micWarmup) return false;
  if (input.nowMs < input.ignoreAppStateUntilMs) return false;
  if (input.nextState !== "background" && input.nextState !== "inactive") return false;
  // Android: inactive is almost always a system overlay / privacy indicator /
  // audio-focus blip — not the user leaving the dialog.
  if (input.platform === "android" && input.nextState === "inactive") return false;
  return true;
}
