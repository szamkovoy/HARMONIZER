import { Audio, type AVPlaybackStatus } from "expo-av";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Animated, Easing, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  fetchActiveAffirmation,
  localDateYmd,
  markAffirmationPracticeComplete,
  type AffirmationDto,
} from "@/modules/affirmations/core/affirmationsClient";
import { playAffirmationAudio } from "@/modules/affirmations/core/playAffirmationAudio";
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
  /**
   * Practice end dim (0→1 over last ~5s). Panel opacity follows so text
   * dissolves with the rest of the UI.
   */
  dimOpacity?: number;
};

const VOICE_LEAD_MS = 1_000;
const DIM_BEFORE_END_MS = 5_000;

/**
 * Additive top panel + optional own-voice near exhale.
 * Does not alter breath timing — only overlays UI/audio.
 */
export const AffirmationBreathOverlay = forwardRef<AffirmationBreathGate, Props>(
  function AffirmationBreathOverlay(
    { phaseKind, elapsedMs, practiceTotalMs, cycleMs, active, dimOpacity = 0 },
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
    const voiceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const modeRef = useRef(mode);
    modeRef.current = mode;

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

    const clearVoiceTimer = () => {
      if (voiceTimerRef.current) {
        clearTimeout(voiceTimerRef.current);
        voiceTimerRef.current = null;
      }
    };

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

    useEffect(
      () => () => {
        clearVoiceTimer();
        void unloadSound();
      },
      [unloadSound],
    );

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

    const playVoice = useCallback(async () => {
      if (!row?.audioSignedUrl) return;
      if (playingRef.current) {
        skipNextExhaleRef.current = true;
        return;
      }
      if (skipNextExhaleRef.current) {
        skipNextExhaleRef.current = false;
        return;
      }
      try {
        await unloadSound();
        ensureFinaleWaiter();
        const sound = await playAffirmationAudio(row.audioSignedUrl, {
          onFinished: () => {
            playingRef.current = false;
            soundRef.current = null;
            if (finaleExhaleCountRef.current >= 3) {
              resolveFinaleWaiter();
            }
          },
        });
        soundRef.current = sound;
        playingRef.current = true;
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

      const avgCycle = Math.max(6_000, cycleMs || 12_000);
      const remaining = Math.max(0, practiceTotalMs - elapsedMs);
      const inFinale = remaining <= avgCycle * 4.2;

      // Intro: first exhale → show; next exhale → hide
      if (phaseKind === "exhale" && prev !== "exhale") {
        if (!introStartedRef.current) {
          introStartedRef.current = true;
          showPanel("intro");
          return;
        }
        if (!introDoneRef.current && modeRef.current === "intro") {
          introDoneRef.current = true;
          hidePanel();
          return;
        }
      }

      if (!inFinale) return;

      if (modeRef.current !== "finale") {
        showPanel("finale");
        finaleExhaleCountRef.current = 0;
      }

      // Start voice ~1s before exhale: schedule on inhale onset.
      if (phaseKind === "inhale" && prev !== "inhale") {
        if (finaleExhaleCountRef.current >= 3) return;
        clearVoiceTimer();
        const inhaleMs = Math.max(2_000, avgCycle / 2);
        const delay = Math.max(0, inhaleMs - VOICE_LEAD_MS);
        voiceTimerRef.current = setTimeout(() => {
          voiceTimerRef.current = null;
          if (finaleExhaleCountRef.current >= 3) return;
          finaleExhaleCountRef.current += 1;
          if (row.audioSignedUrl) {
            void playVoice();
          } else if (finaleExhaleCountRef.current >= 3) {
            resolveFinaleWaiter();
          }
        }, delay);
      }
    }, [
      active,
      cycleMs,
      elapsedMs,
      hidePanel,
      phaseKind,
      playVoice,
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
      const id = setTimeout(() => {
        if (!playingRef.current) resolveFinaleWaiter();
      }, 8_000);
      return () => clearTimeout(id);
    }, [active, elapsedMs, practiceTotalMs, row?.audioSignedUrl]);

    // Near practice end: if still showing, keep panel but dissolve with dim.
    useEffect(() => {
      if (!active || mode === "hidden") return;
      if (elapsedMs < practiceTotalMs - DIM_BEFORE_END_MS) return;
      // Stay in finale mode so opacity can track dimOpacity from parent.
      if (mode === "intro") {
        introDoneRef.current = true;
        setMode("finale");
      }
    }, [active, elapsedMs, mode, practiceTotalMs]);

    if (!row || mode === "hidden") return null;

    const panelTop = Math.max(insets.top * 2, insets.top + 44);
    const fade = Math.max(0, Math.min(1, 1 - dimOpacity));

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
            opacity: fade,
            transform: [{ translateY: slide }],
          },
        ]}
      >
        <AppText variant="technicalCaption" tone="muted" style={styles.hint}>
          {t("affirmation.breath.finaleHint")}
        </AppText>
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
