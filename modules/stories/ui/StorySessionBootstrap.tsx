import { useEffect } from "react";

import { useAuth } from "@/modules/auth";
import { primeStoryFeedSession } from "@/modules/stories/core/storiesClient";

export function StorySessionBootstrap() {
  const { authUser } = useAuth();

  useEffect(() => {
    if (!authUser?.id) return;
    void primeStoryFeedSession(authUser.id);
  }, [authUser?.id]);

  return null;
}
