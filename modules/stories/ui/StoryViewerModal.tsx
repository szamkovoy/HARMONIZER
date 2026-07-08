import { ResizeMode, Video, type AVPlaybackStatus } from "expo-av";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Image, Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { StoryItem } from "@/modules/stories/core/storiesClient";
import { AppText } from "@/modules/ui/AppText";

const IMAGE_DURATION_MS = 5000;

/**
 * Полноэкранный Instagram-подобный вьюер: сегменты прогресса сверху,
 * тап справа/слева — следующая/предыдущая, авто-переход по таймеру (фото)
 * или по окончании видео. Легаси video_cover показывается как статичная обложка.
 */
export function StoryViewerModal({
  stories,
  initialIndex,
  visible,
  closeLabel,
  onClose,
  onViewed,
}: {
  stories: StoryItem[];
  initialIndex: number;
  visible: boolean;
  closeLabel: string;
  onClose: () => void;
  onViewed: (storyId: string, completed: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(initialIndex);
  const [videoProgress, setVideoProgress] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<Animated.CompositeAnimation | null>(null);
  const story = stories[index];
  const isDirectVideo = story?.kind === "video" && !!story.videoUrl;

  useEffect(() => {
    if (visible) setIndex(initialIndex);
  }, [visible, initialIndex]);

  const goTo = useCallback(
    (nextIndex: number, completedCurrent: boolean) => {
      const current = stories[index];
      if (current) onViewed(current.id, completedCurrent);
      if (nextIndex < 0) {
        setIndex(0);
        return;
      }
      if (nextIndex >= stories.length) {
        onClose();
        return;
      }
      setIndex(nextIndex);
    },
    [index, stories, onViewed, onClose],
  );

  // Таймер для фото и статичных обложек; видео ведёт прогресс само.
  useEffect(() => {
    timerRef.current?.stop();
    progress.setValue(0);
    setVideoProgress(0);
    if (!visible || !story || isDirectVideo) return;
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: IMAGE_DURATION_MS,
      useNativeDriver: false,
    });
    timerRef.current = animation;
    animation.start(({ finished }) => {
      if (finished) goTo(index + 1, true);
    });
    return () => animation.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- перезапуск строго по смене слайда/видимости
  }, [visible, index, story?.id, isDirectVideo]);

  const onVideoStatus = useCallback(
    (status: AVPlaybackStatus) => {
      if (!status.isLoaded) return;
      if (status.durationMillis) {
        setVideoProgress(Math.min(1, (status.positionMillis ?? 0) / status.durationMillis));
      }
      if (status.didJustFinish) goTo(index + 1, true);
    },
    [goTo, index],
  );

  const handleClose = useCallback(() => {
    const current = stories[index];
    if (current) onViewed(current.id, false);
    onClose();
  }, [index, stories, onViewed, onClose]);

  const mediaSourceUri = useMemo(() => {
    if (!story) return null;
    if (story.kind === "image") return story.imageUrl;
    if (isDirectVideo) return story.videoUrl;
    return story.coverUrl ?? story.imageUrl;
  }, [story, isDirectVideo]);

  if (!story || !mediaSourceUri) return null;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={handleClose}
    >
      <View style={styles.root}>
        {isDirectVideo ? (
          <Video
            source={{ uri: mediaSourceUri }}
            style={StyleSheet.absoluteFill}
            resizeMode={ResizeMode.COVER}
            shouldPlay={visible}
            onPlaybackStatusUpdate={onVideoStatus}
          />
        ) : (
          <Image source={{ uri: mediaSourceUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        )}

        {/* Затемнение под прогресс и подпись */}
        <View style={[styles.topShade, { height: insets.top + 56 }]} />

        <View style={[styles.progressRow, { top: insets.top + 8 }]}>
          {stories.map((item, itemIndex) => (
            <View key={item.id} style={styles.progressTrack}>
              {itemIndex < index ? <View style={styles.progressDone} /> : null}
              {itemIndex === index ? (
                isDirectVideo ? (
                  <View style={[styles.progressDone, { width: `${videoProgress * 100}%` }]} />
                ) : (
                  <Animated.View
                    style={[
                      styles.progressDone,
                      {
                        width: progress.interpolate({
                          inputRange: [0, 1],
                          outputRange: ["0%", "100%"],
                        }),
                      },
                    ]}
                  />
                )
              ) : null}
            </View>
          ))}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          onPress={handleClose}
          style={[styles.close, { top: insets.top + 20 }]}
          hitSlop={12}
        >
          <AppText variant="buttonLabel" style={styles.closeText}>
            ✕
          </AppText>
        </Pressable>

        {/* Зоны навигации: левая треть — назад, остальное — вперёд */}
        <View style={styles.tapRow} pointerEvents="box-none">
          <Pressable style={styles.tapBack} onPress={() => goTo(index - 1, false)} />
          <Pressable style={styles.tapForward} onPress={() => goTo(index + 1, false)} />
        </View>

        {story.captionText ? (
          <View style={[styles.captionWrap, { paddingBottom: insets.bottom + 24 }]}>
            <AppText variant="dialogBody" style={styles.captionText}>
              {story.captionText}
            </AppText>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: "#000",
    flex: 1,
  },
  topShade: {
    backgroundColor: "rgba(0,0,0,0.35)",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  progressRow: {
    flexDirection: "row",
    gap: 4,
    left: 12,
    position: "absolute",
    right: 12,
    zIndex: 2,
  },
  progressTrack: {
    backgroundColor: "rgba(255,255,255,0.3)",
    borderRadius: 2,
    flex: 1,
    height: 3,
    overflow: "hidden",
  },
  progressDone: {
    backgroundColor: "#fff",
    borderRadius: 2,
    height: 3,
    width: "100%",
  },
  close: {
    padding: 6,
    position: "absolute",
    right: 14,
    zIndex: 3,
  },
  closeText: {
    color: "#fff",
    fontSize: 20,
  },
  tapRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
  },
  tapBack: {
    flex: 1,
  },
  tapForward: {
    flex: 2,
  },
  captionWrap: {
    backgroundColor: "rgba(0,0,0,0.45)",
    bottom: 0,
    left: 0,
    paddingHorizontal: 18,
    paddingTop: 14,
    position: "absolute",
    right: 0,
  },
  captionText: {
    color: "#fff",
  },
});
