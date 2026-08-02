import { describe, expect, it } from "vitest";

import {
  captureModeWhenRecordingStarts,
  isInvalidTranscriptionMediaError,
  isQuickMicTap,
  isVoiceRecordingFileTooSmall,
  MIC_APPSTATE_SETTLE_MS,
  MIC_TAP_LOCK_THRESHOLD_MS,
  MIN_VOICE_FILE_BYTES,
  resolveMicPressIn,
  resolveMicPressOut,
  shouldDiscardMicOnAppState,
} from "./micGesture";

describe("micGesture", () => {
  it("treats sub-threshold press as quick tap", () => {
    expect(isQuickMicTap(0)).toBe(true);
    expect(isQuickMicTap(MIC_TAP_LOCK_THRESHOLD_MS - 1)).toBe(true);
    expect(isQuickMicTap(MIC_TAP_LOCK_THRESHOLD_MS)).toBe(false);
  });

  it("detects Groq invalid media errors", () => {
    expect(
      isInvalidTranscriptionMediaError(
        'Groq transcription failed: 400 {"error":{"message":"could not process file - is it a valid media file?"}}',
      ),
    ).toBe(true);
    expect(isInvalidTranscriptionMediaError("Network request failed")).toBe(false);
  });

  it("rejects tiny or too-short recordings", () => {
    expect(isVoiceRecordingFileTooSmall(MIN_VOICE_FILE_BYTES - 1, 500, 450)).toBe(true);
    expect(isVoiceRecordingFileTooSmall(MIN_VOICE_FILE_BYTES, 400, 450)).toBe(true);
    expect(isVoiceRecordingFileTooSmall(MIN_VOICE_FILE_BYTES, 500, 450)).toBe(false);
  });

  describe("resolveMicPressIn", () => {
    it("starts recording from idle", () => {
      expect(
        resolveMicPressIn({
          uiMode: "VOICE",
          phase: "idle",
          captureMode: null,
          streamBusy: false,
          dialogWindDown: false,
        }),
      ).toEqual({ type: "start_recording" });
    });

    it("stops tap-toggle recording on second tap", () => {
      expect(
        resolveMicPressIn({
          uiMode: "VOICE",
          phase: "recording",
          captureMode: "tap_toggle",
          streamBusy: true,
          dialogWindDown: false,
        }),
      ).toEqual({ type: "stop_and_send" });
    });

    it("ignores press-in during hold recording", () => {
      expect(
        resolveMicPressIn({
          uiMode: "VOICE",
          phase: "recording",
          captureMode: "hold",
          streamBusy: true,
          dialogWindDown: false,
        }),
      ).toEqual({ type: "ignore" });
    });
  });

  describe("resolveMicPressOut", () => {
    it("tap: quick release during arming enters tap_toggle", () => {
      expect(
        resolveMicPressOut({
          pressDurationMs: 120,
          phase: "arming",
          captureMode: null,
          hasActiveRecording: false,
          micWarmup: true,
          awaitingMicPermission: false,
        }),
      ).toEqual({ type: "enter_tap_toggle" });
    });

    it("tap: release while recording without mode yet — quick tap locks toggle", () => {
      expect(
        resolveMicPressOut({
          pressDurationMs: 120,
          phase: "recording",
          captureMode: null,
          hasActiveRecording: true,
          micWarmup: false,
          awaitingMicPermission: false,
        }),
      ).toEqual({ type: "enter_tap_toggle" });
    });

    it("tap: release in tap_toggle mode does not stop", () => {
      expect(
        resolveMicPressOut({
          pressDurationMs: 120,
          phase: "recording",
          captureMode: "tap_toggle",
          hasActiveRecording: true,
          micWarmup: false,
          awaitingMicPermission: false,
        }),
      ).toEqual({ type: "noop" });
    });

    it("hold: release while recording in hold mode stops", () => {
      expect(
        resolveMicPressOut({
          pressDurationMs: 1200,
          phase: "recording",
          captureMode: "hold",
          hasActiveRecording: true,
          micWarmup: false,
          awaitingMicPermission: false,
        }),
      ).toEqual({ type: "stop_and_send" });
    });

    it("hold: long release without hold mode stops", () => {
      expect(
        resolveMicPressOut({
          pressDurationMs: 1200,
          phase: "recording",
          captureMode: null,
          hasActiveRecording: true,
          micWarmup: false,
          awaitingMicPermission: false,
        }),
      ).toEqual({ type: "stop_and_send" });
    });

    it("arming: long release still enters tap_toggle (never cancel warmup)", () => {
      expect(
        resolveMicPressOut({
          pressDurationMs: 900,
          phase: "arming",
          captureMode: null,
          hasActiveRecording: false,
          micWarmup: true,
          awaitingMicPermission: false,
        }),
      ).toEqual({ type: "enter_tap_toggle" });
    });

    it("arming: permission dialog pressOut is noop", () => {
      expect(
        resolveMicPressOut({
          pressDurationMs: 400,
          phase: "arming",
          captureMode: null,
          hasActiveRecording: false,
          micWarmup: true,
          awaitingMicPermission: true,
        }),
      ).toEqual({ type: "noop" });
    });
  });

  describe("captureModeWhenRecordingStarts", () => {
    it("finger still down → hold", () => {
      expect(captureModeWhenRecordingStarts(true, null)).toBe("hold");
    });

    it("finger up after quick tap arming → tap_toggle", () => {
      expect(captureModeWhenRecordingStarts(false, "tap_toggle")).toBe("tap_toggle");
      expect(captureModeWhenRecordingStarts(false, null)).toBe("tap_toggle");
    });
  });

  describe("shouldDiscardMicOnAppState", () => {
    const base = {
      awaitingMicPermission: false,
      micWarmup: false,
      ignoreAppStateUntilMs: 0,
      nowMs: 10_000,
    };

    it("keeps session during warmup / permission", () => {
      expect(
        shouldDiscardMicOnAppState({
          ...base,
          nextState: "inactive",
          platform: "android",
          micWarmup: true,
        }),
      ).toBe(false);
      expect(
        shouldDiscardMicOnAppState({
          ...base,
          nextState: "background",
          platform: "ios",
          awaitingMicPermission: true,
        }),
      ).toBe(false);
    });

    it("ignores Android inactive (OEM privacy / audio-focus blip)", () => {
      expect(
        shouldDiscardMicOnAppState({
          ...base,
          nextState: "inactive",
          platform: "android",
        }),
      ).toBe(false);
    });

    it("still discards on Android background after settle", () => {
      expect(
        shouldDiscardMicOnAppState({
          ...base,
          nextState: "background",
          platform: "android",
        }),
      ).toBe(true);
    });

    it("honors settle grace after createAsync", () => {
      expect(
        shouldDiscardMicOnAppState({
          ...base,
          nextState: "background",
          platform: "android",
          ignoreAppStateUntilMs: base.nowMs + MIC_APPSTATE_SETTLE_MS,
        }),
      ).toBe(false);
    });

    it("discards on iOS inactive (phone call / leave)", () => {
      expect(
        shouldDiscardMicOnAppState({
          ...base,
          nextState: "inactive",
          platform: "ios",
        }),
      ).toBe(true);
    });
  });
});
