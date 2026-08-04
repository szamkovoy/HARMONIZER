/**
 * Keep the device screen awake for the lifetime of this component.
 *
 * Uses `useKeepAwake` (tag-safe under React 18 Strict Mode). Re-activates on
 * AppState → active because iOS may clear the idle-timer disable after background.
 *
 * Mount only while the practice is running; unmount to release.
 */
import { useEffect } from "react";
import { AppState } from "react-native";
import { activateKeepAwakeAsync, useKeepAwake } from "expo-keep-awake";

export function PracticeKeepAwake({ tag }: { tag: string }) {
  useKeepAwake(tag);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void activateKeepAwakeAsync(tag).catch(() => {
          /* best-effort; useKeepAwake already holds the tag */
        });
      }
    });
    return () => sub.remove();
  }, [tag]);

  return null;
}
