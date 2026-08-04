import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, AppState, Pressable, StyleSheet, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { router } from "expo-router";

import { useAuth } from "@/modules/auth";
import { useAppLocale } from "@/modules/i18n";
import { getSymbolStreamStrings } from "@/modules/mandala/i18n/symbolStream";
import { getCoherenceBreathStrings } from "@/modules/breath/i18n/coherence";
import { BinduSuccessionFlowCanvas } from "@/modules/mandala/experiments/BinduSuccessionFlowCanvas";
import {
  MandalaSoundProvider,
  SOUND_BED_NEURO_SYNC,
  useMandalaSoundSync,
  type SoundBedId,
} from "@/modules/mandala-sound";
import { AppButton } from "@/modules/ui/AppButton";
import { FloatingCloseButton } from "@/modules/ui/FloatingCloseButton";
import { ImmersiveScreenLayout } from "@/modules/ui/ImmersiveScreenLayout";
import { PracticeKeepAwake } from "@/modules/ui/PracticeKeepAwake";
import { PracticeOverlayPanel } from "@/modules/ui/PracticeOverlayPanel";
import { PracticeStopConfirmDialog } from "@/modules/ui/PracticeStopConfirmDialog";
import { defaultTheme, ThemeProvider } from "@/modules/ui/theme";
import { useImmersiveOverlayAutohide } from "@/modules/ui/useImmersiveOverlayAutohide";
import { recordPracticeSession } from "@/services/practiceSessions";
import { logRuntimeEvent, logRuntimeTap } from "@/services/runtimeDiagnostics";

const DEFAULT_DURATION_MS = 5 * 60_000;
const DEFAULT_CHAKRA = 6;
const OVERLAY_AUTOHIDE_MS = 4_000;
const OVERLAY_HINT_DELAY_MS = 5_000;
const FADE_TO_BLACK_MS = 600;
/** Фиксированные дефолты canvas после удаления тестовых контролов. */
const FIXED_DENSITY_BIAS = 0.5;
const FIXED_SCENE_OFFSET = 0;
const FIXED_SESSION_SEED = 1;

function exitAfterPractice(launchSource?: string) {
  const normalized = (launchSource ?? "").trim().toLowerCase();
  if (normalized === "assistant" || normalized === "day") {
    router.replace("/day");
    return;
  }
  router.back();
}

function SyncedSacredSymbolFlowCanvas({ isActive }: { isActive: boolean }) {
  const soundSync = useMandalaSoundSync();
  return (
    <BinduSuccessionFlowCanvas
      isActive={isActive}
      sceneOffset={FIXED_SCENE_OFFSET}
      densityBias={FIXED_DENSITY_BIAS}
      sessionSeed={FIXED_SESSION_SEED}
      tubeMode={false}
      externalSync={soundSync}
    />
  );
}

