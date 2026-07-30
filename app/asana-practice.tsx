import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { AccountGateDialog, useAccess } from "@/modules/access";
import { useAuth } from "@/modules/auth";
import { useAppLocale } from "@/modules/i18n";
import {
  asanaCreditedDurationSec,
  asanaTargetDurationSec,
  asanaWatchedSec,
  isAsanaCompleted,
} from "@/modules/practices/core/asanaSessionCredit";
import { resolveYogaPracticeTitle } from "@/modules/practices/core/catalog";
import {
  vimeoAudiotrackForLocale,
  vimeoEmbedHtml,
  vimeoPhoneEmbedPageUrl,
  VIMEO_EMBED_BASE_URL,
} from "@/modules/practices/core/vimeo";
import { getAsanaScreenStrings } from "@/modules/practices/i18n/asanaScreen";
import { useAssistantPracticeOverlayDismiss } from "@/modules/practices/ui/useAssistantPracticeOverlayDismiss";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { FloatingCloseButton } from "@/modules/ui/FloatingCloseButton";
import { PracticeStopConfirmDialog } from "@/modules/ui/PracticeStopConfirmDialog";
import { ScreenHeader } from "@/modules/ui/ScreenHeader";
import { StackScreenLayout, StackScrollView } from "@/modules/ui/StackScreenLayout";
import { SurfaceCardView } from "@/modules/ui/SurfaceCardView";
import { useTheme } from "@/modules/ui/theme";
import { recordPracticeSession } from "@/services/practiceSessions";
import { getSupabase } from "@/services/supabase";
import type { Database } from "@/services/supabase-types";

type PracticeRow = Database["public"]["Tables"]["practices"]["Row"];
type ChakraRow = Database["public"]["Tables"]["practice_chakras"]["Row"];

type AsanaMetadata = {
  practice: PracticeRow;
  chakras: ChakraRow[];
};

function exitAfterPractice(launchSource: string) {
  const normalized = launchSource.trim().toLowerCase();
  if (normalized === "assistant" || normalized === "day") {
    router.replace("/day");
    return;
  }
  router.back();
}

