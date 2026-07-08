import { ResizeMode, Video, type AVPlaybackStatus } from "expo-av";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Image, Modal, PanResponder, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { StoryItem } from "@/modules/stories/core/storiesClient";
import { storyMediaUri, storyPrefetchUri } from "@/modules/stories/core/storiesClient";
import { isStoryMediaPrefetched, prefetchStoryMediaUri } from "@/modules/stories/core/storyMediaPreload";
import { StoryCaption } from "@/modules/stories/ui/StoryCaption";
import { AppText } from "@/modules/ui/AppText";

const IMAGE_DURATION_MS = 7000;
const SWIPE_TRIGGER_PX = 40;
const STORY_TRANSITION_MS = 140;

function storyBackdropUri(story: StoryItem | null | undefined): string | null {
  if (!story) return null;
  return story.kind === "video"
    ? story.coverUrl ?? story.thumbnailUrl ?? story.imageUrl ?? story.videoUrl ?? null
    : storyMediaUri(story);
}

export function StoryViewerModal({
  stories,
  initialIndex,
  visible,
  closeLabel,
  previousLabel,
  nextLabel,
  onClose,
  onViewed,
  onStoryActive,
}: {
  stories: StoryItem[];
  initialIndex: number;
  visible: boolean;
  closeLabel: string;
  previousLabel?: string;
  nextLabel?: string;
  onClose: () => void;
  onViewed: (storyId: string, completed: boolean) => void;
  onStoryActive: (storyId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [targetIndex, setTargetIndex] = useState(initialIndex);
  const [displayIndex, setDisplayIndex] = useState(initialIndex);
  const [activeVisualReady, setActiveVisualReady] = useState(false);
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);
  const [pendingVisualReady, setPendingVisualReady] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;
  const transitionOpacity = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<Animated.CompositeAnimation | null>(null);
  const displayIndexRef = useRef(initialIndex);
  const targetIndexRef = useRef(initialIndex);
  const pendingIndexRef = useRef<number | null>(null);
  const transitionRunningRef = useRef(false);
  const markedActiveRef = useRef<Set<string>>(new Set());
  const loadedBackdropUrisRef = useRef<Set<string>>(new Set());
  const storiesRef = useRef(stories);

  const displayStory = stories[displayIndex];
  const isDirectVideo = displayStory?.kind === "video" && !!displayStory.videoUrl;
  const displayMediaUri = useMemo(
    () => (displayStory ? storyMediaUri(displayStory) : null),
    [displayStory],
  );
  const displayBackdropUri = useMemo(() => storyBackdropUri(displayStory), [displayStory]);
  const pendingStory = pendingIndex !== null ? stories[pendingIndex] : null;
  const pendingBackdropUri = useMemo(() => storyBackdropUri(pendingStory), [pendingStory]);

  useEffect(() => {
    displayIndexRef.current = displayIndex;
  }, [displayIndex]);

  useEffect(() => {
    storiesRef.current = stories;
  }, [stories]);

  useEffect(() => {
    targetIndexRef.current = targetIndex;
  }, [targetIndex]);

  useEffect(() => {
    if (!visible) {
      setActiveVisualReady(false);
      setPendingIndex(null);
      pendingIndexRef.current = null;
      setPendingVisualReady(false);
      transitionOpacity.setValue(0);
      transitionRunningRef.current = false;
      setVideoReady(false);
      markedActiveRef.current.clear();
      loadedBackdropUrisRef.current.clear();
      return;
    }

    targetIndexRef.current = initialIndex;
    displayIndexRef.current = initialIndex;
    setTargetIndex(initialIndex);
    setDisplayIndex(initialIndex);
    setPendingIndex(null);
    pendingIndexRef.current = null;
    setPendingVisualReady(false);
    transitionOpacity.setValue(0);
    transitionRunningRef.current = false;
    setActiveVisualReady(false);
    setVideoReady(false);
  }, [visible, initialIndex, transitionOpacity]);

  useEffect(() => {
    if (!visible || !activeVisualReady) return;
    const nextStory = stories[displayIndex + 1];
    if (nextStory) void prefetchStoryMediaUri(storyPrefetchUri(nextStory));
  }, [visible, activeVisualReady, displayIndex, stories]);

  const markStoryActive = useCallback(
    (storyId: string) => {
      if (markedActiveRef.current.has(storyId)) return;
      markedActiveRef.current.add(storyId);
      onStoryActive(storyId);
    },
    [onStoryActive],
  );

  useEffect(() => {
    if (!visible || !activeVisualReady || !displayStory) return;
    markStoryActive(displayStory.id);
  }, [visible, activeVisualReady, displayStory, markStoryActive]);

  const commitDisplayIndex = useCallback(
    (nextIndex: number, options?: { keepVisualReady?: boolean }) => {
      displayIndexRef.current = nextIndex;
      setDisplayIndex(nextIndex);
      setActiveVisualReady(options?.keepVisualReady === true);
      setVideoReady(false);
    },
    [],
  );

  useEffect(() => {
    if (pendingIndex === null || !pendingVisualReady || transitionRunningRef.current) return;
    transitionRunningRef.current = true;
    const animation = Animated.timing(transitionOpacity, {
      toValue: 1,
      duration: STORY_TRANSITION_MS,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      transitionRunningRef.current = false;
      if (!finished) return;
      const nextIndex = pendingIndexRef.current;
      if (nextIndex == null) return;
      commitDisplayIndex(nextIndex);
    });
    return () => animation.stop();
  }, [pendingIndex, pendingVisualReady, commitDisplayIndex, transitionOpacity]);

  const goTo = useCallback(
    (nextIndex: number, completedCurrent: boolean) => {
      const currentStories = storiesRef.current;
      const current = currentStories[displayIndexRef.current];
      if (current) onViewed(current.id, completedCurrent);

      if (nextIndex < 0) {
        targetIndexRef.current = 0;
        setTargetIndex(0);
        return;
      }
      if (nextIndex >= currentStories.length) {
        onClose();
        return;
      }

      targetIndexRef.current = nextIndex;
      setTargetIndex(nextIndex);
      if (nextIndex === displayIndexRef.current) return;

      const nextStory = currentStories[nextIndex];
      const nextUri = nextStory ? storyPrefetchUri(nextStory) : null;
      if (!nextUri) {
        commitDisplayIndex(nextIndex);
        return;
      }
      const nextBackdropUri = storyBackdropUri(nextStory);
      const isWarmTransition =
        isStoryMediaPrefetched(nextUri) ||
        (!!nextBackdropUri && loadedBackdropUrisRef.current.has(nextBackdropUri));
      if (isWarmTransition) {
        pendingIndexRef.current = nextIndex;
        setPendingIndex(nextIndex);
        setPendingVisualReady(true);
        transitionOpacity.stopAnimation();
        transitionOpacity.setValue(1);
        commitDisplayIndex(nextIndex, { keepVisualReady: true });
        return;
      }
      pendingIndexRef.current = nextIndex;
      setPendingIndex(nextIndex);
      setPendingVisualReady(false);
      transitionOpacity.stopAnimation();
      transitionOpacity.setValue(0);
      if (!isStoryMediaPrefetched(nextUri)) {
        void prefetchStoryMediaUri(nextUri);
      }
    },
    [onViewed, onClose, transitionOpacity, commitDisplayIndex],
  );

  useEffect(() => {
    timerRef.current?.stop();
    progress.setValue(0);
    setVideoProgress(0);
    if (!visible || !activeVisualReady || pendingIndex !== null || !displayStory || isDirectVideo) return;

    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: IMAGE_DURATION_MS,
      useNativeDriver: false,
    });
    timerRef.current = animation;
    animation.start(({ finished }) => {
      if (finished) goTo(displayIndexRef.current + 1, true);
    });
    return () => animation.stop();
  }, [visible, activeVisualReady, pendingIndex, displayIndex, displayStory?.id, isDirectVideo, goTo, progress]);

  const onVideoStatus = useCallback(
    (status: AVPlaybackStatus) => {
      if (!status.isLoaded) return;
      setVideoReady(true);
      if (status.durationMillis) {
        setVideoProgress(Math.min(1, (status.positionMillis ?? 0) / status.durationMillis));
      }
      if (status.didJustFinish) goTo(displayIndexRef.current + 1, true);
    },
    [goTo],
  );

  const handleClose = useCallback(() => {
    const current = storiesRef.current[displayIndexRef.current];
    if (current) onViewed(current.id, false);
    onClose();
  }, [onViewed, onClose]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) =>
          Math.abs(gestureState.dx) > 16 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dx <= -SWIPE_TRIGGER_PX) {
            goTo(targetIndexRef.current + 1, false);
            return;
          }
          if (gestureState.dx >= SWIPE_TRIGGER_PX) {
            goTo(targetIndexRef.current - 1, false);
          }
        },
      }),
    [goTo],
  );

  if (!displayStory || !displayMediaUri) return null;

  const showSpinner = !activeVisualReady && !pendingVisualReady;
  const showImage = !!displayBackdropUri;
  const showVideo = activeVisualReady && isDirectVideo;

  return (
    <Modal
      visible={visible}
      animationType="none"
      presentationStyle="fullScreen"
      transparent
      onRequestClose={handleClose}
    >
      <View
        style={[
          styles.root,
          { backgroundColor: activeVisualReady || pendingVisualReady ? "#000" : "transparent" },
        ]}
        {...panResponder.panHandlers}
      >
        {showImage ? (
          <Image
            source={{ uri: displayBackdropUri! }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            onLoadEnd={() => {
              loadedBackdropUrisRef.current.add(displayBackdropUri!);
              setActiveVisualReady(true);
              if (pendingIndexRef.current === displayIndexRef.current) {
                setPendingIndex(null);
                pendingIndexRef.current = null;
                setPendingVisualReady(false);
                transitionOpacity.setValue(0);
              }
            }}
          />
        ) : null}
        {pendingBackdropUri ? (
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: transitionOpacity }]}>
            <Image
              source={{ uri: pendingBackdropUri }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              onLoadEnd={() => {
                loadedBackdropUrisRef.current.add(pendingBackdropUri);
                if (pendingIndexRef.current === pendingIndex) {
                  setPendingVisualReady(true);
                }
              }}
            />
          </Animated.View>
        ) : null}
        {showVideo ? (
          <Video
            source={{ uri: displayMediaUri }}
            style={StyleSheet.absoluteFill}
            resizeMode={ResizeMode.COVER}
            shouldPlay={visible}
            isMuted={false}
            onPlaybackStatusUpdate={onVideoStatus}
          />
        ) : null}
        {showSpinner ? (
          <View style={styles.loading} pointerEvents="none">
            <ActivityIndicator color="#fff" size="large" />
          </View>
        ) : null}

        {(activeVisualReady || pendingVisualReady) ? <View style={[styles.topShade, { height: insets.top + 56 }]} /> : null}

        {activeVisualReady ? (
          <View style={[styles.progressRow, { top: insets.top + 8 }]}>
          {stories.map((item, itemIndex) => (
            <View key={item.id} style={styles.progressTrack}>
              {itemIndex < displayIndex ? <View style={styles.progressDone} /> : null}
              {itemIndex === displayIndex ? (
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
        ) : null}

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

        <View style={styles.tapRow} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={previousLabel}
            style={styles.tapBack}
            onPress={() => goTo(targetIndexRef.current - 1, false)}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={nextLabel}
            style={styles.tapForward}
            onPress={() => goTo(targetIndexRef.current + 1, false)}
          />
        </View>

        {activeVisualReady && pendingIndex === null && (showImage || (showVideo && videoReady)) && displayStory.captionText ? (
          <View style={[styles.captionWrap, { paddingBottom: insets.bottom + 24 }]}>
            <StoryCaption text={displayStory.captionText} />
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
  loading: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
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
});
