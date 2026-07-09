import { useEventListener } from "expo";
import { Image } from "expo-image";
import { VideoView, useVideoPlayer, type VideoPlayer } from "expo-video";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Modal, PanResponder, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppLocale } from "@/modules/i18n";
import type { StoryItem } from "@/modules/stories/core/storiesClient";
import {
  prefetchStoryNeighborhood,
  resolveStoryCaption,
  storyMediaUri,
  storyPrefetchUri,
} from "@/modules/stories/core/storiesClient";
import { isStoryMediaReady, prefetchStoryMediaUri } from "@/modules/stories/core/storyMediaPreload";
import { StoryCaption } from "@/modules/stories/ui/StoryCaption";
import { AppText } from "@/modules/ui/AppText";

const IMAGE_DURATION_MS = 7000;
const SWIPE_TRIGGER_PX = 40;
const VIDEO_TIME_UPDATE_INTERVAL_SEC = 0.1;

type VideoSlot = "primary" | "secondary";

const STORY_VIDEO_BUFFER_OPTIONS = {
  minBufferForPlayback: 0.15,
  preferredForwardBufferDuration: 2,
  prioritizeTimeOverSizeThreshold: true,
  waitsToMinimizeStalling: false,
} as const;

function storyDisplayUri(story: StoryItem | null | undefined): string | null {
  if (!story) return null;
  if (story.kind === "image") return story.imageUrl;
  return story.coverUrl ?? story.thumbnailUrl ?? story.imageUrl ?? story.videoUrl ?? null;
}

function configureStoryVideoPlayer(player: VideoPlayer): void {
  player.loop = false;
  player.muted = false;
  player.timeUpdateEventInterval = VIDEO_TIME_UPDATE_INTERVAL_SEC;
  player.bufferOptions = STORY_VIDEO_BUFFER_OPTIONS;
}

function storyVideoSource(uri: string) {
  return { uri, useCaching: true as const };
}

