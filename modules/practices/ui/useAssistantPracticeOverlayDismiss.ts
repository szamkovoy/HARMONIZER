import { useCallback } from "react";
import { InteractionManager } from "react-native";
import { useFocusEffect } from "@react-navigation/native";

import { signalAssistantPracticeScreenMounted } from "./assistantPracticeOverlayDismiss";

export function useAssistantPracticeOverlayDismiss(launchSource: string | undefined): void {
  useFocusEffect(
    useCallback(() => {
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
    }, [launchSource]),
  );
}
