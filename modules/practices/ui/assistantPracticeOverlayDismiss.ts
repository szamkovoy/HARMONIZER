const ASSISTANT_OVERLAY_DISMISS_TIMEOUT_MS = 2500;

let pendingOverlayDismiss: (() => void) | null = null;
let dismissTimeout: ReturnType<typeof setTimeout> | null = null;

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
  callback?.();
}

/**
 * Assistant practice launches push a root-stack screen while a full-screen RN
 * Modal still covers the tab navigator. Close that overlay only after the
 * practice route has mounted (or a short timeout), otherwise Home/Day flashes
 * for a frame before the practice screen paints.
 */
export function scheduleAssistantOverlayDismiss(callback: () => void): void {
  clearDismissTimeout();
  pendingOverlayDismiss = callback;
  dismissTimeout = setTimeout(flushAssistantOverlayDismiss, ASSISTANT_OVERLAY_DISMISS_TIMEOUT_MS);
}

export function signalAssistantPracticeScreenMounted(): void {
  flushAssistantOverlayDismiss();
}

export function clearAssistantOverlayDismiss(): void {
  clearDismissTimeout();
  pendingOverlayDismiss = null;
}
