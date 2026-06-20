import { useEffect } from "react";
import { InteractionManager } from "react-native";

import { signalAssistantPracticeScreenMounted } from "./assistantPracticeOverlayDismiss";

export function useAssistantPracticeOverlayDismiss(launchSource: string | undefined): void {
  useEffect(() => {
    if ((launchSource ?? "").trim().toLowerCase() !== "assistant") return;

    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!cancelled) signalAssistantPracticeScreenMounted();
        });
      });
    });

    return () => {
      cancelled = true;
      task.cancel?.();
    };
  }, [launchSource]);
}
