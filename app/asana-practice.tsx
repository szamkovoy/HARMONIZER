import { router, useLocalSearchParams } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";

import { UpgradeDialog, requiredTierFor, useAccess } from "@/modules/access";
import { useAuth } from "@/modules/auth";
import { getCoherenceBreathStrings } from "@/modules/breath/i18n/coherence";
import { useAppLocale } from "@/modules/i18n";
import { resolveYogaPracticeTitle } from "@/modules/practices/core/catalog";
import { vimeoAudiotrackForLocale, vimeoEmbedHtml, VIMEO_EMBED_BASE_URL } from "@/modules/practices/core/vimeo";
import { getAsanaScreenStrings, type AsanaPlaybackMode } from "@/modules/practices/i18n/asanaScreen";
import { useAssistantPracticeOverlayDismiss } from "@/modules/practices/ui/useAssistantPracticeOverlayDismiss";
import { useRemotePlay } from "@/modules/remote-play";
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

const MODE_STORAGE_KEY = "harmonizer.asana.playback_mode.v1";

function readStoredMode(): AsanaPlaybackMode | null {
  if (Platform.OS === "web") return null;
  try {
    const raw = SecureStore.getItem(MODE_STORAGE_KEY);
    return raw === "tv" || raw === "phone" ? raw : null;
  } catch {
    return null;
  }
}

