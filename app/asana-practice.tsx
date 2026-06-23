import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { UpgradeDialog, requiredTierFor, useAccess } from "@/modules/access";
import { useAuth } from "@/modules/auth";
import { useAppLocale } from "@/modules/i18n";
import { resolveYogaPracticeTitle } from "@/modules/practices/core/catalog";
import { getAsanaScreenStrings } from "@/modules/practices/i18n/asanaScreen";
import { useAssistantPracticeOverlayDismiss } from "@/modules/practices/ui/useAssistantPracticeOverlayDismiss";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { FloatingCloseButton } from "@/modules/ui/FloatingCloseButton";
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

function paramsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function durationMinutes(seconds: number | null, formatMinutes: (minutes: number) => string): string {
  if (!seconds) return "";
  return formatMinutes(Math.max(1, Math.round(seconds / 60)));
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
  }>();
  const [metadata, setMetadata] = useState<AsanaMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingCompletion, setSavingCompletion] = useState(false);
  const [completionSaved, setCompletionSaved] = useState(false);
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
  }, [canUseFeature, practiceId]);

  const practice = metadata?.practice ?? null;
  const parsedParams = paramsRecord(practice?.params);
  const title = practice
    ? resolveYogaPracticeTitle(practice.title, strings.defaultTitle, locale)
    : strings.defaultTitle;
  const vimeoId = practice?.video_external_id ?? null;
  const chakraLabel =
    metadata?.chakras.length
      ? metadata.chakras.map((item) => item.chakra_id).join(", ")
      : params.chakra ?? strings.valueNotSelected;

  const completePractice = async () => {
    if (!authUser?.id || !practice || completionSaved || savingCompletion) return;
    setSavingCompletion(true);
    const durationSec = practice.default_duration_sec ?? (routeDurationMinutes ? routeDurationMinutes * 60 : 0);
    const endedAt = Date.now();
    const startedAt = endedAt - Math.max(1, durationSec) * 1000;
    const chakraIds = metadata?.chakras.map((item) => item.chakra_id).filter((item) => item >= 1 && item <= 7) ?? [];
    const savedId = await recordPracticeSession({
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
      },
    });
    setCompletionSaved(Boolean(savedId));
    setSavingCompletion(false);
  };

  return (
    <StackScreenLayout statusBarStyle="light">
      <FloatingCloseButton
        accessibilityLabel={strings.closeA11y}
        onPress={() => router.back()}
      />
      <StackScrollView contentOptions={{ topPadding: 40, bottomPaddingExtra: 40, maxWidth: 720 }}>
        <SurfaceCardView tone="elevated" style={styles.card}>
          {loading ? <ActivityIndicator color={theme.colors.accent} /> : null}
          <ScreenHeader title={title} subtitle={strings.unavailableNote} />

          {loadError ? (
            <AppText variant="dialogBody" tone="warning">
              {loadError}
            </AppText>
          ) : null}

          {vimeoId && canUseFeature("asana_practices") ? (
            <View style={[styles.playerPlaceholder, { borderColor: theme.colors.surfaceBorder }]}>
              <AppText variant="sectionTitle">{strings.videoReadyTitle}</AppText>
              <AppText variant="dialogBody" tone="muted">
                {strings.metaVimeoId}: {vimeoId}
              </AppText>
            </View>
          ) : null}

          <View style={styles.metaBlock}>
            <MetaRow label={strings.metaPracticeId} value={practiceId ?? strings.valueUnknown} />
            <MetaRow label={strings.metaVimeoId} value={vimeoId ?? strings.valueUnknown} />
            <MetaRow
              label={strings.metaDuration}
              value={
                practice
                  ? durationMinutes(practice.default_duration_sec, strings.formatDurationMinutes) || strings.valueUnknown
                  : routeDurationMinutes
                    ? strings.formatDurationMinutes(routeDurationMinutes)
                    : strings.valueUnknown
              }
            />
            <MetaRow label={strings.metaChakras} value={chakraLabel} />
            {typeof parsedParams.recorded_at === "string" ? (
              <MetaRow label={strings.metaRecordedAt} value={parsedParams.recorded_at} />
            ) : null}
            <MetaRow label={strings.metaLaunchSource} value={launchSource} />
          </View>

          <View style={styles.actionRow}>
            <AppButton
              label={
                completionSaved
                  ? strings.completedButton
                  : savingCompletion
                    ? strings.completingButton
                    : strings.completeButton
              }
              onPress={completePractice}
              disabled={!practice || !authUser?.id || completionSaved || savingCompletion}
            />
            <AppButton label={strings.backToCatalogButton} variant="secondary" onPress={() => router.back()} />
          </View>
        </SurfaceCardView>
      </StackScrollView>
      <UpgradeDialog
        visible={!canUseFeature("asana_practices")}
        feature="asana_practices"
        requiredTier={requiredTierFor("asana_practices")}
        onClose={() => router.back()}
      />
    </StackScreenLayout>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <AppText variant="technicalCaption" tone="muted" style={styles.metaLabel}>
        {label}
      </AppText>
      <AppText variant="dialogBody">{value}</AppText>
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
  metaBlock: {
    gap: 8,
  },
  actionRow: {
    alignItems: "flex-start",
    gap: 10,
  },
  metaRow: {
    gap: 2,
  },
  metaLabel: {
    textTransform: "uppercase",
  },
});
