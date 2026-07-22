import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";

import { useAuth } from "@/modules/auth";
import { useAppLocale } from "@/modules/i18n";
import { getCoherenceBreathStrings } from "@/modules/breath/i18n/coherence";
import { tvPageUrl } from "@/modules/remote-play/core/tvPageUrl";
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

type PendingFinishAction = "stop" | "disconnect";

// Practice counts as completed if watched to within this many seconds of the end
// (covers users who close the tab during the closing remarks).
const COMPLETION_TAIL_SEC = 10;

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
    tvUrl: strings?.tvUrl || tvPageUrl(locale),
    openOnTvCaption:
      strings?.openOnTvCaption ||
      "Откройте эту страницу на вашем телевизоре или компьютере",
    durationUnknown: strings?.durationUnknown || "Длительность уточняется",
    durationMinutes: durationMinutesFn,
    status: statusFn,
    pauseButton: strings?.pauseButton || "Пауза",
    resumeButton: strings?.resumeButton || "Продолжить",
    replayButton: strings?.replayButton || "Запустить заново",
    stopButton: strings?.stopButton || "Стоп",
    disconnectButton: strings?.disconnectButton || "Отключить ТВ",
    finishingButton: strings?.finishingButton || "Завершаем…",
    connectionLostTitle: strings?.connectionLostTitle || "Связь с ТВ потеряна",
    connectionLostHint:
      strings?.connectionLostHint ||
      "Вкладка браузера закрыта или ТВ выключен. Подключите ТВ заново и запустите практику повторно.",
    reconnectButton: strings?.reconnectButton || "Подключить ТВ заново",
    tvStoppedHint:
      strings?.tvStoppedHint ||
      "Практика на ТВ остановлена. Откройте страницу на телевизоре и нажмите «Запустить заново». Если открыли новую вкладку — подключите ТВ заново.",
    completedTitle: strings?.completedTitle || "Практика завершена",
    completedHint:
      strings?.completedHint ||
      "Поздравляем — практика засчитана. Закройте окно, чтобы вернуться назад.",
    closeButton: strings?.closeButton || "Закрыть",
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
  const [pendingAction, setPendingAction] = useState<PendingFinishAction | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [connectionLost, setConnectionLost] = useState(false);

  // Track whether we ever had a live session on this screen, so we can detect
  // the connected → null transition (browser tab closed / TV turned off) and
  // surface a "reconnect" state instead of leaving the user on a dead remote.
  const wasConnectedRef = useRef(false);
  // Guards maybeRecordTvSession so a completed practice is recorded exactly once
  // even if both the connection-loss effect and the confirm dialog fire.
  const recordedRef = useRef(false);

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

  // Record a practice_sessions row ONLY if the practice effectively reached the
  // end (elapsed >= duration - 10s, i.e. within the closing tail). Best-effort —
  // swallowed on error. Early interruption does NOT record.
  const maybeRecordTvSession = useCallback(async () => {
    if (recordedRef.current) return;
    const userId = authUser?.id;
    const practiceId = typeof params.practiceId === "string" ? params.practiceId.trim() : "";
    if (!userId || !practiceId || !durationSec) return;
    if (elapsedSec < durationSec - COMPLETION_TAIL_SEC) return;
    recordedRef.current = true;
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
  }, [authUser?.id, durationSec, elapsedSec, params]);

  // Detect connection loss: we had a session, then it became null (explicit
  // unlink, stale cleanup, or session closed after linking a new TV code).
  // Tab close now PATCHes status="stopped" (not "closed"), so the phone stays
  // paired and shows the replay / reconnect panel instead of this state.
  useEffect(() => {
    if (remotePlay.session) {
      wasConnectedRef.current = true;
      if (connectionLost) setConnectionLost(false);
      return;
    }
    if (!wasConnectedRef.current) return;
    setConnectionLost(true);
    void maybeRecordTvSession();
  }, [connectionLost, maybeRecordTvSession, remotePlay.session]);

  // Tab close PATCHes status="stopped" — if the user was within the closing
  // tail, count the practice as completed even without pressing «Завершить».
  useEffect(() => {
    if (remotePlay.session?.status !== "stopped") return;
    void maybeRecordTvSession();
  }, [maybeRecordTvSession, remotePlay.session?.status]);

  // Auto-record as soon as the elapsed timer crosses the completion threshold
  // (even while still "playing") so a tab-close at the very end still counts.
  useEffect(() => {
    if (!durationSec || elapsedSec < durationSec - COMPLETION_TAIL_SEC) return;
    void maybeRecordTvSession();
  }, [durationSec, elapsedSec, maybeRecordTvSession]);

  const progress = durationSec ? Math.min(1, elapsedSec / durationSec) : 0;
  const status = remotePlay.session?.status ?? "waiting";
  // Practice counts as completed when the timer reached the closing tail.
  // In that state ✕ / «Завершить» / «Отключить ТВ» skip the stop-confirm dialog
  // and just close (session was already auto-recorded).
  const completed = Boolean(durationSec && elapsedSec >= durationSec - COMPLETION_TAIL_SEC);

  const finishAndExit = useCallback(async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      await remotePlay.stop().catch(() => null);
      await maybeRecordTvSession();
    } finally {
      setFinishing(false);
      router.back();
    }
  }, [finishing, maybeRecordTvSession, remotePlay]);

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
      recordedRef.current = false;
      setConnectionLost(false);
      await remotePlay.playVimeo(params.vimeoId, params.audiotrack);
    } catch (error) {
      Alert.alert(str.alertTitle, error instanceof Error ? error.message : str.replayFailed);
    }
  };

  const requestStop = () => {
    if (remotePlay.busy || finishing) return;
    if (completed) {
      void finishAndExit();
      return;
    }
    setPendingAction("stop");
    setShowStopConfirm(true);
  };

  const requestDisconnect = () => {
    if (remotePlay.busy || finishing) return;
    if (completed) {
      // Completed — drop pairing without the stop-confirm warning.
      void (async () => {
        setFinishing(true);
        try {
          await remotePlay.stop().catch(() => null);
          await maybeRecordTvSession();
          await remotePlay.disconnect().catch(() => null);
          router.replace({ pathname: "/connect-tv", params: buildPracticeParams() });
        } finally {
          setFinishing(false);
        }
      })();
      return;
    }
    setPendingAction("disconnect");
    setShowStopConfirm(true);
  };

  const dismissConfirm = () => {
    setShowStopConfirm(false);
    setPendingAction(null);
  };

  // «Завершить» from the confirm dialog — routes by pendingAction.
  // stop: stop playback + record (if completed) + leave TV paired → back.
  // disconnect: stop + record (if completed) + drop pairing → /connect-tv.
  const confirmFinish = async () => {
    if (finishing) return;
    const action = pendingAction ?? "stop";
    setFinishing(true);
    try {
      await remotePlay.stop().catch(() => null);
      await maybeRecordTvSession();
      if (action === "disconnect") {
        await remotePlay.disconnect().catch(() => null);
        router.replace({ pathname: "/connect-tv", params: buildPracticeParams() });
        return;
      }
    } finally {
      setShowStopConfirm(false);
      setPendingAction(null);
      setFinishing(false);
      if (action !== "disconnect") router.back();
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

  const reconnect = () => {
    router.replace({ pathname: "/connect-tv", params: buildPracticeParams() });
  };

  return (
    <StackScreenLayout statusBarStyle="light">
      <FloatingCloseButton
        accessibilityLabel={str.closeA11y}
        onPress={connectionLost ? () => router.back() : completed ? () => void finishAndExit() : requestStop}
      />
      <StackScrollView contentOptions={{ topPadding: 40, bottomPaddingExtra: 40, maxWidth: 720 }}>
        <SurfaceCardView tone="elevated" style={styles.card}>
          <View style={styles.header}>
            <AppText variant="technicalCaption" tone="muted">
              {str.meta(remotePlay.session?.pairing_code ?? str.idleCode)}
            </AppText>
            <AppText variant="dialogTitle" accessibilityRole="header">
              {title}
            </AppText>
            <AppText variant="screenTitle" style={styles.tvUrl}>
              {str.tvUrl}
            </AppText>
            <AppText variant="screenHint" tone="muted">
              {str.openOnTvCaption}
            </AppText>
          </View>

          {connectionLost ? (
            <View style={styles.lostBlock}>
              <AppText variant="sectionTitle" tone="warning">
                {str.connectionLostTitle}
              </AppText>
              <AppText variant="dialogBody" tone="muted">
                {str.connectionLostHint}
              </AppText>
              <AppButton label={str.reconnectButton} onPress={reconnect} />
            </View>
          ) : completed ? (
            <View style={styles.lostBlock}>
              <AppText variant="sectionTitle" tone="accent">
                {str.completedTitle}
              </AppText>
              <AppText variant="dialogBody" tone="muted">
                {str.completedHint}
              </AppText>
              <AppButton label={str.closeButton} onPress={() => void finishAndExit()} disabled={finishing} />
            </View>
          ) : (
            <>
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

              {status === "stopped" ? (
                <AppText variant="screenHint" tone="muted">
                  {str.tvStoppedHint}
                </AppText>
              ) : null}

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

              {status === "stopped" ? (
                <AppButton label={str.reconnectButton} variant="secondary" onPress={reconnect} />
              ) : null}

              <AppButton
                label={str.disconnectButton}
                variant="secondary"
                onPress={requestDisconnect}
                disabled={remotePlay.busy || finishing}
              />
            </>
          )}
        </SurfaceCardView>
      </StackScrollView>

      <PracticeStopConfirmDialog
        visible={showStopConfirm}
        title={stopConfirm.stopConfirmTitle}
        message={stopConfirm.stopConfirmMessage}
        continueLabel={stopConfirm.stopConfirmNo}
        finishLabel={finishing ? str.finishingButton : stopConfirm.stopConfirmYes}
        onContinue={dismissConfirm}
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
  tvUrl: {
    marginTop: 4,
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
  lostBlock: {
    gap: 14,
  },
});
