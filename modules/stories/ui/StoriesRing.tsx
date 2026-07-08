import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Image, Pressable, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { useAuth } from "@/modules/auth";
import { useTranslate } from "@/modules/i18n";
import {
  fetchStoryFeed,
  getSessionStoryAvatarThumb,
  markStoryViewed,
  type StoryItem,
} from "@/modules/stories/core/storiesClient";
import { StoryViewerModal } from "@/modules/stories/ui/StoryViewerModal";
import { useTheme } from "@/modules/ui/theme";

const RING_SIZE = 58;
const INNER_SIZE = 50;
const STROKE_WIDTH = 3;
const SVG_SIZE = 58;
const RADIUS = 27;
const CENTER = SVG_SIZE / 2;
const START_ANGLE = -90;
const SEGMENT_GAP_DEG = 8;
const REVEAL_DURATION_MS = 850;

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
  return latest?.thumbnailUrl ?? latest?.coverUrl ?? latest?.imageUrl ?? null;
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
  const reveal = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const sub = reveal.addListener(({ value }) => setRevealProgress(value));
    return () => reveal.removeListener(sub);
  }, [reveal]);

  const reload = useCallback(() => {
    reveal.stopAnimation();
    reveal.setValue(0);
    Animated.timing(reveal, {
      toValue: 1,
      duration: REVEAL_DURATION_MS,
      useNativeDriver: false,
    }).start();

    if (!userId) {
      setStories([]);
      return undefined;
    }
    let cancelled = false;
    void fetchStoryFeed(userId).then((items) => {
      if (!cancelled) setStories(items);
    });
    return () => {
      cancelled = true;
    };
  }, [reveal, userId]);

  useFocusEffect(reload);

  const onViewed = useCallback(
    (storyId: string, completed: boolean) => {
      setStories((prev) => prev.map((story) => (story.id === storyId ? { ...story, isViewed: true } : story)));
      if (userId) void markStoryViewed(userId, storyId, completed);
    },
    [userId],
  );

  const firstUnviewedIndex = useMemo(() => stories.findIndex((story) => !story.isViewed), [stories]);
  const thumbUri = userId ? avatarThumb(stories, getSessionStoryAvatarThumb(userId)) : null;
  const segments = ringSegments(stories.length);
  const revealEndAngle = START_ANGLE + revealProgress * 360;

  if (!stories.length) {
    return (
      <View style={styles.fallbackRing}>
        <BrandAvatar />
      </View>
    );
  }

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={firstUnviewedIndex >= 0 ? t("stories.ring.unseenA11y") : t("stories.ring.seenA11y")}
        onPress={() => setViewerIndex(firstUnviewedIndex >= 0 ? firstUnviewedIndex : 0)}
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
                stroke={stories[index]?.isViewed ? theme.colors.surfaceBorder : "#9B5BEB"}
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
        onClose={() => setViewerIndex(null)}
        onViewed={onViewed}
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
  fallbackRing: {
    alignItems: "center",
    borderColor: "#9B5BEB",
    borderRadius: 999,
    borderWidth: 2,
    height: RING_SIZE,
    justifyContent: "center",
    width: RING_SIZE,
  },
});
