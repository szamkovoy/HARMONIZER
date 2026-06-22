const ASSISTANT_OVERLAY_DISMISS_TIMEOUT_MS = 2500;
/** Keep the dialog visible until navigation + first paint can finish. */
const ASSISTANT_OVERLAY_DISMISS_MIN_DELAY_MS = 200;

let pendingOverlayDismiss: (() => void) | null = null;
let dismissTimeout: ReturnType<typeof setTimeout> | null = null;
let dismissScheduledAt = 0;
let practiceScreenReady = false;

function clearDismissTimeout(): void {
  if (dismissTimeout) {
    clearTimeout(dismissTimeout);
    dismissTimeout = null;
  }
}

function flushAssistantOverlayDismiss(): void {
  clearDismissTimeout();
  const callback = pendingOverlayDismiss;
  pendingOverlayDismiss = null;
  dismissScheduledAt = 0;
  practiceScreenReady = false;
  callback?.();
}

function maybeFlushAssistantOverlayDismiss(): void {
  if (!pendingOverlayDismiss) return;
  if (!practiceScreenReady) return;
  const elapsed = Date.now() - dismissScheduledAt;
  const remaining = ASSISTANT_OVERLAY_DISMISS_MIN_DELAY_MS - elapsed;
  if (remaining > 0) {
    clearDismissTimeout();
    dismissTimeout = setTimeout(flushAssistantOverlayDismiss, remaining);
    return;
  }
  flushAssistantOverlayDismiss();
}

/**
 * Assistant practice launches push a root-stack screen while a full-screen RN
 * Modal still covers the tab navigator. Close that overlay only after the
 * practice route has mounted and a short minimum delay has elapsed, otherwise
 * Home/Day flashes for a frame before the practice screen paints.
 */
export function scheduleAssistantOverlayDismiss(callback: () => void): void {
  clearDismissTimeout();
  pendingOverlayDismiss = callback;
  dismissScheduledAt = Date.now();
  practiceScreenReady = false;
  dismissTimeout = setTimeout(flushAssistantOverlayDismiss, ASSISTANT_OVERLAY_DISMISS_TIMEOUT_MS);
}

export function signalAssistantPracticeScreenMounted(): void {
  practiceScreenReady = true;
  maybeFlushAssistantOverlayDismiss();
}

export function clearAssistantOverlayDismiss(): void {
  clearDismissTimeout();
  pendingOverlayDismiss = null;
  dismissScheduledAt = 0;
  practiceScreenReady = false;
}
