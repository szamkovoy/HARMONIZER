import { router, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { UpgradeDialog, requiredTierFor, useAccess } from "@/modules/access";
import { useAuth } from "@/modules/auth";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
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

function localizedText(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object") {
    const record = value as { ru?: unknown; en?: unknown };
    if (typeof record.ru === "string" && record.ru.trim()) return record.ru.trim();
    if (typeof record.en === "string" && record.en.trim()) return record.en.trim();
  }
  return fallback;
}

function paramsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function durationMinutes(seconds: number | null): string {
  if (!seconds) return "уточняется";
  return `${Math.max(1, Math.round(seconds / 60))} мин`;
}

export default function AsanaPracticeRoute() {
  const theme = useTheme();
  const { canUseFeature } = useAccess();
  const { authUser } = useAuth();
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
        if (!practice) throw new Error("Практика не найдена.");
        const { data: chakras, error: chakraError } = await supabase
          .from("practice_chakras")
          .select("*")
          .eq("practice_id", practice.id)
          .order("is_primary", { ascending: false });
        if (chakraError) throw chakraError;
        if (!cancelled) setMetadata({ practice, chakras: chakras ?? [] });
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Не удалось загрузить практику.");
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
  const title = practice ? localizedText(practice.title, "Практика асан") : "Практика асан";
  const vimeoId = practice?.video_external_id ?? null;
  const chakraLabel =
    metadata?.chakras.length
      ? metadata.chakras.map((item) => item.chakra_id).join(", ")
      : params.chakra ?? "не выбрана";

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
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Закрыть практику"
        onPress={() => router.back()}
        style={({ pressed }) => [
          styles.floatingClose,
          {
            backgroundColor: theme.colors.controlButtonBg,
            opacity: pressed ? 0.72 : 1,
          },
        ]}
        hitSlop={12}
      >
        <AppText variant="sectionTitle">×</AppText>
      </Pressable>
      <ScrollView contentContainerStyle={styles.content}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.surfaceElevated,
              borderColor: theme.colors.surfaceBorder,
            },
          ]}
        >
          {loading ? <ActivityIndicator color={theme.colors.accent} /> : null}
          <AppText variant="screenTitle" accessibilityRole="header">
            {title}
          </AppText>
          <AppText variant="screenHint" tone="muted">
            Локальный Vimeo-плеер временно отключён: текущий dev-client не содержит native WebView-модуль.
            Следующий шаг — запуск асан через Remote Play на большом экране.
          </AppText>

          {loadError ? (
            <AppText variant="dialogBody" tone="warning">
              {loadError}
            </AppText>
          ) : null}

          {vimeoId && canUseFeature("asana_practices") ? (
            <View style={[styles.playerPlaceholder, { borderColor: theme.colors.surfaceBorder }]}>
              <AppText variant="sectionTitle">Видео готово к удалённому запуску</AppText>
              <AppText variant="dialogBody" tone="muted">
                Vimeo ID: {vimeoId}
              </AppText>
            </View>
          ) : null}

          <View style={styles.metaBlock}>
            <MetaRow label="practiceId" value={practiceId ?? "не передан"} />
            <MetaRow label="Vimeo ID" value={vimeoId ?? "уточняется"} />
            <MetaRow label="Длительность" value={practice ? durationMinutes(practice.default_duration_sec) : routeDurationMinutes ? `${routeDurationMinutes} мин` : "уточняется"} />
            <MetaRow label="Чакры" value={chakraLabel} />
            {typeof parsedParams.recorded_at === "string" ? <MetaRow label="Дата записи" value={parsedParams.recorded_at} /> : null}
            <MetaRow label="Источник запуска" value={launchSource} />
          </View>

          <View style={styles.actionRow}>
            <AppButton
              label={completionSaved ? "Практика сохранена" : savingCompletion ? "Сохраняем..." : "Завершить практику"}
              onPress={completePractice}
              disabled={!practice || !authUser?.id || completionSaved || savingCompletion}
            />
            <AppButton label="Назад к каталогу" variant="secondary" onPress={() => router.back()} />
          </View>
        </View>
      </ScrollView>
      <UpgradeDialog
        visible={!canUseFeature("asana_practices")}
        feature="asana_practices"
        requiredTier={requiredTierFor("asana_practices")}
        onClose={() => router.back()}
      />
    </SafeAreaView>
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
  safeArea: {
    flex: 1,
    backgroundColor: "#000000",
  },
  content: {
    padding: 20,
    flexGrow: 1,
    justifyContent: "center",
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 24,
    padding: 20,
    gap: 16,
  },
  floatingClose: {
    position: "absolute",
    top: 54,
    right: 18,
    zIndex: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  playerPlaceholder: {
    aspectRatio: 16 / 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    backgroundColor: "#000000",
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
