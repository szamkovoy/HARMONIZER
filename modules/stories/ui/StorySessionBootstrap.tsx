import { useEffect } from "react";
import { AppState } from "react-native";

import { useAuth } from "@/modules/auth";
import {
  FEED_POLL_INTERVAL_MS,
  primeStoryFeedSession,
  refreshStoryFeedInBackground,
} from "@/modules/stories/core/storiesClient";

export function StorySessionBootstrap() {
  const { authUser } = useAuth();
  const userId = authUser?.id ?? null;

  useEffect(() => {
    if (!userId) return;

    void primeStoryFeedSession(userId);

    const refresh = () => {
      void refreshStoryFeedInBackground(userId);
    };

    const intervalId = setInterval(refresh, FEED_POLL_INTERVAL_MS);
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });

    return () => {
      clearInterval(intervalId);
      appStateSub.remove();
    };
  }, [userId]);

  return null;
}
