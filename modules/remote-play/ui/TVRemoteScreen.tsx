import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";

import { useAuth } from "@/modules/auth";
import { useAppLocale } from "@/modules/i18n";
import { getCoherenceBreathStrings } from "@/modules/breath/i18n/coherence";
import { getTvRemoteStrings } from "@/modules/remote-play/i18n/remotePlay";
import { useRemotePlay } from "@/modules/remote-play/useRemotePlay";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { FloatingCloseButton } from "@/modules/ui/FloatingCloseButton";
import { PracticeStopConfirmDialog } from "@/modules/ui/PracticeStopConfirmDialog";
import { StackScreenLayout, StackScrollView } from "@/modules/ui/StackScreenLayout";
import { SurfaceCardView } from "@/modules/ui/SurfaceCardView";
import { useTheme } from "@/modules/ui/theme";
import { recordPracticeSession } from "@/services/practiceSessions";

export function TVRemoteScreen() {
  const theme = useTheme();
  const { locale } = useAppLocale();
  const strings = getTvRemoteStrings(locale);
  const metaFn =
    typeof strings?.meta === "function"
      ? strings.meta
      : (code: string) => `ТВ-пульт · код ${code}`;
  const statusWordMap: Record<string, string> = {
    playing: "запущено",
    paused: "пауза",
    stopped: "остановлено",
    waiting: "ожидание",
    closed: "закрыто",
  };
  const statusFn =
    typeof strings?.status === "function"
      ? strings.status
      : (value: string) => `Статус: ${statusWordMap[value] ?? value}`;
  const durationMinutesFn =
    typeof strings?.durationMinutes === "function"
      ? strings.durationMinutes
      : (minutes: number) => `${minutes} мин`;
  const str = {
    closeA11y: strings?.closeA11y || "Закрыть пульт",
    idleCode: strings?.idleCode || "не активен",
    titleFallback: strings?.titleFallback || "Практика на ТВ",
    meta: metaFn,
    openOnTvHint:
      strings?.openOnTvHint ||
      "Откройте на телевизоре или на компьютере страницу https://zamkovoi.yoga/tv/",
    durationUnknown: strings?.durationUnknown || "Длительность уточняется",
    durationMinutes: durationMinutesFn,
    status: statusFn,
    pauseButton: strings?.pauseButton || "Пауза",
    resumeButton: strings?.resumeButton || "Продолжить",
    replayButton: strings?.replayButton || "Запустить заново",
    stopButton: strings?.stopButton || "Стоп",
    disconnectButton: strings?.disconnectButton || "Отключить ТВ",
    finishingButton: strings?.finishingButton || "Завершаем…",
    alertTitle: strings?.alertTitle || "Remote Play",
    pauseFailed: strings?.pauseFailed || "Не удалось обновить статус ТВ.",
    stopFailed: strings?.stopFailed || "Не удалось остановить видео на ТВ.",
    replayFailed: strings?.replayFailed || "Не удалось запустить видео на ТВ.",
    disconnectFailed: strings?.disconnectFailed || "Не удалось отключить ТВ.",
  };
  const remotePlay = useRemotePlay();
  const { authUser } = useAuth();
  const stopConfirm = getCoherenceBreathStrings(locale);
  const params = useLocalSearchParams<{
    title?: string;
    durationSec?: string;
    vimeoId?: string;
    audiotrack?: string;
    practiceId?: string;
    slug?: string;
    chakraIds?: string;
    launchSource?: string;
  }>();
  const title =
    typeof params.title === "string" && params.title.trim()
      ? params.title.trim()
      : str.titleFallback;
  const durationSec = useMemo(() => {
    const parsed = typeof params.durationSec === "string" ? Number.parseInt(params.durationSec, 10) : 0;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [params.durationSec]);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [finishing, setFinishing] = useState(false);

  // Accumulate playing seconds only while status === "playing" (frozen on pause/stop,
  // reset on replay) — used both for the progress bar and as the "reached the end"
  // signal for session recording.
  useEffect(() => {
    if (remotePlay.session?.status !== "playing") return;
    const timer = setInterval(() => {
      setElapsedSec((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [remotePlay.session?.status]);

  const progress = durationSec ? Math.min(1, elapsedSec / durationSec) : 0;
  const status = remotePlay.session?.status ?? "waiting";

  const pauseOrResume = async () => {
    try {
      if (status === "paused") {
        await remotePlay.resume();
      } else if (status === "playing") {
        await remotePlay.pause();
      }
    } catch (error) {
      Alert.alert(str.alertTitle, error instanceof Error ? error.message : str.pauseFailed);
    }
  };

  const replay = async () => {
    if (!params.vimeoId) {
      Alert.alert(str.alertTitle, str.replayFailed);
      return;
    }
    try {
      setElapsedSec(0);
      await remotePlay.playVimeo(params.vimeoId, params.audiotrack);
    } catch (error) {
      Alert.alert(str.alertTitle, error instanceof Error ? error.message : str.replayFailed);
    }
  };

  const requestStop = () => {
    if (remotePlay.busy || finishing) return;
    setShowStopConfirm(true);
  };

  // Record a practice_sessions row ONLY if the practice reached the end
  // (elapsed >= 95% of duration). Best-effort — swallowed on error.
  const maybeRecordTvSession = async () => {
    const userId = authUser?.id;
    const practiceId = typeof params.practiceId === "string" ? params.practiceId.trim() : "";
    if (!userId || !practiceId || !durationSec) return;
    if (elapsedSec < durationSec * 0.95) return;
    const chakraIds =
      typeof params.chakraIds === "string" && params.chakraIds.trim()
        ? params.chakraIds
            .split(",")
            .map((n) => Number.parseInt(n, 10))
            .filter((n) => Number.isFinite(n) && n >= 1 && n <= 7)
        : [];
    const endedAt = Date.now();
    const startedAt = endedAt - Math.max(1, elapsedSec) * 1000;
    try {
      await recordPracticeSession({
        userId,
        practiceId,
        practiceSlug: typeof params.slug === "string" ? params.slug : "",
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date(endedAt).toISOString(),
        completionPct: 100,
        chakraFocusIds: chakraIds,
        metrics: {},
        context: {
          source: "asana",
          launch_source: typeof params.launchSource === "string" ? params.launchSource : "",
          practice_kind: "yoga",
          vimeo_id: typeof params.vimeoId === "string" ? params.vimeoId : null,
          playback_mode: "tv",
          audiotrack: typeof params.audiotrack === "string" ? params.audiotrack : null,
        },
      });
    } catch {
      /* swallow — best-effort, still navigate away */
    }
  };

  const confirmFinish = async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      await remotePlay.stop().catch(() => null);
      await maybeRecordTvSession();
    } finally {
      setShowStopConfirm(false);
      setFinishing(false);
      router.back();
    }
  };

  const buildPracticeParams = () => ({
    vimeoId: typeof params.vimeoId === "string" ? params.vimeoId : "",
    title: typeof params.title === "string" ? params.title : "",
    durationSec: typeof params.durationSec === "string" ? params.durationSec : "",
    audiotrack: typeof params.audiotrack === "string" ? params.audiotrack : "",
    practiceId: typeof params.practiceId === "string" ? params.practiceId : "",
    slug: typeof params.slug === "string" ? params.slug : "",
    chakraIds: typeof params.chakraIds === "string" ? params.chakraIds : "",
    launchSource: typeof params.launchSource === "string" ? params.launchSource : "",
  });

  const disconnect = async () => {
    try {
      await remotePlay.disconnect();
      router.replace({ pathname: "/connect-tv", params: buildPracticeParams() });
    } catch (error) {
      Alert.alert(str.alertTitle, error instanceof Error ? error.message : str.disconnectFailed);
    }
  };

  return (
    <StackScreenLayout statusBarStyle="light">
      <FloatingCloseButton
        accessibilityLabel={str.closeA11y}
        onPress={requestStop}
      />
      <StackScrollView contentOptions={{ topPadding: 40, bottomPaddingExtra: 40, maxWidth: 720 }}>
        <SurfaceCardView tone="elevated" style={styles.card}>
          <View style={styles.header}>
            <AppText variant="technicalCaption" tone="muted">
              {str.meta(remotePlay.session?.pairing_code ?? str.idleCode)}
            </AppText>
            <AppText variant="screenTitle" accessibilityRole="header">
              {title}
            </AppText>
            <AppText variant="screenHint" tone="muted">
              {str.openOnTvHint}
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
                  ? str.durationMinutes(Math.max(1, Math.round(durationSec / 60)))
                  : str.durationUnknown}
              </AppText>
            </View>
          </View>

          <View style={[styles.statusPill, { borderColor: theme.colors.surfaceBorder }]}>
            <AppText variant="inlineStatus">{str.status(status)}</AppText>
          </View>

          <View style={styles.actions}>
            <AppButton
              label={
                status === "stopped"
                  ? str.replayButton
                  : status === "paused"
                    ? str.resumeButton
                    : str.pauseButton
              }
              onPress={status === "stopped" ? replay : pauseOrResume}
              disabled={!remotePlay.connected || remotePlay.busy}
              style={styles.actionButton}
            />
            <AppButton
              label={str.stopButton}
              variant="secondary"
              onPress={requestStop}
              disabled={!remotePlay.connected || remotePlay.busy || finishing}
              style={styles.actionButton}
            />
          </View>

          <AppButton
            label={str.disconnectButton}
            variant="secondary"
            onPress={disconnect}
            disabled={remotePlay.busy || finishing}
          />
        </SurfaceCardView>
      </StackScrollView>

      <PracticeStopConfirmDialog
        visible={showStopConfirm}
        title={stopConfirm.stopConfirmTitle}
        message={stopConfirm.stopConfirmMessage}
        continueLabel={stopConfirm.stopConfirmNo}
        finishLabel={finishing ? str.finishingButton : stopConfirm.stopConfirmYes}
        onContinue={() => setShowStopConfirm(false)}
        onFinish={confirmFinish}
      />
    </StackScreenLayout>
  );
}

const styles = StyleSheet.create({
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
