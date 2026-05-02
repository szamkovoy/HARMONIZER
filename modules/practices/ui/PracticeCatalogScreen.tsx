import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, type Href } from "expo-router";

import { UpgradeDialog, requiredTierFor, useAccess, type FeatureKey } from "@/modules/access";
import { loadPracticeCatalog } from "@/modules/practices/core/catalog";
import type { PracticeCatalog, PracticeKind, PracticeSummary } from "@/modules/practices/core/types";
import { PRACTICE_GROUPS } from "@/modules/practices/core/types";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

import { PracticeCard } from "./PracticeCard";

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
  yoga: "Асаны из Vimeo-каталога. Если импорт еще не выполнен, группа остается пустой.",
};

function totalCount(catalog: PracticeCatalog): number {
  return catalog.meditation.length + catalog.breath.length + catalog.yoga.length;
}

function pushPractice(practice: PracticeSummary) {
  if (practice.launch.kind === "breath") {
    router.push({
      pathname: practice.launch.route,
      params: {
        practiceId: practice.launch.practiceId,
        durationMs: String(practice.launch.durationMs),
        chakra: String(practice.launch.chakra),
      },
    } as Href);
    return;
  }

  if (practice.launch.kind === "yoga") {
    router.push({
      pathname: practice.launch.route,
      params: {
        practiceId: practice.launch.practiceId,
        durationMs: practice.launch.durationMs ? String(practice.launch.durationMs) : undefined,
        chakra: practice.launch.chakra ? String(practice.launch.chakra) : undefined,
      },
    } as Href);
    return;
  }

  router.push(practice.launch.route as Href);
}

export function PracticeCatalogScreen() {
  const theme = useTheme();
  const { canUseFeature } = useAccess();
  const [selectedKind, setSelectedKind] = useState<PracticeKind>("meditation");
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
  const selectedPractices = catalog[selectedKind];
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
    pushPractice(practice);
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
                    Для асан достаточно импортировать Vimeo metadata в таблицу practices с kind=yoga.
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