function nextDirectVideoStory(stories: StoryItem[], startIndex: number): StoryItem | null {
  for (let index = startIndex + 1; index < stories.length; index += 1) {
    const story = stories[index];
    if (story?.kind === "video" && story.videoUrl) return story;
  }
  return null;
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
  const { locale } = useAppLocale();
  const [displayIndex, setDisplayIndex] = useState(initialIndex);
  const [displayReady, setDisplayReady] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [showVideoPoster, setShowVideoPoster] = useState(true);
  const [transitionOverlayUri, setTransitionOverlayUri] = useState<string | null>(null);
  const [activeVideoSlot, setActiveVideoSlot] = useState<VideoSlot>("primary");
  const progress = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<Animated.CompositeAnimation | null>(null);
  const displayIndexRef = useRef(initialIndex);
  const storiesRef = useRef(stories);
  const markedActiveRef = useRef<Set<string>>(new Set());
  const transitionSeqRef = useRef(0);
  const videoLoadSeqRef = useRef(0);
  const activeVideoSlotRef = useRef<VideoSlot>("primary");
  const primaryVideoUriRef = useRef<string | null>(null);
  const secondaryVideoUriRef = useRef<string | null>(null);
  const onViewedRef = useRef(onViewed);
  const onCloseRef = useRef(onClose);
  const onStoryActiveRef = useRef(onStoryActive);
  const goToRef = useRef<(nextIndex: number, completedCurrent: boolean) => void>(() => {});
  const primaryVideoPlayer = useVideoPlayer(null, configureStoryVideoPlayer);
  const secondaryVideoPlayer = useVideoPlayer(null, configureStoryVideoPlayer);

  useEffect(() => {
    storiesRef.current = stories;
  }, [stories]);
  useEffect(() => {
    onViewedRef.current = onViewed;
  }, [onViewed]);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    onStoryActiveRef.current = onStoryActive;
  }, [onStoryActive]);
  useEffect(() => {
    displayIndexRef.current = displayIndex;
  }, [displayIndex]);
  useEffect(() => {
    activeVideoSlotRef.current = activeVideoSlot;
  }, [activeVideoSlot]);

  const displayStory = stories[displayIndex];
  const displayCaption = useMemo(
    () => (displayStory ? resolveStoryCaption(displayStory.caption, locale) : null),
    [displayStory, locale],
  );
  const displayUri = useMemo(() => storyDisplayUri(displayStory), [displayStory]);
  const displayMediaUri = useMemo(() => (displayStory ? storyMediaUri(displayStory) : null), [displayStory]);
  const isDirectVideo = displayStory?.kind === "video" && !!displayStory.videoUrl;
  const activeVideoPlayer = activeVideoSlot === "primary" ? primaryVideoPlayer : secondaryVideoPlayer;

  useEffect(() => {
    if (!visible) {
      setDisplayReady(false);
      setVideoReady(false);
      setVideoProgress(0);
      setShowVideoPoster(true);
      setTransitionOverlayUri(null);
      markedActiveRef.current.clear();
      transitionSeqRef.current += 1;
      videoLoadSeqRef.current += 1;
      primaryVideoPlayer.pause();
      secondaryVideoPlayer.pause();
      return;
    }
    displayIndexRef.current = initialIndex;
    setDisplayIndex(initialIndex);
    setVideoReady(false);
    setVideoProgress(0);
    setShowVideoPoster(true);
    setTransitionOverlayUri(null);
    setDisplayReady(isStoryMediaReady(storyDisplayUri(storiesRef.current[initialIndex])));
  }, [visible, initialIndex, primaryVideoPlayer, secondaryVideoPlayer]);

  useEffect(() => {
    if (!visible) return;
    void prefetchStoryNeighborhood(stories, displayIndex);
  }, [visible, stories, displayIndex]);

  const markStoryActive = useCallback((storyId: string) => {
    if (markedActiveRef.current.has(storyId)) return;
    markedActiveRef.current.add(storyId);
    onStoryActiveRef.current(storyId);
  }, []);

  useEffect(() => {
    if (!visible || !displayStory?.id || !displayReady) return;
    markStoryActive(displayStory.id);
  }, [visible, displayStory?.id, displayReady, markStoryActive]);

  const commitIndex = useCallback(
    (nextIndex: number) => {
      transitionSeqRef.current += 1;
      displayIndexRef.current = nextIndex;
      setDisplayIndex(nextIndex);
      setDisplayReady(isStoryMediaReady(storyDisplayUri(storiesRef.current[nextIndex])));
      setVideoReady(false);
      setVideoProgress(0);
      progress.setValue(0);
    },
    [progress],
  );

  const goTo = useCallback(
    (nextIndex: number, completedCurrent: boolean) => {
      const currentStories = storiesRef.current;
      const currentIndex = displayIndexRef.current;
      const currentStory = currentStories[currentIndex];

      if (nextIndex < 0 || nextIndex === currentIndex) return;
      if (nextIndex >= currentStories.length) {
        if (currentStory) onViewedRef.current(currentStory.id, completedCurrent);
        onCloseRef.current();
        return;
      }

      if (currentStory) onViewedRef.current(currentStory.id, completedCurrent);

      const nextStory = currentStories[nextIndex];
      const nextUri = storyDisplayUri(nextStory);
      const shouldHoldPreviousImage =
        currentStory?.kind === "image" &&
        nextStory?.kind === "video" &&
        !!currentStory.imageUrl;
      if (!nextUri) {
        setTransitionOverlayUri(null);
        commitIndex(nextIndex);
        return;
      }

      const seq = transitionSeqRef.current + 1;
      transitionSeqRef.current = seq;
      const finish = () => {
        if (transitionSeqRef.current !== seq) return;
        setTransitionOverlayUri(shouldHoldPreviousImage ? currentStory.imageUrl : null);
        commitIndex(nextIndex);
      };

      if (isStoryMediaReady(nextUri)) {
        finish();
        return;
      }

      void prefetchStoryMediaUri(storyPrefetchUri(nextStory)).then(() => {
        finish();
      });
    },
    [commitIndex],
  );

  useEffect(() => {
    goToRef.current = goTo;
  }, [goTo]);

  useEffect(() => {
    timerRef.current?.stop();
    setVideoProgress(0);
    if (!visible || !displayStory || !displayReady || isDirectVideo) return;

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: IMAGE_DURATION_MS,
      useNativeDriver: false,
    });
    timerRef.current = animation;
    animation.start(({ finished }) => {
      if (finished) goToRef.current(displayIndexRef.current + 1, true);
    });
    return () => animation.stop();
  }, [visible, displayStory?.id, displayReady, isDirectVideo, progress]);

  useEventListener(primaryVideoPlayer, "timeUpdate", ({ currentTime }) => {
    if (activeVideoSlotRef.current !== "primary") return;
    if (primaryVideoPlayer.duration > 0) {
      setVideoProgress(Math.min(1, currentTime / primaryVideoPlayer.duration));
    }
  });
  useEventListener(secondaryVideoPlayer, "timeUpdate", ({ currentTime }) => {
    if (activeVideoSlotRef.current !== "secondary") return;
    if (secondaryVideoPlayer.duration > 0) {
      setVideoProgress(Math.min(1, currentTime / secondaryVideoPlayer.duration));
    }
  });
  useEventListener(primaryVideoPlayer, "playToEnd", () => {
    if (activeVideoSlotRef.current !== "primary") return;
    goToRef.current(displayIndexRef.current + 1, true);
  });
  useEventListener(secondaryVideoPlayer, "playToEnd", () => {
    if (activeVideoSlotRef.current !== "secondary") return;
    goToRef.current(displayIndexRef.current + 1, true);
  });
  useEventListener(primaryVideoPlayer, "statusChange", ({ status }) => {
    if (activeVideoSlotRef.current !== "primary") return;
    if (status === "readyToPlay") setDisplayReady(true);
  });
  useEventListener(secondaryVideoPlayer, "statusChange", ({ status }) => {
    if (activeVideoSlotRef.current !== "secondary") return;
    if (status === "readyToPlay") setDisplayReady(true);
  });

  const handleClose = useCallback(() => {
    const current = storiesRef.current[displayIndexRef.current];
    if (current) onViewedRef.current(current.id, false);
    onCloseRef.current();
  }, []);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) =>
          Math.abs(gestureState.dx) > 16 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dx <= -SWIPE_TRIGGER_PX) {
            goToRef.current(displayIndexRef.current + 1, false);
            return;
          }
          if (gestureState.dx >= SWIPE_TRIGGER_PX) {
            goToRef.current(displayIndexRef.current - 1, false);
          }
        },
      }),
    [],
  );

  useEffect(() => {
    if (!visible) return;
    if (!isDirectVideo || !displayMediaUri) {
      setVideoReady(false);
      setShowVideoPoster(true);
      setTransitionOverlayUri(null);
      primaryVideoPlayer.pause();
      secondaryVideoPlayer.pause();
      return;
    }

    setVideoReady(false);
    setVideoProgress(0);
    const seq = videoLoadSeqRef.current + 1;
    videoLoadSeqRef.current = seq;

    const matchedSlot: VideoSlot =
      primaryVideoUriRef.current === displayMediaUri
        ? "primary"
        : secondaryVideoUriRef.current === displayMediaUri
          ? "secondary"
          : activeVideoSlotRef.current;
    const matchedPlayer = matchedSlot === "primary" ? primaryVideoPlayer : secondaryVideoPlayer;
    const otherPlayer = matchedSlot === "primary" ? secondaryVideoPlayer : primaryVideoPlayer;
    const matchedUriRef = matchedSlot === "primary" ? primaryVideoUriRef : secondaryVideoUriRef;
    const isHotVideoSwap = matchedUriRef.current === displayMediaUri;

    activeVideoSlotRef.current = matchedSlot;
    setActiveVideoSlot(matchedSlot);
    setShowVideoPoster(!isHotVideoSwap);
    otherPlayer.pause();

    void (async () => {
      if (matchedUriRef.current !== displayMediaUri) {
        await matchedPlayer.replaceAsync(storyVideoSource(displayMediaUri));
        matchedUriRef.current = displayMediaUri;
      }
      if (videoLoadSeqRef.current !== seq) return;
      matchedPlayer.currentTime = 0;
      matchedPlayer.play();
    })().catch(() => {
      if (videoLoadSeqRef.current !== seq) return;
      setVideoReady(false);
    });
  }, [visible, isDirectVideo, displayMediaUri, primaryVideoPlayer, secondaryVideoPlayer]);

  useEffect(() => {
    if (!visible) return;
    const nextVideo = nextDirectVideoStory(stories, displayIndex);
    const nextUri = nextVideo?.videoUrl ?? null;
    if (!nextUri) return;

    const preloadSlot: VideoSlot = activeVideoSlotRef.current === "primary" ? "secondary" : "primary";
    const preloadPlayer = preloadSlot === "primary" ? primaryVideoPlayer : secondaryVideoPlayer;
    const preloadUriRef = preloadSlot === "primary" ? primaryVideoUriRef : secondaryVideoUriRef;
    if (preloadUriRef.current === nextUri) return;

    void preloadPlayer
      .replaceAsync(storyVideoSource(nextUri))
      .then(() => {
        preloadUriRef.current = nextUri;
        preloadPlayer.pause();
        preloadPlayer.currentTime = 0;
      })
      .catch(() => {});
  }, [visible, stories, displayIndex, primaryVideoPlayer, secondaryVideoPlayer]);

  if (!displayStory || !displayUri) return null;

  const showVideo = isDirectVideo && !!displayMediaUri;

  return (
    <Modal
      visible={visible}
      animationType="none"
      presentationStyle="fullScreen"
      onRequestClose={handleClose}
    >
      <View style={styles.root} {...panResponder.panHandlers}>
        <Image
          source={{ uri: displayUri }}
          style={[
            StyleSheet.absoluteFill,
            showVideo && videoReady && !showVideoPoster ? styles.hiddenVisual : null,
          ]}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={0}
          onLoadEnd={() => {
            setDisplayReady(true);
          }}
        />

        {showVideo ? (
          <VideoView
            player={activeVideoPlayer}
            style={[StyleSheet.absoluteFill, !videoReady ? styles.videoHidden : null]}
            contentFit="cover"
            nativeControls={false}
            fullscreenOptions={{ enable: false }}
            allowsPictureInPicture={false}
            onFirstFrameRender={() => {
              setVideoReady(true);
              setShowVideoPoster(false);
              setTransitionOverlayUri(null);
              setDisplayReady(true);
            }}
            useExoShutter={false}
          />
        ) : null}

        {transitionOverlayUri ? (
          <Image
            source={{ uri: transitionOverlayUri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={0}
          />
        ) : null}

        <View style={[styles.progressRow, { top: insets.top + 6 }]}>
          {stories.map((item, itemIndex) => (
            <View key={item.id} style={styles.progressTrack}>
              {itemIndex < displayIndex ? <View style={styles.progressDone} /> : null}
              {itemIndex === displayIndex ? (
                showVideo ? (
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
          style={[styles.close, { top: insets.top + 16 }]}
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
            onPress={() => goToRef.current(displayIndexRef.current - 1, false)}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={nextLabel}
            style={styles.tapForward}
            onPress={() => goToRef.current(displayIndexRef.current + 1, false)}
          />
        </View>

        {displayReady && displayCaption ? (
          <View style={[styles.captionWrap, { paddingBottom: insets.bottom + 24 }]}>
            <StoryCaption text={displayCaption} />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: "#111",
    flex: 1,
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
    backgroundColor: "rgba(255,255,255,0.38)",
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
  videoHidden: {
    opacity: 0,
  },
  hiddenVisual: {
    opacity: 0,
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
    textShadowColor: "rgba(0,0,0,0.7)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
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
    bottom: 0,
    left: 0,
    paddingHorizontal: 18,
    paddingTop: 14,
    position: "absolute",
    right: 0,
  },
});
