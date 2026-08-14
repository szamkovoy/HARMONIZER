import { Audio, type AVPlaybackStatus } from "expo-av";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  fetchActiveAffirmation,
  localDateYmd,
  markAffirmationPracticeComplete,
  type AffirmationDto,
} from "@/modules/affirmations/core/affirmationsClient";
import { useTranslate } from "@/modules/i18n";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

export type AffirmationBreathGate = {
  /** Resolve after last finale audio finishes (or immediately if none). */
  waitForFinaleAudio: () => Promise<void>;
  /** Best-effort day bump after successful practice. */
  notifyPracticeComplete: () => void;
};

type PhaseKind = "inhale" | "exhale" | "hold" | string;

type Props = {
  /** Current breath phase kind from the practice shell. */
  phaseKind: PhaseKind | null;
  /** Elapsed / total for finale window estimation. */
  elapsedMs: number;
  practiceTotalMs: number;
  /** Average cycle length estimate (ms). */
  cycleMs: number;
  /** Practice is in running phase. */
  active: boolean;
};

/**
 * Additive top panel + optional own-voice on exhale.
 * Does not alter breath timing — only overlays UI/audio.
 */
export const AffirmationBreathOverlay = forwardRef<AffirmationBreathGate, Props>(
  function AffirmationBreathOverlay(
    { phaseKind, elapsedMs, practiceTotalMs, cycleMs, active },
    ref,
  ) {
    const theme = useTheme();
    const { t } = useTranslate();
    const insets = useSafeAreaInsets();
    const [row, setRow] = useState<AffirmationDto | null>(null);
    const [mode, setMode] = useState<"hidden" | "intro" | "finale">("hidden");
    const slide = useRef(new Animated.Value(-200)).current;
    const prevKindRef = useRef<PhaseKind | null>(null);
    const introStartedRef = useRef(false);
    const introDoneRef = useRef(false);
    const finaleExhaleCountRef = useRef(0);
    const skipNextExhaleRef = useRef(false);
    const soundRef = useRef<Audio.Sound | null>(null);
    const playingRef = useRef(false);
    const finaleAudioPendingRef = useRef<Promise<void> | null>(null);
    const finaleAudioResolveRef = useRef<(() => void) | null>(null);
    const bumpedRef = useRef(false);

    useEffect(() => {
      let cancelled = false;
      void fetchActiveAffirmation()
        .then((a) => {
          if (!cancelled) setRow(a);
        })
        .catch(() => {
          if (!cancelled) setRow(null);
        });
      return () => {
        cancelled = true;
      };
    }, []);

    const showPanel = useCallback(
      (next: "intro" | "finale") => {
        setMode(next);
        Animated.timing(slide, {
          toValue: 0,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      },
      [slide],
    );

    const hidePanel = useCallback(() => {
      Animated.timing(slide, {
        toValue: -220,
        duration: 380,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMode("hidden");
      });
    }, [slide]);

    const unloadSound = useCallback(async () => {
      const s = soundRef.current;
      soundRef.current = null;
      playingRef.current = false;
      if (s) {
        try {
          await s.stopAsync();
        } catch {
          /* ignore */
        }
        try {
          await s.unloadAsync();
        } catch {
          /* ignore */
        }
      }
    }, []);

    useEffect(() => () => {
      void unloadSound();
    }, [unloadSound]);

    const ensureFinaleWaiter = () => {
      if (!finaleAudioPendingRef.current) {
        finaleAudioPendingRef.current = new Promise<void>((resolve) => {
          finaleAudioResolveRef.current = resolve;
        });
      }
    };

    const resolveFinaleWaiter = () => {
      finaleAudioResolveRef.current?.();
      finaleAudioResolveRef.current = null;
      finaleAudioPendingRef.current = Promise.resolve();
    };

    useImperativeHandle(
      ref,
      () => ({
        waitForFinaleAudio: async () => {
          if (!row?.audioSignedUrl || mode !== "finale") return;
          ensureFinaleWaiter();
          await finaleAudioPendingRef.current;
        },
        notifyPracticeComplete: () => {
          if (!row || bumpedRef.current) return;
          bumpedRef.current = true;
          void markAffirmationPracticeComplete(localDateYmd()).catch(() => {
            bumpedRef.current = false;
          });
        },
      }),
      [mode, row],
    );

    const playOnExhale = useCallback(async () => {
      if (!row?.audioSignedUrl) return;
      if (playingRef.current) {
        // Overlap protection: skip next exhale slot.
        skipNextExhaleRef.current = true;
        return;
      }
      if (skipNextExhaleRef.current) {
        skipNextExhaleRef.current = false;
        return;
      }
      try {
        await unloadSound();
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
        });
        ensureFinaleWaiter();
        const { sound } = await Audio.Sound.createAsync(
          { uri: row.audioSignedUrl },
          { shouldPlay: true },
        );
        soundRef.current = sound;
        playingRef.current = true;
        sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
          if (!status.isLoaded) return;
          if (status.didJustFinish) {
            playingRef.current = false;
            void sound.unloadAsync();
            soundRef.current = null;
            // After last planned finale exhale (~3), resolve wait.
            if (finaleExhaleCountRef.current >= 3) {
              resolveFinaleWaiter();
            }
          }
        });
      } catch {
        playingRef.current = false;
        resolveFinaleWaiter();
      }
    }, [row?.audioSignedUrl, unloadSound]);

    // Phase transitions
    useEffect(() => {
      if (!active || !row) {
        prevKindRef.current = phaseKind;
        return;
      }
      const prev = prevKindRef.current;
      prevKindRef.current = phaseKind;
      if (phaseKind !== "exhale" || prev === "exhale") return;

      const avgCycle = Math.max(6_000, cycleMs || 12_000);
      const remaining = Math.max(0, practiceTotalMs - elapsedMs);
      // Start ~1 cycle earlier than before so the 3rd voice play finishes
      // before the practice dim-to-black window (~5s).
      const inFinale = remaining <= avgCycle * 4.2;

      // Intro: first exhale → show; next exhale → hide
      if (!introStartedRef.current) {
        introStartedRef.current = true;
        showPanel("intro");
        return;
      }
      if (!introDoneRef.current && mode === "intro") {
        introDoneRef.current = true;
        hidePanel();
        return;
      }

      if (inFinale) {
        if (mode !== "finale") {
          showPanel("finale");
          finaleExhaleCountRef.current = 0;
        }
        // Cap at 3 plays even with the wider window.
        if (finaleExhaleCountRef.current >= 3) return;
        finaleExhaleCountRef.current += 1;
        if (row.audioSignedUrl) {
          void playOnExhale();
        } else if (finaleExhaleCountRef.current >= 3) {
          resolveFinaleWaiter();
        }
      }
    }, [
      active,
      cycleMs,
      elapsedMs,
      hidePanel,
      mode,
      phaseKind,
      playOnExhale,
      practiceTotalMs,
      row,
      showPanel,
    ]);

    // If practice ends without audio / without 3 exhales, don't block forever.
    useEffect(() => {
      if (!active) return;
      if (elapsedMs < practiceTotalMs - 500) return;
      if (!row?.audioSignedUrl) {
        resolveFinaleWaiter();
        return;
      }
      // Give playback a short grace; waitForFinaleAudio still awaits finish.
      const id = setTimeout(() => {
        if (!playingRef.current) resolveFinaleWaiter();
      }, 8_000);
      return () => clearTimeout(id);
    }, [active, elapsedMs, practiceTotalMs, row?.audioSignedUrl]);

    if (!row || mode === "hidden") return null;

    // Drop the whole panel ~2× status/safe-area height so Dynamic Island / clock
    // do not cover the affirmation text (intro and finale).
    const panelTop = Math.max(insets.top * 2, insets.top + 44);

    return (
      <Animated.View
        pointerEvents="none"
        style={[
          styles.panel,
          {
            top: panelTop,
            paddingTop: 12,
            backgroundColor: theme.colors.controlButtonBg,
            borderColor: theme.colors.surfaceBorder,
            transform: [{ translateY: slide }],
          },
        ]}
      >
        {mode === "finale" ? (
          <AppText variant="technicalCaption" tone="muted" style={styles.hint}>
            {t("affirmation.breath.finaleHint")}
          </AppText>
        ) : null}
        <AppText variant="screenHint" style={styles.body}>
          {row.text}
        </AppText>
      </Animated.View>
    );
  },
);

const styles = StyleSheet.create({
  panel: {
    position: "absolute",
    top: 0,
    left: 12,
    right: 12,
    zIndex: 40,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingBottom: 12,
    gap: 6,
  },
  hint: { lineHeight: 16 },
  body: { lineHeight: 22 },
});
