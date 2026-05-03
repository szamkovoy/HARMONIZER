import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, type Href } from "expo-router";

import { UpgradeDialog, requiredTierFor, useAccess, type FeatureKey } from "@/modules/access";
import { isChakra, type Chakra } from "@/modules/breath";
import { filterPractices, loadPracticeCatalog } from "@/modules/practices/core/catalog";
import type { PracticeCatalog, PracticeDurationBucket, PracticeKind, PracticeSummary } from "@/modules/practices/core/types";
import { PRACTICE_GROUPS } from "@/modules/practices/core/types";
import { useRemotePlay } from "@/modules/remote-play";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { logRuntimeEvent, logRuntimeTap } from "@/services/runtimeDiagnostics";

import { PracticeCard } from "./PracticeCard";
import { launchPractice } from "./launchPractice";

type CatalogState =
  | { status: "loading"; catalog: null; error: null }
  | { status: "ready"; catalog: PracticeCatalog; error: null }
  | { status: "error"; catalog: PracticeCatalog; error: string };

const EMPTY_CATALOG: PracticeCatalog = {
  meditation: [],
  breath: [],
  yoga: [],
};

const CHAKRA_FILTERS: Array<{ value: Chakra | "any"; label: string }> = [
  { value: "any", label: "Все чакры" },
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: 4, label: "4" },
  { value: 5, label: "5" },
  { value: 6, label: "6" },
  { value: 7, label: "7" },
];

const DURATION_FILTERS: Array<{ value: PracticeDurationBucket; label: string }> = [
  { value: "any", label: "Любая длительность" },
  { value: "short", label: "20-30 минут" },
  { value: "medium", label: "30-45 минут" },
  { value: "long", label: "45-60 минут" },
];

function totalCount(catalog: PracticeCatalog): number {
  return catalog.meditation.length + catalog.breath.length + catalog.yoga.length;
}

