import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { UpgradeDialog, requiredTierFor, useAccess, type FeatureKey } from "@/modules/access";
import { isChakra, type Chakra } from "@/modules/breath";
import { filterPractices, loadPracticeCatalog } from "@/modules/practices/core/catalog";
import type { PracticeCatalog, PracticeDurationBucket, PracticeKind, PracticeSummary } from "@/modules/practices/core/types";
import { PRACTICE_GROUPS } from "@/modules/practices/core/types";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

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

const GROUP_HINT: Record<PracticeKind, string> = {
  meditation: "Визуальные и созерцательные практики для настройки внимания.",
  breath: "Пранаяма и когерентное дыхание с параметрами запуска.",
  yoga: "Асаны ранжируются по чакре, длительности, качеству и дате записи.",
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
  { value: "short", label: "до 10 мин" },
  { value: "medium", label: "10-25 мин" },
  { value: "long", label: "25+ мин" },
];

function totalCount(catalog: PracticeCatalog): number {
  return catalog.meditation.length + catalog.breath.length + catalog.yoga.length;
}

export function PracticeCatalogScreen() {
  const theme = useTheme();
  const { canUseFeature } = useAccess();
  const [selectedKind, setSelectedKind] = useState<PracticeKind>("meditation");
  const [chakraFilter, setChakraFilter] = useState<Chakra | "any">("any");
  const [durationFilter, setDurationFilter] = useState<PracticeDurationBucket>("any");
  const [lockedFeature, setLockedFeature] = useState<FeatureKey | null>(
    canUseFeature("practice_catalog") ? null : "practice_catalog",
  );
  const [state, setState] = useState<CatalogState>({
    status: "loading",
    catalog: null,
    error: null,
  });

  const load = useMemo(
    () => async () => {
      setState({ status: "loading", catalog: null, error: null });
      try {
        const catalog = await loadPracticeCatalog();
        setState({ status: "ready", catalog, error: null });
      } catch (error) {
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
  }, [load]);

  const catalog = state.catalog ?? EMPTY_CATALOG;
  const selectedPractices = filterPractices(catalog[selectedKind], {
    chakra: chakraFilter,
    duration: durationFilter,
  });
  const catalogAllowed = canUseFeature("practice_catalog");
  const asanaAllowed = canUseFeature("asana_practices");

  const onLaunch = (practice: PracticeSummary) => {
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

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.screenBg }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <AppText variant="screenTitle" accessibilityRole="header">
            Каталог практик
          </AppText>
          <AppText variant="screenHint" tone="muted">
            Первый виток объединяет медитации, дыхание и асаны в один контракт запуска.
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
                      {locked ? "только Master" : count ? `${count} практик` : "пока пусто"}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.sectionHeader}>
              <AppText variant="sectionTitle">
                {PRACTICE_GROUPS.find((group) => group.kind === selectedKind)?.title}
              </AppText>
              <AppText variant="dialogBody" tone="muted">
                {GROUP_HINT[selectedKind]}
              </AppText>
            </View>

            <View style={[styles.filterPanel, { borderColor: theme.colors.surfaceBorder }]}>
              <AppText variant="technicalCaption" tone="muted">
                Фильтры второго витка
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

            <View style={styles.list}>
              {selectedPractices.length ? (
                selectedPractices.map((practice) => (
                  <PracticeCard key={`${practice.kind}:${practice.slug}`} practice={practice} onLaunch={onLaunch} />
                ))
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
    flexWrap: "wrap",
    gap: 10,
  },
  groupCard: {
    flexGrow: 1,
    minWidth: 132,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    padding: 14,
    gap: 4,
  },
  sectionHeader: {
    gap: 6,
  },
  filterPanel: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    gap: 10,
    padding: 12,
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
