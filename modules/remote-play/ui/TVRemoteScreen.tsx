import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";

import { useAppLocale } from "@/modules/i18n";
import { getTvRemoteStrings } from "@/modules/remote-play/i18n/remotePlay";
import { useRemotePlay } from "@/modules/remote-play/useRemotePlay";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { FloatingCloseButton } from "@/modules/ui/FloatingCloseButton";
import { ModalScreenLayout } from "@/modules/ui/StackScreenLayout";
import { SurfaceCardView } from "@/modules/ui/SurfaceCardView";
import { useTheme } from "@/modules/ui/theme";

export function TVRemoteScreen() {
  const theme = useTheme();
  const { locale } = useAppLocale();
  const strings = getTvRemoteStrings(locale);
  const remotePlay = useRemotePlay();
  const params = useLocalSearchParams<{ title?: string; durationSec?: string }>();
  const title =
    typeof params.title === "string" && params.title.trim()
      ? params.title.trim()
      : strings.titleFallback;
  const durationSec = useMemo(() => {
    const parsed = typeof params.durationSec === "string" ? Number.parseInt(params.durationSec, 10) : 0;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [params.durationSec]);
  const [startedAt] = useState(() => Date.now());
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (remotePlay.session?.status !== "playing") return;
    const timer = setInterval(() => {
      setElapsedSec(Math.max(0, Math.round((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [remotePlay.session?.status, startedAt]);

  const progress = durationSec ? Math.min(1, elapsedSec / durationSec) : 0;
  const status = remotePlay.session?.status ?? "waiting";

  const pauseOrResume = async () => {
    try {
      if (status === "paused") {
        await remotePlay.resume();
      } else {
        await remotePlay.pause();
      }
    } catch (error) {
      Alert.alert(strings.alertTitle, error instanceof Error ? error.message : strings.pauseFailed);
    }
  };

  const stop = async () => {
    try {
      await remotePlay.stop();
      router.back();
    } catch (error) {
      Alert.alert(strings.alertTitle, error instanceof Error ? error.message : strings.stopFailed);
    }
  };

  return (
    <ModalScreenLayout
      overlay={
        <FloatingCloseButton
          accessibilityLabel={strings.closeA11y}
          onPress={() => router.back()}
        />
      }
    >
      <View style={styles.content}>
        <SurfaceCardView tone="elevated" style={styles.card}>
          <View style={styles.header}>
            <AppText variant="technicalCaption" tone="muted">
              {strings.meta(remotePlay.session?.pairing_code ?? strings.idleCode)}
            </AppText>
            <AppText variant="screenTitle" accessibilityRole="header">
              {title}
            </AppText>
            <AppText variant="screenHint" tone="muted">
              {strings.description}
            </AppText>
          </View>

          <View style={styles.progressBlock}>
            <View style={[styles.progressTrack, { backgroundColor: theme.colors.controlButtonBg }]}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${progress * 100}%`,
                    backgroundColor: theme.colors.buttonPrimaryBg,
                  },
                ]}
              />
            </View>
            <View style={styles.progressLabels}>
              <AppText variant="technicalCaption" tone="muted">
                {Math.floor(elapsedSec / 60)}:{String(elapsedSec % 60).padStart(2, "0")}
              </AppText>
              <AppText variant="technicalCaption" tone="muted">
                {durationSec
                  ? strings.durationMinutes(Math.max(1, Math.round(durationSec / 60)))
                  : strings.durationUnknown}
              </AppText>
            </View>
          </View>

          <View style={[styles.statusPill, { borderColor: theme.colors.surfaceBorder }]}>
            <AppText variant="inlineStatus">{strings.status(status)}</AppText>
          </View>

          <View style={styles.actions}>
            <AppButton
              label={status === "paused" ? strings.resumeButton : strings.pauseButton}
              onPress={pauseOrResume}
              disabled={!remotePlay.connected || remotePlay.busy || status === "stopped"}
              style={styles.actionButton}
            />
            <AppButton
              label={strings.stopButton}
              variant="secondary"
              onPress={stop}
              disabled={!remotePlay.connected || remotePlay.busy}
              style={styles.actionButton}
            />
          </View>
        </SurfaceCardView>
      </View>
    </ModalScreenLayout>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    justifyContent: "center",
    width: "100%",
  },
  card: {
    gap: 22,
    width: "100%",
  },
  header: {
    gap: 8,
  },
  progressBlock: {
    gap: 8,
  },
  progressTrack: {
    height: 12,
    overflow: "hidden",
    borderRadius: 999,
  },
  progressFill: {
    height: "100%",
  },
  progressLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  statusPill: {
    alignSelf: "flex-start",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  actionButton: {
    flex: 1,
  },
});
