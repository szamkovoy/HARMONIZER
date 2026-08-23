import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { router } from "expo-router";

import { useAppLocale } from "@/modules/i18n";
import {
  MandalaSoundProvider,
  useMandalaSoundInterruption,
  type SoundBedId,
} from "@/modules/mandala-sound";
import { SOUND_BED_NEURO_SYNC } from "@/modules/mandala-sound/core/soundBed";
import { CALM_BED_IMAGES } from "@/modules/practices/core/calmBedImages";
import { getPracticeCatalogStrings } from "@/modules/practices/i18n/practices";
import { getCoherenceBreathStrings } from "@/modules/breath/i18n/coherence";
import { AppButton } from "@/modules/ui/AppButton";
import { FloatingCloseButton } from "@/modules/ui/FloatingCloseButton";
import { ImmersiveScreenLayout } from "@/modules/ui/ImmersiveScreenLayout";
import { PracticeOverlayPanel } from "@/modules/ui/PracticeOverlayPanel";
import { PracticeStopConfirmDialog } from "@/modules/ui/PracticeStopConfirmDialog";
import { defaultTheme, ThemeProvider } from "@/modules/ui/theme";
import { useImmersiveOverlayAutohide } from "@/modules/ui/useImmersiveOverlayAutohide";
import { logRuntimeEvent, logRuntimeTap } from "@/services/runtimeDiagnostics";

const DEFAULT_DURATION_MS = 30 * 60_000;
const OVERLAY_AUTOHIDE_MS = 4_000;
const OVERLAY_HINT_DELAY_MS = 5_000;
const IMAGE_SIDE_INSET_RATIO = 0.1;
const IMAGE_RADIUS = 14;
const IMAGE_BORDER = "rgba(255,255,255,0.22)";

function exitCalmPractice() {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace("/(tabs)/practices");
}

