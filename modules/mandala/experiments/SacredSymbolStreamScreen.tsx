import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { router } from "expo-router";

import { useAuth } from "@/modules/auth";
import { BinduSuccessionFlowCanvas } from "@/modules/mandala/experiments/BinduSuccessionFlowCanvas";
import { MandalaSoundProvider, useMandalaSoundSync } from "@/modules/mandala-sound";
import { AppButton } from "@/modules/ui/AppButton";
import { AppDialog } from "@/modules/ui/AppDialog";
import { AppText } from "@/modules/ui/AppText";
import { HARMONIZER_TEST_MODE } from "@/modules/ui/testMode";
import { recordPracticeSession, selfRatingFromMood, type PracticeCompletionMood } from "@/services/practiceSessions";
import { logRuntimeEvent, logRuntimeTap } from "@/services/runtimeDiagnostics";

const DENSITY_OPTIONS = [
  { label: "Airy", value: 0.18 },
  { label: "Balanced", value: 0.5 },
  { label: "Dense", value: 0.84 },
] as const;

const DEFAULT_DURATION_MS = 5 * 60_000;
const DEFAULT_CHAKRA = 6;
const OVERLAY_AUTOHIDE_MS = 4_000;

function SyncedSacredSymbolFlowCanvas({
  isActive,
  sceneOffset,
  densityBias,
  sessionSeed,
}: {
  isActive: boolean;
  sceneOffset: number;
  densityBias: number;
  sessionSeed: number;
}) {
  const soundSync = useMandalaSoundSync();
  return (
    <BinduSuccessionFlowCanvas
      isActive={isActive}
      sceneOffset={sceneOffset}
      densityBias={densityBias}
      sessionSeed={sessionSeed}
      tubeMode={false}
      externalSync={soundSync}
    />
  );
}

