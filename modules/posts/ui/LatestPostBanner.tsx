import { useFocusEffect } from "@react-navigation/native";
import { router, type Href } from "expo-router";
import { useCallback, useState } from "react";

import { useAuth } from "@/modules/auth";
import { useTranslate } from "@/modules/i18n";
import {
  fetchLatestUnviewedPostForLocale,
  markPostViewed,
  type PostItem,
} from "@/modules/posts/core/postsClient";
import { VideoCard } from "@/modules/posts/ui/VideoCard";

/**
 * Home card for the newest video the user has not opened yet.
 * Dismisses on view (home or Videos tab detail). Placed under Opportunity Windows.
 * Future webinar recordings can reuse the same post card + view-tracking contract.
 */
export function LatestPostBanner() {
  const { locale } = useTranslate();
  const { authUser } = useAuth();
  const userId = authUser?.id ?? null;
  const [post, setPost] = useState<PostItem | null>(null);

  const reload = useCallback(() => {
    let cancelled = false;
    void fetchLatestUnviewedPostForLocale(locale, userId).then((item) => {
      if (!cancelled) setPost(item);
    });
    return () => {
      cancelled = true;
    };
  }, [locale, userId]);

  useFocusEffect(reload);

  if (!post) return null;

  return (
    <VideoCard
      post={post}
      onPress={() => {
        if (userId) void markPostViewed(userId, post.id);
        setPost(null);
        router.push(`/post/${post.id}` as Href);
      }}
    />
  );
}
