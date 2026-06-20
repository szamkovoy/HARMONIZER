import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearAssistantOverlayDismiss,
  scheduleAssistantOverlayDismiss,
  signalAssistantPracticeScreenMounted,
} from "./assistantPracticeOverlayDismiss";

describe("assistantPracticeOverlayDismiss", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearAssistantOverlayDismiss();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearAssistantOverlayDismiss();
  });

  it("runs the dismiss callback when the practice screen signals ready", () => {
    const callback = vi.fn();
    scheduleAssistantOverlayDismiss(callback);

    signalAssistantPracticeScreenMounted();

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("falls back to the dismiss callback after the timeout", () => {
    const callback = vi.fn();
    scheduleAssistantOverlayDismiss(callback);

    vi.advanceTimersByTime(2500);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("replaces a pending dismiss callback when rescheduled", () => {
    const first = vi.fn();
    const second = vi.fn();
    scheduleAssistantOverlayDismiss(first);
    scheduleAssistantOverlayDismiss(second);

    signalAssistantPracticeScreenMounted();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
