import { useEffect } from "react";
import { AppState } from "react-native";

import { useAuth } from "@/modules/auth";
import {
  primeStoryFeedSession,
  refreshStoryFeedInBackground,
  storyFeedPollDelay,
} from "@/modules/stories/core/storiesClient";

export function StorySessionBootstrap() {
  const { authUser } = useAuth();
  const userId = authUser?.id ?? null;

  useEffect(() => {
    if (!userId) return;

    void primeStoryFeedSession(userId);

    // Adaptive cadence: 20 s right after launch / foreground, then 90 s
    // (`storyFeedPollDelay`). Timer is armed only while the app is active —
    // Android keeps JS timers running in background, which used to poll for nothing.
    let foregroundAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const schedule = () => {
      clear();
      if (cancelled || AppState.currentState !== "active") return;
      timer = setTimeout(() => {
        void refreshStoryFeedInBackground(userId).finally(schedule);
      }, storyFeedPollDelay(Date.now() - foregroundAt));
    };

    schedule();
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        foregroundAt = Date.now();
        void refreshStoryFeedInBackground(userId);
        schedule();
      } else {
        clear();
      }
    });

    return () => {
      cancelled = true;
      clear();
      appStateSub.remove();
    };
  }, [userId]);

  return null;
}
