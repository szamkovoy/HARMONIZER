/**
 * Hide an RN Modal and wait until the native dismiss has finished before
 * presenting SFSafari / Custom Tabs. One rAF is not enough: iOS Modal fade
 * is ~300ms, and presenting during that window wedges expo-web-browser.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

const HIDE_SAFETY_MS = Platform.OS === "ios" ? 500 : 250;

export function useModalDismissForBrowser() {
  const [hiding, setHiding] = useState(false);
  const resolveRef = useRef<(() => void) | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finishWait = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.();
  }, []);

  useEffect(() => () => finishWait(), [finishWait]);

  const hideAndWait = useCallback(() => {
    return new Promise<void>((resolve) => {
      finishWait();
      resolveRef.current = resolve;
      setHiding(true);
      timeoutRef.current = setTimeout(finishWait, HIDE_SAFETY_MS);
    });
  }, [finishWait]);

  const resetHiding = useCallback(() => {
    finishWait();
    setHiding(false);
  }, [finishWait]);

  return { hiding, hideAndWait, onDismiss: finishWait, resetHiding };
}
