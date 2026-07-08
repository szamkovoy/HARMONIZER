import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useRef, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { useAuth } from "@/modules/auth";
import { useTranslate } from "@/modules/i18n";
import { fetchUserStories, markStoryViewed, type StoryItem } from "@/modules/stories/core/storiesClient";
import { StoryViewerModal } from "@/modules/stories/ui/StoryViewerModal";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

const RING_SIZE = 64;

/**
 * Горизонтальное «кольцо сторис» на главной. Рендерит null, когда
 * непросмотренных сторис нет — блок не занимает места.
 */
export function StoriesRing() {
  const theme = useTheme();
  const { t } = useTranslate();
  const { authUser } = useAuth();
  const userId = authUser?.id ?? null;

  const [stories, setStories] = useState<StoryItem[]>([]);
  const [viewedIds, setViewedIds] = useState<Set<string>>(new Set());
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const viewerOpenRef = useRef(false);

  const reload = useCallback(() => {
    if (!userId) return;
    let cancelled = false;
    void fetchUserStories(userId).then((items) => {
      if (!cancelled && !viewerOpenRef.current) {
        setStories(items);
        setViewedIds(new Set());
      }
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useFocusEffect(reload);

  const onViewed = useCallback(
    (storyId: string, completed: boolean) => {
      setViewedIds((prev) => (prev.has(storyId) ? prev : new Set(prev).add(storyId)));
      if (userId) void markStoryViewed(userId, storyId, completed);
    },
    [userId],
  );

  if (stories.length === 0) return null;

  const openViewer = (index: number) => {
    viewerOpenRef.current = true;
    setViewerIndex(index);
  };
  const closeViewer = () => {
    viewerOpenRef.current = false;
    setViewerIndex(null);
    // Просмотренные убираем из кольца после закрытия (как их уберёт и RPC).
    setStories((prev) => {
      const rest = prev.filter((story) => !viewedIds.has(story.id));
      return rest.length === prev.length ? prev : rest;
    });
  };

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        accessibilityLabel={t("stories.ring.a11y")}
      >
        {stories.map((story, index) => {
          const viewed = viewedIds.has(story.id);
          const thumbnail = story.kind === "image" ? story.imageUrl : (story.coverUrl ?? story.imageUrl);
          return (
            <Pressable
              key={story.id}
              accessibilityRole="button"
              accessibilityLabel={story.captionText ?? t("stories.ring.itemA11y")}
              onPress={() => openViewer(index)}
              style={({ pressed }) => [
                styles.ring,
                {
                  borderColor: viewed ? theme.colors.surfaceBorder : "#9B5BEB",
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              {thumbnail ? (
                <Image source={{ uri: thumbnail }} style={styles.thumb} resizeMode="cover" />
              ) : (
                <View style={[styles.thumb, styles.videoFallback]}>
                  <AppText variant="buttonLabel" style={styles.playGlyph}>
                    ▶
                  </AppText>
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      <StoryViewerModal
        stories={stories}
        initialIndex={viewerIndex ?? 0}
        visible={viewerIndex !== null}
        closeLabel={t("stories.viewer.close")}
        onClose={closeViewer}
        onViewed={onViewed}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: 12,
    paddingVertical: 2,
  },
  ring: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 2,
    height: RING_SIZE,
    justifyContent: "center",
    width: RING_SIZE,
  },
  thumb: {
    borderRadius: 999,
    height: RING_SIZE - 10,
    width: RING_SIZE - 10,
  },
  videoFallback: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    justifyContent: "center",
  },
  playGlyph: {
    color: "#fff",
    fontSize: 18,
  },
});
