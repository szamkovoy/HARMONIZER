import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Image, Pressable, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { useAuth } from "@/modules/auth";
import { useTranslate } from "@/modules/i18n";
import {
  firstUnviewedStoryIndex,
  getSessionStoryAvatarThumb,
  markStoryViewed,
  prefetchStoryWindow,
  refreshStoryFeedInBackground,
  rememberStoryViewedLocally,
  ensureStoryReadyToOpen,
  subscribeStoryFeed,
  areStoryFeedsEqual,
  type StoryItem,
} from "@/modules/stories/core/storiesClient";
import { StoryViewerModal } from "@/modules/stories/ui/StoryViewerModal";
import { useTheme, type PaletteScheme } from "@/modules/ui/theme";

const RING_SIZE = 58;
const INNER_SIZE = 50;
/** Same stroke on iOS + Android — thin 3px was too faint, especially on Android SVG. */
const STROKE_WIDTH = 3.5;
const SVG_SIZE = 58;
const RADIUS = 27;
const CENTER = SVG_SIZE / 2;
const START_ANGLE = -90;
const SEGMENT_GAP_DEG = 8;
const REVEAL_DURATION_MS = 850;

/**
 * Ring-only colors (shared iOS/Android). Slightly softer than the first Android
 * contrast bump; still stronger than theme `surfaceBorder` for viewed segments.
 * Also used by Home `ChakraFlower` center ring (dark = read stroke).
 */
export function storiesRingStrokes(scheme: PaletteScheme): { unread: string; read: string } {
  if (scheme === "light") {
    return { unread: "#9756E6", read: "rgba(15, 23, 42, 0.30)" };
  }
  return { unread: "#B98AF5", read: "rgba(255, 255, 255, 0.34)" };
}

function polarToPoint(angleDeg: number): { x: number; y: number } {
  const radians = (angleDeg * Math.PI) / 180;
  return {
    x: CENTER + RADIUS * Math.cos(radians),
    y: CENTER + RADIUS * Math.sin(radians),
  };
}

function arcPath(startAngle: number, endAngle: number): string {
  const start = polarToPoint(startAngle);
  const end = polarToPoint(endAngle);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${RADIUS} ${RADIUS} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}

function ringSegments(count: number): Array<{ start: number; end: number }> {
  if (count <= 1) return [{ start: START_ANGLE, end: START_ANGLE + 359.99 }];
  const slot = 360 / count;
  const sweep = Math.max(6, slot - SEGMENT_GAP_DEG);
  return Array.from({ length: count }, (_, index) => {
    const start = START_ANGLE + index * slot + SEGMENT_GAP_DEG / 2;
    return { start, end: start + sweep };
  });
}

function avatarThumb(stories: StoryItem[], sessionThumb: string | null): string | null {
  if (sessionThumb) return sessionThumb;
  const latest = stories[stories.length - 1];
  if (!latest) return null;
  return latest.thumbnailUrl ?? latest.coverUrl ?? latest.imageUrl ?? latest.videoUrl ?? null;
}

function BrandAvatar() {
  return <Image source={require("@/assets/icons/apple-touch-icon.png")} style={styles.thumb} resizeMode="cover" />;
}