function formatRemaining(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function SacredSymbolStreamScreen({
  durationMs = DEFAULT_DURATION_MS,
  chakra = DEFAULT_CHAKRA,
  launchSource = "practice_screen",
}: {
  durationMs?: number;
  chakra?: number;
  launchSource?: string;
}) {
  const { authUser } = useAuth();
  const sessionStartedAtRef = useRef(Date.now());
  const [savingCompletion, setSavingCompletion] = useState(false);
  const [completionSaved, setCompletionSaved] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [showRatingDialog, setShowRatingDialog] = useState(false);
  const overlayY = useRef(new Animated.Value(0)).current;
  const overlayHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isFocused = useIsFocused();
  const [appState, setAppState] = useState(AppState.currentState);
  const [sceneOffset, setSceneOffset] = useState(0);
  const [densityBias, setDensityBias] = useState<number>(0.84);
  const [isPaused, setIsPaused] = useState(false);
  const [sessionSeed, setSessionSeed] = useState(1);
  const isRenderActive = isFocused && appState === "active" && !isPaused && !showRatingDialog && !showStopConfirm;

  const clearOverlayTimer = useCallback(() => {
    if (overlayHideTimerRef.current) {
      clearTimeout(overlayHideTimerRef.current);
      overlayHideTimerRef.current = null;
    }
  }, []);

  const scheduleOverlayHide = useCallback(() => {
    clearOverlayTimer();
    overlayHideTimerRef.current = setTimeout(() => {
      setOverlayVisible(false);
      overlayHideTimerRef.current = null;
    }, OVERLAY_AUTOHIDE_MS);
  }, [clearOverlayTimer]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      setAppState(nextState);
      logRuntimeEvent("meditation:app_state", { nextState }, "debug");
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    logRuntimeEvent("meditation:render_active", {
      isRenderActive,
      isFocused,
      appState,
      isPaused,
      showRatingDialog,
      showStopConfirm,
    });
  }, [appState, isFocused, isPaused, isRenderActive, showRatingDialog, showStopConfirm]);

  useEffect(() => {
    setOverlayVisible(true);
    scheduleOverlayHide();
    return () => clearOverlayTimer();
  }, [clearOverlayTimer, scheduleOverlayHide]);

  useEffect(() => {
    Animated.timing(overlayY, {
      toValue: overlayVisible ? 0 : 220,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [overlayVisible, overlayY]);

  useEffect(() => {
    if (showRatingDialog || isPaused) return;
    const id = setInterval(() => {
      const elapsed = Date.now() - sessionStartedAtRef.current;
      setElapsedMs(Math.min(durationMs, elapsed));
      if (elapsed >= durationMs) {
        setShowRatingDialog(true);
        setOverlayVisible(false);
      }
    }, 500);
    return () => clearInterval(id);
  }, [durationMs, isPaused, showRatingDialog]);

  const completePractice = useCallback(async (mood: PracticeCompletionMood) => {
    if (!authUser?.id || savingCompletion || completionSaved) return;
    setSavingCompletion(true);
    const endedAt = Date.now();
    const startedAt = Math.min(sessionStartedAtRef.current, endedAt - Math.max(1, durationMs));
    const savedId = await recordPracticeSession({
      userId: authUser.id,
      practiceSlug: "sacred-symbol-stream",
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      selfRating: selfRatingFromMood(mood),
      completionPct: 100,
      chakraFocusIds: [chakra],
      metrics: {},
      context: {
        source: "meditation",
        launch_source: launchSource,
        practice_kind: "meditation",
        duration_ms: durationMs,
      },
    });
    setCompletionSaved(Boolean(savedId));
    setSavingCompletion(false);
    router.back();
  }, [authUser?.id, chakra, completionSaved, durationMs, launchSource, savingCompletion]);

  const handleScreenTap = useCallback(() => {
    if (showRatingDialog || showStopConfirm) return;
    logRuntimeTap("meditation_screen", { overlayVisible });
    setOverlayVisible((current) => {
      const next = !current;
      if (next) scheduleOverlayHide();
      else clearOverlayTimer();
      return next;
    });
  }, [clearOverlayTimer, scheduleOverlayHide, showRatingDialog, showStopConfirm]);

  const requestStop = useCallback(() => {
    logRuntimeTap("meditation_stop_request");
    clearOverlayTimer();
    setShowStopConfirm(true);
  }, [clearOverlayTimer]);

  const remainingMs = Math.max(0, durationMs - elapsedMs);

  return (
    <View style={styles.safeArea}>
      <Pressable style={styles.screen} onPress={handleScreenTap}>
        <MandalaSoundProvider
          practiceKind="meditation"
          durationMs={durationMs}
          chakra={chakra}
          isActive={isRenderActive}
        >
          <SyncedSacredSymbolFlowCanvas
            isActive={isRenderActive}
            sceneOffset={sceneOffset}
            densityBias={densityBias}
            sessionSeed={sessionSeed}
          />
        </MandalaSoundProvider>

        {overlayVisible ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Завершить практику"
            onPress={requestStop}
            style={styles.topClose}
            hitSlop={12}
          >
            <Text style={styles.topCloseText}>×</Text>
          </Pressable>
        ) : null}

        <View pointerEvents="none" style={styles.topOverlay}>
          <Text style={styles.eyebrow}>Preserved Variant</Text>
          <Text style={styles.title}>Вспышка</Text>
          <Text style={styles.subtitle}>
            Короткая визуальная медитация для мягкого переключения внимания и гармонизации.
          </Text>
        </View>

        <Animated.View style={[styles.controlPanel, { transform: [{ translateY: overlayY }] }]}>
          <View style={styles.panelCard}>
            <Text style={styles.panelTitle}>Вспышка</Text>
            <Text style={styles.panelTime}>Осталось {formatRemaining(remainingMs)}</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.min(1, elapsedMs / Math.max(1, durationMs)) * 100}%` }]} />
            </View>
            <Pressable onPress={requestStop} style={[styles.button, styles.primaryButton]}>
              <Text style={styles.primaryButtonText}>Завершить</Text>
            </Pressable>
            {HARMONIZER_TEST_MODE ? (
              <View style={styles.testBlock}>
                <View style={styles.chipRow}>
                  {DENSITY_OPTIONS.map((option) => {
                    const isActive = Math.abs(option.value - densityBias) < 0.001;
                    return (
                      <Pressable
                        key={option.label}
                        onPress={() => setDensityBias(option.value)}
                        style={[styles.chip, isActive && styles.chipActive]}
                      >
                        <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={styles.actionRow}>
                  <Pressable
                    onPress={() => {
                      setSceneOffset(0);
                      setSessionSeed((current) => current + 1);
                    }}
                    style={[styles.button, styles.secondaryButton]}
                  >
                    <Text style={styles.secondaryButtonText}>Новая линия</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setSceneOffset((current) => current + 1)}
                    style={[styles.button, styles.secondaryButton]}
                  >
                    <Text style={styles.secondaryButtonText}>Следующая мандала</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setIsPaused((current) => !current)}
                    style={[styles.button, styles.secondaryButton]}
                  >
                    <Text style={styles.secondaryButtonText}>{isPaused ? "Продолжить" : "Пауза"}</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        </Animated.View>
      </Pressable>

      <AppDialog
        visible={showStopConfirm}
        title="Завершить практику?"
        message="Можно остановиться сейчас и отметить, как вы себя чувствуете после практики."
        actions={
          <>
            <AppButton label="Продолжить" variant="secondary" onPress={() => setShowStopConfirm(false)} />
            <AppButton
              label="Завершить"
              onPress={() => {
                setShowStopConfirm(false);
                setShowRatingDialog(true);
              }}
            />
          </>
        }
      />
      <AppDialog
        visible={showRatingDialog}
        title="Как вы себя чувствуете?"
        message="Эта оценка поможет позже лучше подбирать практики."
        actionsLayout="column"
        actions={
          <>
            <AppButton label="Лучше" onPress={() => void completePractice("better")} disabled={savingCompletion} />
            <AppButton label="Так же" variant="secondary" onPress={() => void completePractice("same")} disabled={savingCompletion} />
            <AppButton label="Хуже" variant="secondary" onPress={() => void completePractice("worse")} disabled={savingCompletion} />
          </>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#000000",
  },
  screen: {
    flex: 1,
    backgroundColor: "#000000",
  },
  topClose: {
    position: "absolute",
    top: 54,
    right: 18,
    zIndex: 30,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(18, 24, 40, 0.82)",
    borderWidth: 1,
    borderColor: "rgba(125, 143, 255, 0.24)",
  },
  topCloseText: {
    color: "#ffffff",
    fontSize: 24,
    lineHeight: 28,
  },
  topOverlay: {
    position: "absolute",
    top: 12,
    left: 16,
    right: 16,
    gap: 6,
  },
  eyebrow: {
    color: "rgba(226, 232, 255, 0.72)",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  title: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "700",
  },
  subtitle: {
    color: "rgba(228, 232, 255, 0.78)",
    fontSize: 14,
    lineHeight: 19,
    maxWidth: 420,
  },
  controlPanel: {
    position: "absolute",
    right: 16,
    bottom: 20,
    left: 16,
    zIndex: 20,
  },
  panelCard: {
    borderRadius: 22,
    padding: 16,
    gap: 10,
    backgroundColor: "rgba(18, 24, 40, 0.92)",
    borderWidth: 1,
    borderColor: "rgba(125, 143, 255, 0.24)",
  },
  panelTitle: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 17,
    textAlign: "center",
  },
  panelTime: {
    color: "rgba(228, 232, 255, 0.78)",
    fontWeight: "600",
    textAlign: "center",
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
    backgroundColor: "rgba(236, 241, 255, 0.18)",
  },
  progressFill: {
    height: "100%",
    borderRadius: 2,
    backgroundColor: "#7a8cff",
  },
  testBlock: {
    gap: 12,
    marginTop: 4,
  },
  chipRow: {
    flexDirection: "row",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "rgba(18, 24, 40, 0.86)",
    borderWidth: 1,
    borderColor: "rgba(125, 143, 255, 0.24)",
  },
  chipActive: {
    backgroundColor: "#c99cff",
    borderColor: "#c99cff",
  },
  chipText: {
    color: "#ebf0ff",
    fontSize: 13,
    fontWeight: "600",
  },
  chipTextActive: {
    color: "#120f1f",
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
  },
  button: {
    flexGrow: 1,
    flexBasis: 110,
    minHeight: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  primaryButton: {
    backgroundColor: "#7a8cff",
  },
  savedButton: {
    backgroundColor: "#9ee6c7",
  },
  secondaryButton: {
    backgroundColor: "rgba(18, 24, 40, 0.86)",
    borderWidth: 1,
    borderColor: "rgba(125, 143, 255, 0.24)",
  },
  primaryButtonText: {
    color: "#081022",
    fontWeight: "700",
  },
  secondaryButtonText: {
    color: "#ecf1ff",
    fontWeight: "600",
  },
});