export default function AsanaPracticeRoute() {
  const theme = useTheme();
  const { canUseFeature } = useAccess();
  const { authUser } = useAuth();
  const { locale } = useAppLocale();
  const strings = getAsanaScreenStrings(locale);
  const params = useLocalSearchParams<{
    practiceId?: string;
    durationMs?: string;
    chakra?: string;
    launchSource?: string;
    vimeoId?: string;
  }>();
  const [metadata, setMetadata] = useState<AsanaMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingCompletion, setSavingCompletion] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  // Vimeo → RN event bridge: elapsed seconds + ended flag from the WebView.
  const [elapsedSec, setElapsedSec] = useState(0);
  const [playerDurationSec, setPlayerDurationSec] = useState(0);
  const [practiceEnded, setPracticeEnded] = useState(false);
  const [wallTick, setWallTick] = useState(0);
  const [wallRunning, setWallRunning] = useState(false);
  const recordedRef = useRef(false);
  /** Wall-clock start (ms): first ready/play/time from the WebView player. */
  const wallStartedAtRef = useRef<number | null>(null);
  const practiceId = typeof params.practiceId === "string" ? params.practiceId : null;
  const launchSource = typeof params.launchSource === "string" && params.launchSource.trim()
    ? params.launchSource.trim()
    : "practice_screen";
  const routeVimeoId =
    typeof params.vimeoId === "string" && params.vimeoId.trim() ? params.vimeoId.trim() : null;
  useAssistantPracticeOverlayDismiss(launchSource);

  const routeDurationMinutes =
    typeof params.durationMs === "string" && Number.parseInt(params.durationMs, 10) > 0
      ? Math.round(Number.parseInt(params.durationMs, 10) / 60_000)
      : null;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!practiceId || !canUseFeature("asana_practices")) return;
      const supabase = getSupabase();
      if (!supabase) return;
      setLoading(true);
      setLoadError(null);
      try {
        const { data: practice, error } = await supabase
          .from("practices")
          .select("*")
          .eq("id", practiceId)
          .maybeSingle();
        if (error) throw error;
        if (!practice) throw new Error(strings.practiceNotFound);
        const { data: chakras, error: chakraError } = await supabase
          .from("practice_chakras")
          .select("*")
          .eq("practice_id", practice.id)
          .order("is_primary", { ascending: false });
        if (chakraError) throw chakraError;
        if (!cancelled) setMetadata({ practice, chakras: chakras ?? [] });
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : strings.loadFailed);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [canUseFeature, practiceId, strings.loadFailed, strings.practiceNotFound]);

  const practice = metadata?.practice ?? null;
  const title = practice
    ? resolveYogaPracticeTitle(practice.title, strings.defaultTitle, locale)
    : strings.defaultTitle;
  // Prefer catalog-passed id so Android/iOS can mount the player before Supabase returns.
  const vimeoId = (practice?.video_external_id?.trim() || routeVimeoId || null) as string | null;
  const audiotrack = vimeoAudiotrackForLocale(locale);
  const catalogDurationSec =
    practice?.default_duration_sec ?? (routeDurationMinutes ? routeDurationMinutes * 60 : 0);
  const targetDurationSec = asanaTargetDurationSec(catalogDurationSec, playerDurationSec);

  // Tick so completion can trip on wall-clock even when postMessage is silent.
  useEffect(() => {
    if (!wallRunning || practiceEnded) return;
    const id = setInterval(() => setWallTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [practiceEnded, wallRunning]);

  const wallElapsedSec =
    wallStartedAtRef.current != null
      ? Math.max(0, Math.floor((Date.now() - wallStartedAtRef.current) / 1000))
      : 0;
  // wallTick keeps this recalculating every second while the clock runs.
  void wallTick;
  const watchedSec = asanaWatchedSec(elapsedSec, wallElapsedSec);

  // Practice is considered completed when Vimeo fired `ended` OR watched time
  // (player or wall-clock) is within the closing tail.
  const completed = isAsanaCompleted({
    practiceEnded,
    watchedSec,
    targetDurationSec,
  });

  const ensureWallStarted = () => {
    if (wallStartedAtRef.current != null) return;
    wallStartedAtRef.current = Date.now();
    setWallRunning(true);
  };

  const handlePlayerMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as {
        type: string;
        seconds?: number;
      };
      if (data.type === "ready" || data.type === "play") {
        ensureWallStarted();
      } else if (data.type === "ended") {
        ensureWallStarted();
        setPracticeEnded(true);
      } else if (data.type === "time" && typeof data.seconds === "number") {
        ensureWallStarted();
        setElapsedSec(data.seconds);
      } else if (data.type === "duration" && typeof data.seconds === "number" && data.seconds > 0) {
        setPlayerDurationSec(data.seconds);
      }
    } catch {
      /* ignore malformed messages */
    }
  };

  const persistCompletedSession = async () => {
    if (!authUser?.id || !practice || recordedRef.current) return;
    recordedRef.current = true;
    const creditedSec = asanaCreditedDurationSec({
      // Seek-to-end still fires `ended` with low elapsed — credit full video length.
      watchedSec:
        practiceEnded && targetDurationSec > 0
          ? Math.max(watchedSec, targetDurationSec)
          : watchedSec,
      targetDurationSec,
    });
    const endedAt = Date.now();
    const startedAt = endedAt - Math.max(1, creditedSec) * 1000;
    const chakraIds =
      metadata?.chakras.map((item) => item.chakra_id).filter((item) => item >= 1 && item <= 7) ?? [];
    await recordPracticeSession({
      userId: authUser.id,
      practiceId: practice.id,
      practiceSlug: practice.slug,
      practiceVersion: practice.version ?? 1,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      completionPct: 100,
      chakraFocusIds: chakraIds,
      metrics: {},
      context: {
        source: "asana",
        launch_source: launchSource,
        practice_kind: "yoga",
        vimeo_id: vimeoId,
        playback_mode: "phone",
        audiotrack,
        watched_sec: watchedSec,
        target_duration_sec: targetDurationSec,
        credit_source: practiceEnded ? "vimeo_ended" : "watched_threshold",
      },
    });
  };

  // Auto-record once when the practice reaches the completed state, so the
  // session is captured even if the user just closes the screen without tapping
  // «Завершить». Best-effort.
  useEffect(() => {
    if (!completed || !practice || !authUser?.id || recordedRef.current) return;
    void persistCompletedSession().catch(() => {
      recordedRef.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: fire once on completed
  }, [completed, practice, authUser?.id]);

  const requestStop = () => {
    if (!practice || !authUser?.id || savingCompletion) return;
    if (completed) {
      void confirmFinish();
      return;
    }
    setShowStopConfirm(true);
  };

  const confirmFinish = async () => {
    if (!authUser?.id || !practice || savingCompletion) return;
    // Completed sessions were already recorded by the auto-record effect;
    // interrupted sessions are NOT recorded (asana stop dialog explains this).
    if (completed && !recordedRef.current) {
      setSavingCompletion(true);
      try {
        await persistCompletedSession();
      } catch {
        /* swallow — still navigate away */
      } finally {
        setSavingCompletion(false);
      }
    }
    setShowStopConfirm(false);
    exitAfterPractice(launchSource);
  };

  return (
    <StackScreenLayout statusBarStyle="light">
      <FloatingCloseButton accessibilityLabel={strings.closeA11y} onPress={requestStop} />
      <StackScrollView contentOptions={{ topPadding: 40, bottomPaddingExtra: 40, maxWidth: 720 }}>
        <SurfaceCardView tone="elevated" style={styles.card}>
          {loading && !vimeoId ? <ActivityIndicator color={theme.colors.accent} /> : null}
          <ScreenHeader title={title} />

          {loadError ? (
            <AppText variant="dialogBody" tone="warning">
              {loadError}
            </AppText>
          ) : null}

          <PhonePlayer
            vimeoId={vimeoId}
            audiotrack={audiotrack}
            loading={loading && !vimeoId}
            strings={strings}
            onMessage={handlePlayerMessage}
          />

          {completed ? (
            <View style={styles.completedBlock}>
              <AppText variant="sectionTitle" tone="accent">
                {strings.completedTitle}
              </AppText>
              <AppText variant="dialogBody" tone="muted">
                {strings.completedHint}
              </AppText>
              <AppButton
                label={strings.closeButton}
                onPress={confirmFinish}
                disabled={savingCompletion}
              />
            </View>
          ) : (
            <AppButton
              label={strings.completeButton}
              onPress={requestStop}
              disabled={!practice || !authUser?.id || savingCompletion}
            />
          )}
        </SurfaceCardView>
      </StackScrollView>

      <PracticeStopConfirmDialog
        visible={showStopConfirm}
        title={strings.stopConfirmTitle}
        message={strings.stopConfirmMessage}
        continueLabel={strings.stopConfirmNo}
        finishLabel={savingCompletion ? strings.completingButton : strings.stopConfirmYes}
        onContinue={() => setShowStopConfirm(false)}
        onFinish={confirmFinish}
      />

      <AccountGateDialog
        visible={!canUseFeature("asana_practices")}
        feature="asana_practices"
        onClose={() => router.back()}
      />
    </StackScreenLayout>
  );
}

function PhonePlayer({
  vimeoId,
  audiotrack,
  loading,
  strings,
  onMessage,
}: {
  vimeoId: string | null;
  audiotrack: string;
  loading: boolean;
  strings: ReturnType<typeof getAsanaScreenStrings>;
  onMessage: (event: WebViewMessageEvent) => void;
}) {
  const theme = useTheme();
  // Android prefers the hosted page; if it 404s (not uploaded yet), fall back to
  // html+baseUrl with originWhitelist "*". iOS always uses the proven html path.
  const [androidUseHtmlFallback, setAndroidUseHtmlFallback] = useState(false);

  if (loading) {
    return (
      <View style={[styles.playerPlaceholder, { borderColor: theme.colors.surfaceBorder }]}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }
  if (!vimeoId) {
    return (
      <View style={[styles.playerPlaceholder, { borderColor: theme.colors.surfaceBorder }]}>
        <AppText variant="dialogBody" tone="muted" style={styles.centerText}>
          {strings.phoneVideoMissing}
        </AppText>
      </View>
    );
  }

  const useAndroidHtml = Platform.OS === "android" && androidUseHtmlFallback;
  const source =
    Platform.OS === "android" && !useAndroidHtml
      ? { uri: vimeoPhoneEmbedPageUrl(vimeoId, audiotrack) }
      : { html: vimeoEmbedHtml(vimeoId, audiotrack), baseUrl: VIMEO_EMBED_BASE_URL };

  return (
    <View style={[styles.webViewWrap, { backgroundColor: "#000" }]}>
      <WebView
        key={useAndroidHtml ? `html-${vimeoId}` : `uri-${vimeoId}`}
        source={source}
        style={[styles.webView, Platform.OS === "android" ? styles.webViewAndroid : null]}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowsFullscreenVideo
        nestedScrollEnabled
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        androidLayerType="hardware"
        setSupportMultipleWindows={false}
        // Static HTML on Android needs "*"; never set this on iOS (Safari open regression).
        {...(useAndroidHtml ? { originWhitelist: ["*"] as const } : {})}
        onHttpError={(event) => {
          if (Platform.OS !== "android" || useAndroidHtml) return;
          const status = event.nativeEvent.statusCode;
          if (status >= 400) setAndroidUseHtmlFallback(true);
        }}
        onMessage={onMessage}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 16,
  },
  playerPlaceholder: {
    aspectRatio: 16 / 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
  },
  webViewWrap: {
    aspectRatio: 16 / 9,
    borderRadius: 16,
    overflow: "hidden",
  },
  webView: {
    flex: 1,
    backgroundColor: "#000",
  },
  webViewAndroid: {
    // Known Chromium/WebView glitch: solid black until opacity ≠ 1.
    opacity: 0.99,
  },
  centerText: {
    textAlign: "center",
  },
  completedBlock: {
    gap: 12,
  },
});