export function StoriesRing() {
  const theme = useTheme();
  const { t } = useTranslate();
  const { authUser } = useAuth();
  const userId = authUser?.id ?? null;

  const [stories, setStories] = useState<StoryItem[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [revealProgress, setRevealProgress] = useState(1);
  const [openingViewer, setOpeningViewer] = useState(false);
  const reveal = useRef(new Animated.Value(1)).current;
  const isFocusedRef = useRef(true);
  const revealListenerIdRef = useRef<string | null>(null);
  const storiesRef = useRef<StoryItem[]>([]);

  useEffect(() => {
    storiesRef.current = stories;
  }, [stories]);

  useEffect(() => {
    const listenerId = reveal.addListener(({ value }) => {
      if (isFocusedRef.current) setRevealProgress(value);
    });
    revealListenerIdRef.current = listenerId;
    return () => {
      if (revealListenerIdRef.current) {
        reveal.removeListener(revealListenerIdRef.current);
        revealListenerIdRef.current = null;
      }
    };
  }, [reveal]);

  const reload = useCallback(() => {
    isFocusedRef.current = true;
    reveal.stopAnimation();
    reveal.setValue(0);
    Animated.timing(reveal, {
      toValue: 1,
      duration: REVEAL_DURATION_MS,
      useNativeDriver: false,
    }).start();

    if (!userId) {
      setStories([]);
      return () => {
        isFocusedRef.current = false;
        reveal.stopAnimation();
      };
    }

    let cancelled = false;
    void refreshStoryFeedInBackground(userId).then((items) => {
      if (!cancelled && isFocusedRef.current) setStories(items);
    });

    return () => {
      cancelled = true;
      isFocusedRef.current = false;
      reveal.stopAnimation();
    };
  }, [reveal, userId]);

  useFocusEffect(reload);

  useEffect(() => {
    if (!userId) return;
    return subscribeStoryFeed((items) => {
      setStories((prev) => {
        const viewedIds = new Set(prev.filter((story) => story.isViewed).map((story) => story.id));
        const merged =
          viewedIds.size === 0
            ? items
            : items.map((story) => (viewedIds.has(story.id) ? { ...story, isViewed: true } : story));
        if (areStoryFeedsEqual(prev, merged)) return prev;
        return merged;
      });
    });
  }, [userId]);

  // Предзагрузка окна сторис сразу после получения feed — до клика пользователя.
  useEffect(() => {
    if (stories.length === 0) return;
    const start = firstUnviewedStoryIndex(stories);
    void prefetchStoryWindow(stories, start);
  }, [stories]);

  const markStorySeen = useCallback(
    (storyId: string, completed: boolean) => {
      setStories((prev) => prev.map((story) => (story.id === storyId ? { ...story, isViewed: true } : story)));
      if (userId) {
        rememberStoryViewedLocally(userId, storyId);
        void markStoryViewed(userId, storyId, completed);
      }
    },
    [userId],
  );

  const onStoryActive = useCallback(
    (storyId: string) => {
      markStorySeen(storyId, false);
    },
    [markStorySeen],
  );

  const openViewer = useCallback(
    async (index: number) => {
      const story = stories[index];
      if (!story || openingViewer) return;
      setOpeningViewer(true);
      try {
        await ensureStoryReadyToOpen(story);
        await prefetchStoryWindow(stories, index);
        setViewerIndex(index);
      } finally {
        setOpeningViewer(false);
      }
    },
    [openingViewer, stories],
  );

  const closeViewer = useCallback(() => setViewerIndex(null), []);

  const firstUnviewedIndex = useMemo(() => firstUnviewedStoryIndex(stories), [stories]);
  const thumbUri = userId ? avatarThumb(stories, getSessionStoryAvatarThumb(userId)) : null;
  const segments = ringSegments(stories.length);
  const revealEndAngle = START_ANGLE + revealProgress * 360;
  const ringStrokes = useMemo(() => storiesRingStrokes(theme.scheme), [theme.scheme]);

  if (!stories.length) {
    return (
      <View style={styles.plainAvatar}>
        <BrandAvatar />
      </View>
    );
  }

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={firstUnviewedIndex >= 0 ? t("stories.ring.unseenA11y") : t("stories.ring.seenA11y")}
        disabled={openingViewer}
        onPress={() => void openViewer(firstUnviewedIndex >= 0 ? firstUnviewedIndex : 0)}
        style={({ pressed }) => [styles.pressable, pressed ? styles.pressed : null]}
      >
        <Svg width={SVG_SIZE} height={SVG_SIZE} style={styles.svg}>
          {segments.map((segment, index) => {
            if (revealEndAngle <= segment.start) return null;
            const visibleEnd = Math.min(segment.end, revealEndAngle);
            if (visibleEnd <= segment.start) return null;
            return (
              <Path
                key={stories[index]?.id ?? index}
                d={arcPath(segment.start, visibleEnd)}
                stroke={stories[index]?.isViewed ? ringStrokes.read : ringStrokes.unread}
                strokeLinecap="round"
                strokeWidth={STROKE_WIDTH}
                fill="none"
              />
            );
          })}
        </Svg>
        {thumbUri ? (
          <Image source={{ uri: thumbUri }} style={styles.thumb} resizeMode="cover" />
        ) : (
          <BrandAvatar />
        )}
      </Pressable>

      <StoryViewerModal
        stories={stories}
        initialIndex={viewerIndex ?? 0}
        visible={viewerIndex !== null}
        closeLabel={t("stories.viewer.close")}
        previousLabel={t("stories.viewer.previous")}
        nextLabel={t("stories.viewer.next")}
        onClose={closeViewer}
        onViewed={markStorySeen}
        onStoryActive={onStoryActive}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  pressable: {
    alignItems: "center",
    height: RING_SIZE,
    justifyContent: "center",
    width: RING_SIZE,
  },
  pressed: {
    opacity: 0.82,
  },
  svg: {
    ...StyleSheet.absoluteFillObject,
  },
  thumb: {
    borderRadius: 999,
    height: INNER_SIZE,
    width: INNER_SIZE,
  },
  plainAvatar: {
    alignItems: "center",
    height: RING_SIZE,
    justifyContent: "center",
    width: RING_SIZE,
  },
});
