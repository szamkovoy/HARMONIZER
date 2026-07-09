import { useEventListener } from "expo";
import { Image } from "expo-image";
import { VideoView, useVideoPlayer, type VideoPlayer } from "expo-video";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Modal, PanResponder, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppLocale } from "@/modules/i18n";
import type { StoryItem } from "@/modules/stories/core/storiesClient";
import {
  ensureStoryReadyToOpen,
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
  const isLocalFile = uri.startsWith("file://");
  return isLocalFile ? { uri } : { uri, useCaching: true as const };
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
  const [videoViewInstanceKey, setVideoViewInstanceKey] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<Animated.CompositeAnimation | null>(null);
  const displayIndexRef = useRef(initialIndex);
  const storiesRef = useRef(stories);
  const markedActiveRef = useRef<Set<string>>(new Set());
  const transitionSeqRef = useRef(0);
  const videoLoadSeqRef = useRef(0);
  const primaryVideoUriRef = useRef<string | null>(null);
  const videoReadyRef = useRef(false);
  const onViewedRef = useRef(onViewed);
  const onCloseRef = useRef(onClose);
  const onStoryActiveRef = useRef(onStoryActive);
  const goToRef = useRef<(nextIndex: number, completedCurrent: boolean) => void>(() => {});

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
    videoReadyRef.current = videoReady;
  }, [videoReady]);

  const displayStory = stories[displayIndex];
  const displayCaption = useMemo(
    () => (displayStory ? resolveStoryCaption(displayStory.caption, locale) : null),
    [displayStory, locale],
  );
  const displayUri = useMemo(() => storyDisplayUri(displayStory), [displayStory]);
  const displayMediaUri = useMemo(() => (displayStory ? storyMediaUri(displayStory) : null), [displayStory]);
  const isDirectVideo = displayStory?.kind === "video" && !!displayStory.videoUrl;
  const primaryPlayerSource = useMemo(
    () => (visible && isDirectVideo && displayMediaUri ? storyVideoSource(displayMediaUri) : null),
    [visible, isDirectVideo, displayMediaUri],
  );
  const primaryVideoPlayer = useVideoPlayer(primaryPlayerSource as never, configureStoryVideoPlayer);

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
      primaryVideoUriRef.current = null;
      try {
        primaryVideoPlayer.pause();
        primaryVideoPlayer.muted = true;
        primaryVideoPlayer.currentTime = 0;
      } catch {
        // ignore
      }
      return;
    }
    displayIndexRef.current = initialIndex;
    setDisplayIndex(initialIndex);
    setVideoReady(false);
    setVideoProgress(0);
    setShowVideoPoster(true);
    setVideoViewInstanceKey((value) => value + 1);
    setTransitionOverlayUri(null);
    setDisplayReady(isStoryMediaReady(storyDisplayUri(storiesRef.current[initialIndex])));
  }, [visible, initialIndex]);

  useEffect(() => {
    if (!visible) return;
    void prefetchStoryNeighborhood(stories, displayIndex);
  }, [visible, stories, displayIndex]);

  useEffect(() => {
    if (!visible) return;
    const nextVideoStories = stories
      .slice(displayIndex + 1, displayIndex + 3)
      .filter((story) => story.kind === "video");
    for (const story of nextVideoStories) {
      void ensureStoryReadyToOpen(story);
    }
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
      setShowVideoPoster(true);
      setVideoViewInstanceKey((value) => value + 1);
      setVideoProgress(0);
      primaryVideoUriRef.current = null;
      progress.setValue(0);
    },
    [progress],
  );

  const goTo = useCallback(
    (nextIndex: number, completedCurrent: boolean) => {
      const seq = transitionSeqRef.current + 1;
      transitionSeqRef.current = seq;

      void (async () => {
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
        const nextPosterUri = storyDisplayUri(nextStory);
        const nextIsVideo = nextStory?.kind === "video" && !!nextStory.videoUrl;

        if (!nextPosterUri) {
          if (transitionSeqRef.current !== seq) return;
          setTransitionOverlayUri(null);
          commitIndex(nextIndex);
          return;
        }

        if (nextIsVideo) {
          await ensureStoryReadyToOpen(nextStory);
          if (transitionSeqRef.current !== seq) return;
        }

        if (!isStoryMediaReady(nextPosterUri)) {
          await prefetchStoryMediaUri(storyPrefetchUri(nextStory));
          if (transitionSeqRef.current !== seq) return;
        }

        setTransitionOverlayUri(nextIsVideo ? nextPosterUri : null);
        setShowVideoPoster(true);
        setVideoReady(false);
        primaryVideoUriRef.current = null;
        videoLoadSeqRef.current += 1;

        try {
          primaryVideoPlayer.pause();
          primaryVideoPlayer.muted = true;
          primaryVideoPlayer.currentTime = 0;
        } catch {
          // ignore
        }

        if (transitionSeqRef.current !== seq) return;
        commitIndex(nextIndex);
      })();
    },
    [commitIndex, primaryVideoPlayer],
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
    if (!displayMediaUri || primaryVideoUriRef.current !== displayMediaUri) return;
    if (currentTime > 0.08 && !videoReadyRef.current) {
      setVideoReady(true);
      setShowVideoPoster(false);
      setTransitionOverlayUri(null);
      setDisplayReady(true);
    }
    if (primaryVideoPlayer.duration > 0) {
      setVideoProgress(Math.min(1, currentTime / primaryVideoPlayer.duration));
    }
  });
  useEventListener(primaryVideoPlayer, "playToEnd", () => {
    if (!displayMediaUri || primaryVideoUriRef.current !== displayMediaUri) return;
    goToRef.current(displayIndexRef.current + 1, true);
  });
  useEventListener(primaryVideoPlayer, "statusChange", ({ status }) => {
    if (!displayMediaUri || primaryVideoUriRef.current !== displayMediaUri) return;
    if (status === "readyToPlay") {
      setDisplayReady(true);
      try {
        primaryVideoPlayer.play();
      } catch {
        // ignore
      }
    }
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
      try {
        primaryVideoPlayer.pause();
        primaryVideoPlayer.muted = true;
        primaryVideoPlayer.currentTime = 0;
      } catch {
        // ignore
      }
      primaryVideoUriRef.current = null;
      return;
    }

    setVideoReady(false);
    setVideoProgress(0);
    setShowVideoPoster(true);
    primaryVideoUriRef.current = displayMediaUri;
    const seq = videoLoadSeqRef.current + 1;
    videoLoadSeqRef.current = seq;

    try {
      primaryVideoPlayer.muted = false;
      primaryVideoPlayer.currentTime = 0;
      if (primaryVideoPlayer.status === "readyToPlay") {
        primaryVideoPlayer.play();
      }
    } catch {
      if (videoLoadSeqRef.current !== seq) return;
      setVideoReady(false);
      setShowVideoPoster(true);
    }
  }, [visible, isDirectVideo, displayMediaUri, primaryVideoPlayer]);

  if (!displayStory || !displayUri) return null;

  const showVideo = isDirectVideo && !!displayMediaUri;
  const revealLiveVideo = showVideo && videoReady && !showVideoPoster;

  return (
    <Modal
      visible={visible}
      animationType="none"
      presentationStyle="fullScreen"
      onRequestClose={handleClose}
    >
      <View style={styles.root} {...panResponder.panHandlers}>
        {/* Base poster / image under video layers */}
        <Image
          source={{ uri: displayUri }}
          style={[StyleSheet.absoluteFill, styles.baseMedia]}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={0}
          onLoadEnd={() => {
            setDisplayReady(true);
          }}
        />

        {showVideo ? (
          <VideoView
            key={`story-video-${videoViewInstanceKey}`}
            player={primaryVideoPlayer}
            style={[StyleSheet.absoluteFill, styles.videoLayer, !revealLiveVideo ? styles.videoHidden : null]}
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

        {/* Poster stays ABOVE native VideoViews until the active slot paints a frame.
            On iOS, VideoView can draw above React zIndex even at opacity 0. */}
        {showVideo && showVideoPoster ? (
          <Image
            source={{ uri: displayUri }}
            style={[StyleSheet.absoluteFill, styles.posterOverlay]}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={0}
          />
        ) : null}

        {transitionOverlayUri ? (
          <Image
            source={{ uri: transitionOverlayUri }}
            style={[StyleSheet.absoluteFill, styles.transitionOverlay]}
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
  baseMedia: {
    zIndex: 0,
  },
  videoLayer: {
    zIndex: 1,
  },
  posterOverlay: {
    zIndex: 2,
  },
  transitionOverlay: {
    zIndex: 3,
  },
  progressRow: {
    flexDirection: "row",
    gap: 4,
    left: 12,
    position: "absolute",
    right: 12,
    zIndex: 4,
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
  close: {
    padding: 6,
    position: "absolute",
    right: 14,
    zIndex: 5,
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
    zIndex: 3,
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
    zIndex: 4,
  },
});