export function CalmPracticeScreen({
  durationMs = DEFAULT_DURATION_MS,
  soundBed = SOUND_BED_NEURO_SYNC,
}: {
  durationMs?: number;
  soundBed?: SoundBedId;
}) {
  const { locale: appLocale } = useAppLocale();
  const catalogStrings = useMemo(() => getPracticeCatalogStrings(appLocale), [appLocale]);
  const stopConfirmStrings = useMemo(() => getCoherenceBreathStrings(appLocale), [appLocale]);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const sessionStartedAtRef = useRef(Date.now());
  const interruptionPauseStartedAtRef = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const interrupted = useMandalaSoundInterruption();
  const {
    overlayVisible,
    clearOverlayTimer,
    scheduleOverlayHide,
    hideOverlay,
    toggleOverlay,
    showOverlay,
  } = useImmersiveOverlayAutohide({ autoHideMs: OVERLAY_AUTOHIDE_MS, initialVisible: false });

  // Keep audio through screen-off / app background; stop only when leaving the practice.
  const audioActive = !finishing;
  const imageSource = CALM_BED_IMAGES[soundBed] ?? CALM_BED_IMAGES["neuro-sync"];
  const imageWidth = screenWidth * (1 - IMAGE_SIDE_INSET_RATIO * 2);
  const imageHeight = Math.min(imageWidth * (795 / 600), screenHeight * (1 - IMAGE_SIDE_INSET_RATIO * 2));

  useEffect(() => {
    logRuntimeEvent("calm_practice:mount", { durationMs, soundBed }, "debug");
    const hintTimer = setTimeout(() => {
      showOverlay();
    }, OVERLAY_HINT_DELAY_MS);
    return () => {
      clearTimeout(hintTimer);
      clearOverlayTimer();
    };
  }, [clearOverlayTimer, durationMs, showOverlay, soundBed]);

  // Exclude OS-interruption windows (phone call, another app taking audio
  // focus) from the elapsed timer: shift the wall-clock start forward by the
  // paused duration so the practice still ends exactly at its configured length.
  useEffect(() => {
    if (interrupted) {
      if (interruptionPauseStartedAtRef.current == null) {
        interruptionPauseStartedAtRef.current = Date.now();
      }
      return;
    }
    const pauseStartedAt = interruptionPauseStartedAtRef.current;
    if (pauseStartedAt != null) {
      const pausedMs = Date.now() - pauseStartedAt;
      sessionStartedAtRef.current += pausedMs;
      interruptionPauseStartedAtRef.current = null;
    }
  }, [interrupted]);

  const finishPractice = useCallback(() => {
    setFinishing(true);
    hideOverlay();
    exitCalmPractice();
  }, [hideOverlay]);

  useEffect(() => {
    if (showStopConfirm || finishing) return;
    const id = setInterval(() => {
      if (interrupted) return; // pause elapsed accounting while OS holds audio focus
      const elapsed = Date.now() - sessionStartedAtRef.current;
      setElapsedMs(Math.min(durationMs, elapsed));
      if (elapsed >= durationMs) {
        finishPractice();
      }
    }, 500);
    return () => clearInterval(id);
  }, [durationMs, finishPractice, finishing, interrupted, showStopConfirm]);

  const handleScreenTap = useCallback(() => {
    if (showStopConfirm || finishing) return;
    logRuntimeTap("calm_practice_screen", { overlayVisible });
    toggleOverlay();
  }, [finishing, overlayVisible, showStopConfirm, toggleOverlay]);

  const requestStop = useCallback(() => {
    logRuntimeTap("calm_practice_stop_request");
    clearOverlayTimer();
    setShowStopConfirm(true);
  }, [clearOverlayTimer]);

  const controls = useMemo(
    () => (
      <AppButton
        label={stopConfirmStrings.stopConfirmYes}
        onPress={requestStop}
        accessibilityLabel={stopConfirmStrings.stopConfirmYes}
      />
    ),
    [requestStop, stopConfirmStrings.stopConfirmYes],
  );

  return (
    <ImmersiveScreenLayout style={styles.safeArea} statusBarStyle="light" backgroundColor="#000000">
      <ThemeProvider value={defaultTheme}>
        <View style={styles.screen}>
          <MandalaSoundProvider
            practiceKind="meditation"
            durationMs={durationMs}
            soundBed={soundBed}
            isActive={audioActive}
            staysActiveInBackground
            lockScreen={{ title: catalogStrings.meditationCalmTitle, artwork: imageSource }}
          >
            <View style={styles.imageStage} pointerEvents="none">
              <View
                style={[
                  styles.imageFrame,
                  {
                    width: imageWidth,
                    height: imageHeight,
                    borderRadius: IMAGE_RADIUS,
                    borderColor: IMAGE_BORDER,
                  },
                ]}
              >
                <Image source={imageSource} style={styles.image} resizeMode="cover" />
              </View>
            </View>
          </MandalaSoundProvider>

          <Pressable
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={styles.tapBackdrop}
            onPress={handleScreenTap}
          />

          {overlayVisible && !finishing ? (
            <FloatingCloseButton
              accessibilityLabel={stopConfirmStrings.stopConfirmTitle}
              onPress={requestStop}
              style={styles.topClose}
            />
          ) : null}

          <PracticeOverlayPanel
            visible={overlayVisible && !finishing}
            title={catalogStrings.meditationCalmTitle}
            totalMs={durationMs}
            elapsedMs={elapsedMs}
            minutesShortLabel={catalogStrings.durationMinUnit}
            onInteraction={scheduleOverlayHide}
            controls={controls}
          />
        </View>

        <PracticeStopConfirmDialog
          visible={showStopConfirm}
          title={stopConfirmStrings.stopConfirmTitle}
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
  imageStage: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  imageFrame: {
    borderWidth: StyleSheet.hairlineWidth * 2,
    overflow: "hidden",
    backgroundColor: "#111111",
  },
  image: {
    width: "100%",
    height: "100%",
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
});
