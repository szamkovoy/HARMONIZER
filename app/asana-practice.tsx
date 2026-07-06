import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { UpgradeDialog, requiredTierFor, useAccess } from "@/modules/access";
import { useAuth } from "@/modules/auth";
import { getCoherenceBreathStrings } from "@/modules/breath/i18n/coherence";
import { useAppLocale } from "@/modules/i18n";
import { resolveYogaPracticeTitle } from "@/modules/practices/core/catalog";
import { vimeoAudiotrackForLocale, vimeoEmbedHtml, VIMEO_EMBED_BASE_URL } from "@/modules/practices/core/vimeo";
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

// Practice counts as completed if watched to within this many seconds of the end
// (covers users who close the screen during the closing remarks).
const COMPLETION_TAIL_SEC = 10;

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
  const stopConfirm = getCoherenceBreathStrings(locale);
  const params = useLocalSearchParams<{
    practiceId?: string;
    durationMs?: string;
    chakra?: string;
    launchSource?: string;
  }>();
  const [metadata, setMetadata] = useState<AsanaMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingCompletion, setSavingCompletion] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  // Vimeo → RN event bridge: elapsed seconds + ended flag from the WebView.
  const [elapsedSec, setElapsedSec] = useState(0);
  const [practiceEnded, setPracticeEnded] = useState(false);
  const recordedRef = useRef(false);
  const practiceId = typeof params.practiceId === "string" ? params.practiceId : null;
  const launchSource = typeof params.launchSource === "string" && params.launchSource.trim()
    ? params.launchSource.trim()
    : "practice_screen";
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
  const vimeoId = practice?.video_external_id ?? null;
  const audiotrack = vimeoAudiotrackForLocale(locale);
  const durationSec =
    practice?.default_duration_sec ?? (routeDurationMinutes ? routeDurationMinutes * 60 : 0);

  // Practice is considered completed when Vimeo fired `ended` OR the elapsed
  // timer is within the closing tail (<= 10s left). In that state ✕ / «Завершить»
  // skip the stop-confirm dialog and just record + exit.
  const completed =
    practiceEnded || (durationSec > 0 && elapsedSec >= durationSec - COMPLETION_TAIL_SEC);

  const handlePlayerMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as { type: string; seconds?: number };
      if (data.type === "ended") {
        setPracticeEnded(true);
      } else if (data.type === "time" && typeof data.seconds === "number") {
        setElapsedSec(data.seconds);
      }
    } catch {
      /* ignore malformed messages */
    }
  };

  // Auto-record once when the practice reaches the completed state, so the
  // session is captured even if the user just closes the screen without tapping
  // «Завершить». Best-effort.
  useEffect(() => {
    if (!completed || !practice || !authUser?.id || recordedRef.current) return;
    recordedRef.current = true;
    const effectiveDurationSec = durationSec || elapsedSec || 0;
    const endedAt = Date.now();
    const startedAt = endedAt - Math.max(1, effectiveDurationSec) * 1000;
    const chakraIds = metadata?.chakras.map((item) => item.chakra_id).filter((item) => item >= 1 && item <= 7) ?? [];
    void recordPracticeSession({
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
      },
    }).catch(() => {});
  }, [audiotrack, authUser?.id, completed, durationSec, elapsedSec, launchSource, metadata?.chakras, practice, vimeoId]);

  const requestStop = () => {
    if (!practice || !authUser?.id || savingCompletion) return;
    if (completed) {
      // Already finished (or within the closing tail) — no warning, just close.
      void confirmFinish();
      return;
    }
    setShowStopConfirm(true);
  };

  const confirmFinish = async () => {
    if (!authUser?.id || !practice || savingCompletion) return;
    // Completed sessions were already recorded by the auto-record effect;
    // interrupted sessions are NOT recorded (the warning told the user their
    // progress wouldn't be saved).
    if (completed && !recordedRef.current) {
      // Fallback: record if auto-record somehow missed it.
      setSavingCompletion(true);
      try {
        const effectiveDurationSec = durationSec || elapsedSec || 0;
        const endedAt = Date.now();
        const startedAt = endedAt - Math.max(1, effectiveDurationSec) * 1000;
        const chakraIds = metadata?.chakras.map((item) => item.chakra_id).filter((item) => item >= 1 && item <= 7) ?? [];
        recordedRef.current = true;
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
          },
        });
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
          {loading ? <ActivityIndicator color={theme.colors.accent} /> : null}
          <ScreenHeader title={title} />

          {loadError ? (
            <AppText variant="dialogBody" tone="warning">
              {loadError}
            </AppText>
          ) : null}

          <PhonePlayer
            vimeoId={vimeoId}
            audiotrack={audiotrack}
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
        title={stopConfirm.stopConfirmTitle}
        message={stopConfirm.stopConfirmMessage}
        continueLabel={stopConfirm.stopConfirmNo}
        finishLabel={savingCompletion ? strings.completingButton : stopConfirm.stopConfirmYes}
        onContinue={() => setShowStopConfirm(false)}
        onFinish={confirmFinish}
      />

      <UpgradeDialog
        visible={!canUseFeature("asana_practices")}
        feature="asana_practices"
        requiredTier={requiredTierFor("asana_practices")}
        onClose={() => router.back()}
      />
    </StackScreenLayout>
  );
}

function PhonePlayer({
  vimeoId,
  audiotrack,
  strings,
  onMessage,
}: {
  vimeoId: string | null;
  audiotrack: string;
  strings: ReturnType<typeof getAsanaScreenStrings>;
  onMessage: (event: WebViewMessageEvent) => void;
}) {
  const theme = useTheme();
  if (!vimeoId) {
    return (
      <View style={[styles.playerPlaceholder, { borderColor: theme.colors.surfaceBorder }]}>
        <AppText variant="dialogBody" tone="muted" style={styles.centerText}>
          {strings.phoneVideoMissing}
        </AppText>
      </View>
    );
  }
  return (
    <View style={[styles.webViewWrap, { backgroundColor: "#000" }]}>
      <WebView
        source={{ html: vimeoEmbedHtml(vimeoId, audiotrack), baseUrl: VIMEO_EMBED_BASE_URL }}
        style={styles.webView}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowsFullscreenVideo
        nestedScrollEnabled
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
  },
  centerText: {
    textAlign: "center",
  },
  completedBlock: {
    gap: 12,
  },
});