export function SacredSymbolStreamScreen({
  durationMs = DEFAULT_DURATION_MS,
  chakra = DEFAULT_CHAKRA,
  soundBed = SOUND_BED_NEURO_SYNC,
  launchSource = "practice_screen",
}: {
  durationMs?: number;
  chakra?: number;
  soundBed?: SoundBedId;
  launchSource?: string;
}) {
  const { authUser } = useAuth();
  const { locale: appLocale } = useAppLocale();
  const strings = useMemo(() => getSymbolStreamStrings(appLocale), [appLocale]);
  const stopConfirmStrings = useMemo(() => getCoherenceBreathStrings(appLocale), [appLocale]);
  const sessionStartedAtRef = useRef(Date.now());
  const [elapsedMs, setElapsedMs] = useState(0);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const completionSavedRef = useRef(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const {
    overlayVisible,
    clearOverlayTimer,
    scheduleOverlayHide,
    hideOverlay,
    toggleOverlay,
    showOverlay,
  } = useImmersiveOverlayAutohide({ autoHideMs: OVERLAY_AUTOHIDE_MS, initialVisible: false });

  const isFocused = useIsFocused();
  const [appState, setAppState] = useState(AppState.currentState);
  const isRenderActive = isFocused && appState === "active" && !finishing && !showStopConfirm;

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      setAppState(nextState);
      logRuntimeEvent("meditation:app_state", { nextState }, "debug");
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const hintTimer = setTimeout(() => {
      showOverlay();
    }, OVERLAY_HINT_DELAY_MS);
    return () => {
      clearTimeout(hintTimer);
      clearOverlayTimer();
    };
  }, [clearOverlayTimer, showOverlay]);

  const finishPractice = useCallback(() => {
    setFinishing(true);
    hideOverlay();
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: FADE_TO_BLACK_MS,
      useNativeDriver: true,
    }).start(() => {
      exitAfterPractice(launchSource);
    });
  }, [fadeAnim, hideOverlay, launchSource]);

  // Session-completion mark: записываем ровно когда практика ДОШЛА до конца
  // (elapsed >= durationMs), до закрытия окна. Не в окне оценки (его больше нет)
  // и не при досрочном выходе — только полноценное завершение.
  useEffect(() => {
    if (showStopConfirm || finishing) return;
    const id = setInterval(() => {
      const elapsed = Date.now() - sessionStartedAtRef.current;
      setElapsedMs(Math.min(durationMs, elapsed));
      if (elapsed >= durationMs && !completionSavedRef.current && authUser?.id) {
        completionSavedRef.current = true;
        const endedAt = Date.now();
        const startedAt = Math.min(sessionStartedAtRef.current, endedAt - Math.max(1, durationMs));
        void recordPracticeSession({
          userId: authUser.id,
          practiceSlug: "sacred-symbol-stream",
          startedAt: new Date(startedAt).toISOString(),
          endedAt: new Date(endedAt).toISOString(),
          selfRating: null,
          completionPct: 100,
          chakraFocusIds: [chakra],
          metrics: {},
          context: {
            source: "meditation",
            launch_source: launchSource,
            practice_kind: "meditation",
            duration_ms: durationMs,
          },
        }).catch(() => {
          completionSavedRef.current = false;
        });
        finishPractice();
      }
    }, 500);
    return () => clearInterval(id);
  }, [authUser?.id, chakra, durationMs, finishPractice, finishing, launchSource, showStopConfirm]);

  const handleScreenTap = useCallback(() => {
    if (showStopConfirm || finishing) return;
    logRuntimeTap("meditation_screen", { overlayVisible });
    toggleOverlay();
  }, [finishing, overlayVisible, showStopConfirm, toggleOverlay]);

  const requestStop = useCallback(() => {
    logRuntimeTap("meditation_stop_request");
    clearOverlayTimer();
    setShowStopConfirm(true);
  }, [clearOverlayTimer]);

  const controls = useMemo(
    () => (
      <AppButton
        label={strings.finishButton}
        onPress={requestStop}
        accessibilityLabel={strings.finishButton}
      />
    ),
    [requestStop, strings.finishButton],
  );

  // Keep screen on for flash meditation (no touches while symbols stream).
  // Calm meditation intentionally does NOT use keep-awake.
  const keepAwakeActive = isFocused && !finishing;

  return (
    <ImmersiveScreenLayout style={styles.safeArea} statusBarStyle="light" backgroundColor="#000000">
      <ThemeProvider value={defaultTheme}>
        <View style={styles.screen}>
          {keepAwakeActive ? <PracticeKeepAwake tag="harmonizer-sacred-symbol-stream" /> : null}
          <MandalaSoundProvider
            practiceKind="meditation"
            durationMs={durationMs}
            chakra={chakra}
            soundBed={soundBed}
            isActive={isRenderActive}
          >
            <SyncedSacredSymbolFlowCanvas isActive={isRenderActive} />
          </MandalaSoundProvider>

          {/*
            Прозрачный tap-backdrop ПОВЕРХ canvas (GL-холст перехватывает тачи,
            поэтому Pressable-обёртка вокруг canvas не работала). zIndex ниже
            панели (40) и крестика (30), но выше canvas — ловит тапы по пустому
            экрану и переключает оверлей. Тот же приём, что в BreathPracticeShell.
          */}
          <Pressable
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={styles.tapBackdrop}
            onPress={handleScreenTap}
          />

          {overlayVisible && !finishing ? (
            <FloatingCloseButton
              accessibilityLabel={strings.finishA11y}
              onPress={requestStop}
              style={styles.topClose}
            />
          ) : null}

          <PracticeOverlayPanel
            visible={overlayVisible && !finishing}
            title={strings.title}
            totalMs={durationMs}
            elapsedMs={elapsedMs}
            minutesShortLabel={strings.minutesShort}
            onInteraction={scheduleOverlayHide}
            controls={controls}
          />

          <Animated.View pointerEvents="none" style={[styles.blackCurtain, { opacity: fadeAnim }]} />
        </View>

        <PracticeStopConfirmDialog
          visible={showStopConfirm}
          title={stopConfirmStrings.stopConfirmTitle}
          message={stopConfirmStrings.stopConfirmMessage}
          continueLabel={stopConfirmStrings.stopConfirmNo}
          finishLabel={stopConfirmStrings.stopConfirmYes}
          onContinue={() => setShowStopConfirm(false)}
          onFinish={() => {
            setShowStopConfirm(false);
            finishPractice();
          }}
        />
      </ThemeProvider>
    </ImmersiveScreenLayout>
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
  tapBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "transparent",
    zIndex: 10,
  },
  topClose: {
    top: 54,
    right: 18,
    zIndex: 30,
    borderWidth: 1,
    borderColor: "rgba(125, 143, 255, 0.24)",
  },
  blackCurtain: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000000",
    zIndex: 90,
  },
});