export function PracticeCatalogScreen() {
  const theme = useTheme();
  const { canUseFeature } = useAccess();
  const remotePlay = useRemotePlay();
  const [selectedKind, setSelectedKind] = useState<PracticeKind>("meditation");
  const [chakraFilter, setChakraFilter] = useState<Chakra | "any">("any");
  const [durationFilter, setDurationFilter] = useState<PracticeDurationBucket>("any");
  const [remoteBusyPracticeId, setRemoteBusyPracticeId] = useState<string | null>(null);
  const [yogaLateLoading, setYogaLateLoading] = useState(false);
  const [lockedFeature, setLockedFeature] = useState<FeatureKey | null>(
    canUseFeature("practice_catalog") ? null : "practice_catalog",
  );
  const [state, setState] = useState<CatalogState>({
    status: "loading",
    catalog: null,
    error: null,
  });
  const loadSeqRef = useRef(0);

  const load = useCallback(
    async () => {
      const seq = ++loadSeqRef.current;
      const startedAt = Date.now();
      logRuntimeEvent("practice_catalog:screen_load_start", { seq });
      setState({ status: "loading", catalog: null, error: null });
      setYogaLateLoading(false);
      try {
        const catalog = await loadPracticeCatalog({
          onLateYogaPractices: (yoga) => {
            if (seq !== loadSeqRef.current) return;
            setYogaLateLoading(false);
            setState((current) => {
              const base = current.catalog ?? EMPTY_CATALOG;
              return {
                status: "ready",
                catalog: { ...base, yoga },
                error: null,
              };
            });
            logRuntimeEvent("practice_catalog:screen_late_yoga_ready", { seq, yogaCount: yoga.length });
          },
        });
        if (seq !== loadSeqRef.current) return;
        if (catalog.yoga.length === 0) {
          setYogaLateLoading(true);
        }
        logRuntimeEvent("practice_catalog:screen_load_ready", {
          seq,
          durationMs: Date.now() - startedAt,
          meditationCount: catalog.meditation.length,
          breathCount: catalog.breath.length,
          yogaCount: catalog.yoga.length,
        });
        setState({ status: "ready", catalog, error: null });
      } catch (error) {
        if (seq !== loadSeqRef.current) return;
        logRuntimeEvent(
          "practice_catalog:screen_load_error",
          { seq, durationMs: Date.now() - startedAt, message: error instanceof Error ? error.message : String(error) },
          "warn",
        );
        setState({
          status: "error",
          catalog: EMPTY_CATALOG,
          error: error instanceof Error ? error.message : "Не удалось загрузить каталог практик.",
        });
      }
    },
    [],
  );

  useEffect(() => {
    void load();
    return () => {
      loadSeqRef.current += 1;
      logRuntimeEvent("practice_catalog:screen_unmount", undefined, "debug");
    };
  }, [load]);

  const catalog = state.catalog ?? EMPTY_CATALOG;
  const selectedPractices =
    selectedKind === "yoga"
      ? filterPractices(catalog[selectedKind], {
          chakra: chakraFilter,
          duration: durationFilter,
        })
      : catalog[selectedKind];
  const catalogAllowed = canUseFeature("practice_catalog");
  const asanaAllowed = canUseFeature("asana_practices");

  const onLaunch = (practice: PracticeSummary) => {
    logRuntimeTap("practice_launch", {
      id: practice.id,
      kind: practice.kind,
      slug: practice.slug,
      catalogAllowed,
      asanaAllowed,
    });
    if (!catalogAllowed) {
      setLockedFeature("practice_catalog");
      return;
    }
    if (practice.kind === "yoga" && !asanaAllowed) {
      setLockedFeature("asana_practices");
      return;
    }
    launchPractice(practice.launch, { launchSource: "catalog" });
  };

  const onRemotePlay = async (practice: PracticeSummary) => {
    logRuntimeTap("practice_remote_play", {
      id: practice.id,
      kind: practice.kind,
      connected: remotePlay.connected,
    });
    if (!catalogAllowed) {
      setLockedFeature("practice_catalog");
      return;
    }
    if (!asanaAllowed) {
      setLockedFeature("asana_practices");
      return;
    }
    if (!remotePlay.connected) {
      router.push("/connect-tv" as Href);
      return;
    }
    const vimeoId = practice.video?.provider === "vimeo" ? practice.video.externalId : null;
    if (!vimeoId) {
      Alert.alert("Видео недоступно", "У этой асаны пока нет Vimeo ID для Remote Play.");
      return;
    }

    setRemoteBusyPracticeId(practice.id);
    try {
      await remotePlay.playVimeo(vimeoId);
      router.push({
        pathname: "/tv-remote",
        params: {
          title: practice.title,
          durationSec: practice.defaultDurationSec ? String(practice.defaultDurationSec) : "",
        },
      } as Href);
    } catch (error) {
      Alert.alert("Remote Play", error instanceof Error ? error.message : "Не удалось запустить видео на ТВ.");
    } finally {
      setRemoteBusyPracticeId(null);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.screenBg }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <AppText variant="screenTitle" accessibilityRole="header">
            Каталог практик
          </AppText>
          <AppText variant="screenHint" tone="muted">
            Выберите, что вас интересует.
          </AppText>
        </View>

        {state.status === "loading" ? (
          <View style={[styles.stateCard, { borderColor: theme.colors.surfaceBorder }]}>
            <ActivityIndicator color={theme.colors.accent} />
            <AppText variant="screenHint" tone="muted">
              Собираем каталог...
            </AppText>
          </View>
        ) : null}

        {state.status === "error" ? (
          <View style={[styles.stateCard, { borderColor: theme.colors.warning }]}>
            <AppText variant="sectionTitle" tone="warning">
              Каталог загружен частично
            </AppText>
            <AppText variant="dialogBody" tone="muted">
              {state.error}
            </AppText>
            <AppButton label="Повторить" variant="secondary" onPress={load} />
          </View>
        ) : null}

        {state.status !== "loading" ? (
          <>
            <View style={styles.groupGrid}>
              {PRACTICE_GROUPS.map((group) => {
                const count = catalog[group.kind].length;
                const active = group.kind === selectedKind;
                const locked = group.kind === "yoga" && !asanaAllowed;
                return (
                  <Pressable
                    key={group.kind}
                    accessibilityRole="button"
                    onPress={() => {
                      logRuntimeTap("practice_group", {
                        kind: group.kind,
                        locked,
                        catalogAllowed,
                      });
                      if (!catalogAllowed) {
                        setLockedFeature("practice_catalog");
                        return;
                      }
                      if (locked) setLockedFeature("asana_practices");
                      setSelectedKind(group.kind);
                    }}
                    style={({ pressed }) => [
                      styles.groupCard,
                      {
                        backgroundColor: active ? theme.colors.buttonPrimaryBg : theme.colors.surfaceElevated,
                        borderColor: active ? theme.colors.buttonPrimaryBg : theme.colors.surfaceBorder,
                        opacity: pressed ? 0.82 : 1,
                      },
                    ]}
                  >
                    <AppText variant="sectionTitle" tone={active ? "accentOn" : "primary"}>
                      {group.title}
                    </AppText>
                    <AppText variant="technicalCaption" tone={active ? "accentOn" : "muted"}>
                      {locked ? "только Master" : count ? `${count} практик` : group.kind === "yoga" && yogaLateLoading ? "загружаем..." : "пока пусто"}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>

            {selectedKind === "yoga" ? (
              <>
                <View style={[styles.remotePanel, { borderColor: theme.colors.surfaceBorder }]}>
                  <View style={styles.remoteText}>
                    <AppText variant="screenHint" tone="muted">
                      {remotePlay.connected
                        ? `ТВ подключён · код ${remotePlay.session?.pairing_code ?? "…"} · запускайте видео на большом экране.`
                        : "Подключите TV, чтобы смотреть видео на большом экране."}
                    </AppText>
                  </View>
                  <AppButton
                    label={remotePlay.connected ? "Сменить ТВ" : "Подключить ТВ"}
                    variant="secondary"
                    onPress={() => router.push("/connect-tv" as Href)}
                    style={styles.remoteButton}
                  />
                </View>

                <View style={[styles.filterPanel, { borderColor: theme.colors.surfaceBorder }]}>
                  <AppText variant="technicalCaption" tone="muted">
                    Фильтр
                  </AppText>
                  <View style={styles.chipRow}>
                    {CHAKRA_FILTERS.map((item) => (
                      <FilterChip
                        key={String(item.value)}
                        label={item.label}
                        active={chakraFilter === item.value}
                        onPress={() => setChakraFilter(item.value)}
                      />
                    ))}
                  </View>
                  <View style={styles.chipRow}>
                    {DURATION_FILTERS.map((item) => (
                      <FilterChip
                        key={item.value}
                        label={item.label}
                        active={durationFilter === item.value}
                        onPress={() => setDurationFilter(item.value)}
                      />
                    ))}
                  </View>
                  {chakraFilter !== "any" && !isChakra(chakraFilter) ? (
                    <AppText variant="technicalCaption" tone="warning">
                      Некорректный фильтр чакры будет проигнорирован.
                    </AppText>
                  ) : null}
                </View>
              </>
            ) : null}

            <View style={styles.list}>
              {selectedPractices.length ? (
                selectedPractices.map((practice) => (
                  <PracticeCard
                    key={`${practice.kind}:${practice.slug}`}
                    practice={practice}
                    onLaunch={onLaunch}
                    onRemotePlay={onRemotePlay}
                    remotePlayConnected={remotePlay.connected}
                    remotePlayDisabled={remoteBusyPracticeId === practice.id || remotePlay.busy}
                  />
                ))
              ) : selectedKind === "yoga" && yogaLateLoading ? (
                <View
                  style={[
                    styles.emptyCard,
                    {
                      backgroundColor: theme.colors.surface,
                      borderColor: theme.colors.surfaceBorder,
                    },
                  ]}
                >
                  <ActivityIndicator color={theme.colors.accent} />
                  <AppText variant="sectionTitle">Асаны ещё загружаются</AppText>
                  <AppText variant="dialogBody" tone="muted">
                    Supabase отвечает медленнее обычного. Каталог уже открыт, а асаны появятся здесь автоматически.
                  </AppText>
                </View>
              ) : (
                <View
                  style={[
                    styles.emptyCard,
                    {
                      backgroundColor: theme.colors.surface,
                      borderColor: theme.colors.surfaceBorder,
                    },
                  ]}
                >
                  <AppText variant="sectionTitle">Здесь скоро появятся практики</AppText>
                  <AppText variant="dialogBody" tone="muted">
                    Попробуйте другой фильтр или импортируйте Vimeo metadata в practices с kind=yoga.
                  </AppText>
                </View>
              )}
            </View>

            <AppText variant="technicalCaption" tone="faint" style={styles.footer}>
              Всего в каталоге: {totalCount(catalog)}. Запуск идет через существующие экраны практик.
            </AppText>
          </>
        ) : null}
      </ScrollView>
      {lockedFeature ? (
        <UpgradeDialog
          visible
          feature={lockedFeature}
          requiredTier={requiredTierFor(lockedFeature)}
          onClose={() => setLockedFeature(null)}
        />
      ) : null}
    </SafeAreaView>
  );
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.filterChip,
        {
          backgroundColor: active ? theme.colors.buttonPrimaryBg : theme.colors.controlButtonBg,
          borderColor: active ? theme.colors.buttonPrimaryBg : theme.colors.surfaceBorder,
          opacity: pressed ? 0.82 : 1,
        },
      ]}
    >
      <AppText variant="technicalCaption" tone={active ? "accentOn" : "muted"}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    padding: 20,
    gap: 18,
  },
  header: {
    gap: 8,
  },
  stateCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    padding: 16,
    gap: 10,
    alignItems: "flex-start",
  },
  groupGrid: {
    flexDirection: "row",
    gap: 10,
  },
  groupCard: {
    flex: 1,
    minWidth: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 8,
    gap: 4,
    alignItems: "center",
  },
  filterPanel: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    gap: 10,
    padding: 12,
  },
  remotePanel: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
  },
  remoteText: {
    flex: 1,
    gap: 3,
  },
  remoteButton: {
    minWidth: 126,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  filterChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  list: {
    gap: 12,
  },
  emptyCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    padding: 16,
    gap: 8,
  },
  footer: {
    textAlign: "center",
  },
});
