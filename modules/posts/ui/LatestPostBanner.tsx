import { useFocusEffect } from "@react-navigation/native";
import { router, type Href } from "expo-router";
import { useCallback, useState } from "react";

import { useAuth } from "@/modules/auth";
import { asContentLocale, useTranslate } from "@/modules/i18n";
import {
  fetchLatestUnviewedPostForLocale,
  markPostViewed,
  postAvailableInLocale,
  type PostItem,
} from "@/modules/posts/core/postsClient";
import { VideoCard } from "@/modules/posts/ui/VideoCard";

/**
 * Home card under Opportunity Windows: newest video/recording the user has not
 * opened yet, only if it has an authored title for the active UI locale
 * (same exact-locale rule as the Videos tab — no en/ru fallback).
 */
export function LatestPostBanner() {
  const { locale } = useTranslate();
  const { authUser } = useAuth();
  const userId = authUser?.id ?? null;
  const [post, setPost] = useState<PostItem | null>(null);

  const reload = useCallback(() => {
    let cancelled = false;
    const contentLocale = asContentLocale(locale) ?? "ru";
    void fetchLatestUnviewedPostForLocale(contentLocale, userId).then((item) => {
      if (cancelled) return;
      setPost(item && postAvailableInLocale(item, contentLocale) ? item : null);
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