function writeStoredMode(mode: AsanaPlaybackMode) {
  if (Platform.OS === "web") return;
  try {
    SecureStore.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    /* ignore — UI preference is non-critical */
  }
}

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
  const remotePlay = useRemotePlay();
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
  const [mode, setMode] = useState<AsanaPlaybackMode>("phone");
  const [modeHydrated, setModeHydrated] = useState(false);
  const [launchingTv, setLaunchingTv] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
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
    const stored = readStoredMode();
    if (stored) setMode(stored);
    setModeHydrated(true);
  }, []);

  useEffect(() => {
    if (!modeHydrated) return;
    writeStoredMode(mode);
  }, [mode, modeHydrated]);

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

  const requestStop = () => {
    if (!practice || !authUser?.id || savingCompletion) return;
    setShowStopConfirm(true);
  };

  const confirmFinish = async () => {
    if (!authUser?.id || !practice || savingCompletion) return;
    setSavingCompletion(true);
    try {
      const effectiveDurationSec = durationSec || 0;
      const endedAt = Date.now();
      const startedAt = endedAt - Math.max(1, effectiveDurationSec) * 1000;
      const chakraIds = metadata?.chakras.map((item) => item.chakra_id).filter((item) => item >= 1 && item <= 7) ?? [];
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
          playback_mode: mode,
          audiotrack,
        },
      });
    } catch {
      /* swallow — still navigate away; the session row is best-effort */
    } finally {
      setSavingCompletion(false);
      setShowStopConfirm(false);
      exitAfterPractice(launchSource);
    }
  };

  const launchOnTv = async () => {
    if (!vimeoId || launchingTv || remotePlay.busy) return;
    if (!remotePlay.connected) {
      router.push("/connect-tv");
      return;
    }
    setLaunchingTv(true);
    try {
      await remotePlay.playVimeo(vimeoId, audiotrack);
      router.push({
        pathname: "/tv-remote",
        params: {
          title,
          ...(durationSec > 0 ? { durationSec: String(durationSec) } : {}),
        },
      } as never);
    } catch (error) {
      Alert.alert("Remote Play", error instanceof Error ? error.message : strings.loadFailed);
    } finally {
      setLaunchingTv(false);
    }
  };

  const openRemote = () => {
    router.push({
      pathname: "/tv-remote",
      params: {
        title,
        ...(durationSec > 0 ? { durationSec: String(durationSec) } : {}),
      },
    } as never);
  };

  const tvStatus = remotePlay.session?.status ?? "waiting";
  const hasActiveTvVideo = Boolean(remotePlay.session?.vimeo_id);

  return (
    <StackScreenLayout statusBarStyle="light">
      <FloatingCloseButton accessibilityLabel={strings.closeA11y} onPress={requestStop} />
      <StackScrollView contentOptions={{ topPadding: 40, bottomPaddingExtra: 40, maxWidth: 720 }}>
        <SurfaceCardView tone="elevated" style={styles.card}>
          {loading ? <ActivityIndicator color={theme.colors.accent} /> : null}
          <ScreenHeader title={title} subtitle={strings.subtitle} />

          {loadError ? (
            <AppText variant="dialogBody" tone="warning">
              {loadError}
            </AppText>
          ) : null}

          <ModeSegmented
            mode={mode}
            onChange={setMode}
            phoneLabel={strings.modePhone}
            tvLabel={strings.modeTv}
          />

          {mode === "phone" ? (
            <PhonePlayer vimeoId={vimeoId} audiotrack={audiotrack} strings={strings} />
          ) : (
            <TvPanel
              strings={strings}
              vimeoId={vimeoId}
              connected={remotePlay.connected}
              loading={remotePlay.loading}
              busy={remotePlay.busy || launchingTv}
              pairingCode={remotePlay.session?.pairing_code ?? null}
              status={tvStatus}
              hasActiveVideo={hasActiveTvVideo}
              error={remotePlay.error}
              onConnect={() => router.push("/connect-tv")}
              onLaunch={launchOnTv}
              onOpenRemote={openRemote}
            />
          )}

          <AppButton
            label={strings.completeButton}
            onPress={requestStop}
            disabled={!practice || !authUser?.id || savingCompletion}
          />
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

function ModeSegmented({
  mode,
  onChange,
  phoneLabel,
  tvLabel,
}: {
  mode: AsanaPlaybackMode;
  onChange: (next: AsanaPlaybackMode) => void;
  phoneLabel: string;
  tvLabel: string;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.segmentTrack,
        { backgroundColor: theme.colors.controlButtonBg, borderColor: theme.colors.surfaceBorder },
      ]}
    >
      {(["phone", "tv"] as const).map((value) => {
        const active = value === mode;
        return (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(value)}
            style={[
              styles.segment,
              active
                ? { backgroundColor: theme.colors.buttonPrimaryBg }
                : { backgroundColor: "transparent" },
            ]}
          >
            <AppText variant="buttonLabel" tone={active ? "accentOn" : "primary"}>
              {value === "phone" ? phoneLabel : tvLabel}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

function PhonePlayer({
  vimeoId,
  audiotrack,
  strings,
}: {
  vimeoId: string | null;
  audiotrack: string;
  strings: ReturnType<typeof getAsanaScreenStrings>;
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
      />
    </View>
  );
}

function TvPanel({
  strings,
  vimeoId,
  connected,
  loading,
  busy,
  pairingCode,
  status,
  hasActiveVideo,
  error,
  onConnect,
  onLaunch,
  onOpenRemote,
}: {
  strings: ReturnType<typeof getAsanaScreenStrings>;
  vimeoId: string | null;
  connected: boolean;
  loading: boolean;
  busy: boolean;
  pairingCode: string | null;
  status: string;
  hasActiveVideo: boolean;
  error: string | null;
  onConnect: () => void;
  onLaunch: () => void;
  onOpenRemote: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.tvPanel, { borderColor: theme.colors.surfaceBorder }]}>
      {loading ? <ActivityIndicator color={theme.colors.accent} /> : null}

      {!connected ? (
        <>
          <AppText variant="sectionTitle">{strings.videoReadyTitle}</AppText>
          <AppText variant="dialogBody" tone="muted">
            {strings.tvNotConnectedHint}
          </AppText>
        </>
      ) : (
        <>
          <AppText variant="sectionTitle" tone="accent">
            {pairingCode ? strings.tvConnectedMeta(pairingCode) : strings.tvConnectedHint}
          </AppText>
          <AppText variant="dialogBody" tone="muted">
            {strings.tvConnectedHint}
          </AppText>
          <View style={[styles.statusPill, { borderColor: theme.colors.surfaceBorder }]}>
            <AppText variant="inlineStatus">{strings.tvStatus(status)}</AppText>
          </View>
        </>
      )}

      {error ? (
        <AppText variant="dialogBody" tone="warning">
          {error}
        </AppText>
      ) : null}

      <View style={styles.tvActions}>
        {!connected ? (
          <AppButton label={strings.connectTvButton} onPress={onConnect} />
        ) : (
          <>
            <AppButton
              label={busy ? strings.launchingButton : strings.launchOnTvButton}
              onPress={onLaunch}
              disabled={busy || !vimeoId}
            />
            {hasActiveVideo ? (
              <AppButton label={strings.openRemoteButton} variant="secondary" onPress={onOpenRemote} />
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 16,
  },
  segmentTrack: {
    flexDirection: "row",
    padding: 4,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
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
  tvPanel: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  statusPill: {
    alignSelf: "flex-start",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  tvActions: {
    alignItems: "stretch",
    gap: 10,
    marginTop: 4,
  },
  centerText: {
    textAlign: "center",
  },
});
