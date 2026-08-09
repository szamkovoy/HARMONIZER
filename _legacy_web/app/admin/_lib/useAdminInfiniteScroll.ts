"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * IntersectionObserver sentinel for admin list infinite scroll.
 * Matches users/posts: rootMargin ~240px, fires while canLoadMore.
 */
export function useAdminInfiniteScroll(
  canLoadMore: boolean,
  onLoadMore: () => void,
): RefObject<HTMLDivElement | null> {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !canLoadMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMoreRef.current();
      },
      { rootMargin: "240px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [canLoadMore]);

  return sentinelRef;
}
