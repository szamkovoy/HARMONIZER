import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, View } from "react-native";
import { router, type Href } from "expo-router";

import { AccountGateDialog, useAccess, type FeatureKey } from "@/modules/access";
import { isChakra, type Chakra } from "@/modules/breath";
import { useAppLocale } from "@/modules/i18n";
import {
  filterPractices,
  formatPracticeCatalogError,
  loadPracticeCatalog,
  type LateYogaPracticesResult,
} from "@/modules/practices/core/catalog";
import type {
  PracticeCatalog,
  PracticeDurationBucket,
  PracticeKind,
  PracticeSummary,
  PracticeVideoThumbnail,
} from "@/modules/practices/core/types";
import { PRACTICE_GROUPS } from "@/modules/practices/core/types";
import { getPracticeCatalogStrings, getPracticeGroupTitle } from "@/modules/practices/i18n/practices";
import { useRemotePlay } from "@/modules/remote-play";
import { vimeoAudiotrackForLocale } from "@/modules/practices/core/vimeo";
import { AppText } from "@/modules/ui/AppText";
import { ScreenHeader } from "@/modules/ui/ScreenHeader";
import { StateCard } from "@/modules/ui/StateCard";
import { TabScreenLayout, useTabScreenContentProps } from "@/modules/ui/TabScreenLayout";
import { useTheme } from "@/modules/ui/theme";
import { loadCachedYogaPractices, peekCachedYogaPractices, saveCachedYogaPractices } from "@/services/practiceCatalogCache";
import { fetchPracticeVimeoThumbnails } from "@/services/practice-thumbnails";
import { logRuntimeEvent, logRuntimeTap } from "@/services/runtimeDiagnostics";

import { AffirmationWidget } from "@/modules/affirmations";

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

function chakraFilters(strings: ReturnType<typeof getPracticeCatalogStrings>): Array<{ value: Chakra | "any"; label: string }> {
  return [
    { value: "any", label: strings.allChakras },
    { value: 1, label: "1" },
    { value: 2, label: "2" },
    { value: 3, label: "3" },
    { value: 4, label: "4" },
    { value: 5, label: "5" },
    { value: 6, label: "6" },
    { value: 7, label: "7" },
  ];
}

function durationFilters(strings: ReturnType<typeof getPracticeCatalogStrings>): Array<{ value: PracticeDurationBucket; label: string }> {
  return [
    { value: "any", label: strings.anyDuration },
    { value: "short", label: strings.durationShort },
    { value: "medium", label: strings.durationMedium },
    { value: "long", label: strings.durationLong },
  ];
}

const CATALOG_THUMBNAIL_WIDTH = 295;
const INITIAL_THUMBNAILS_TO_PREFETCH = 12;

export function PracticeCatalogScreen() {
  const theme = useTheme();
  const { locale: appLocale } = useAppLocale();
  const strings = useMemo(() => getPracticeCatalogStrings(appLocale), [appLocale]);
  const catalogLocale = appLocale;
  const CHAKRA_FILTERS = useMemo(() => chakraFilters(strings), [strings]);
  const DURATION_FILTERS = useMemo(() => durationFilters(strings), [strings]);
  const { canUseFeature } = useAccess();
  const remotePlay = useRemotePlay();
  const listContentProps = useTabScreenContentProps({ bottomPaddingExtra: 20 });
  const [selectedKind, setSelectedKind] = useState<PracticeKind>("meditation");
  const [chakraFilter, setChakraFilter] = useState<Chakra | "any">("any");
  const [durationFilter, setDurationFilter] = useState<PracticeDurationBucket>("any");
  const [remoteBusyPracticeId, setRemoteBusyPracticeId] = useState<string | null>(null);
  const [yogaLateLoading, setYogaLateLoading] = useState(false);
  const [yogaThumbnails, setYogaThumbnails] = useState<Record<string, PracticeVideoThumbnail | null>>({});
  // Каталог виден всем уровням (пользователь должен видеть объём библиотеки);
  // гейт срабатывает только на «Начать практику» (см. onLaunch/onRemotePlay).
  const [lockedFeature, setLockedFeature] = useState<FeatureKey | null>(null);
  const [state, setState] = useState<CatalogState>({
    status: "loading",
    catalog: null,
    error: null,
  });
  const loadSeqRef = useRef(0);
  const visibleCatalogRef = useRef<PracticeCatalog | null>(null);
  const requestedThumbnailIdsRef = useRef<Set<string>>(new Set());
  /** Избегаем гонки: `onLateYogaPractices` может отработать раньше, чем продолжится `load()` после `await`. */
  const lateYogaSlotRef = useRef<{ resolved: false } | { resolved: true; result: LateYogaPracticesResult }>({ resolved: false });
  /** Медитации+дыхание из последнего `loadPracticeCatalog` — чтобы колбэк йоги мог собрать каталог до `status: ready`. */
  const catalogMeditationBreathRef = useRef<Pick<PracticeCatalog, "meditation" | "breath"> | null>(null);
  /** Йога/ошибка пришла до того, как ref среза успели записать (редкий порядок микрозадач). */
  const pendingLateYogaRef = useRef<LateYogaPracticesResult | null>(null);

  const setCatalogState = useCallback((next: CatalogState) => {
    visibleCatalogRef.current = next.catalog;
    setState(next);
  }, []);

  const load = useCallback(
    async () => {
      const seq = ++loadSeqRef.current;
      const startedAt = Date.now();
      logRuntimeEvent("practice_catalog:screen_load_start", { seq });
      setCatalogState({ status: "loading", catalog: null, error: null });
      setYogaLateLoading(false);
      lateYogaSlotRef.current = { resolved: false };
      catalogMeditationBreathRef.current = null;
      pendingLateYogaRef.current = null;
      requestedThumbnailIdsRef.current = new Set();
      setYogaThumbnails({});
      try {
        const cachedYoga = (peekCachedYogaPractices(catalogLocale) ?? (await loadCachedYogaPractices(catalogLocale))) ?? [];
        if (seq !== loadSeqRef.current) return;
        setYogaLateLoading(cachedYoga.length === 0);
        const catalog = await loadPracticeCatalog({
          locale: catalogLocale,
          initialYoga: cachedYoga,
          onLateYogaPractices: (yoga) => {
            if (seq !== loadSeqRef.current) return;
            lateYogaSlotRef.current = { resolved: true, result: yoga };
            const mb = catalogMeditationBreathRef.current;
            const visibleYoga = visibleCatalogRef.current?.yoga ?? [];
            if (!mb) {
              pendingLateYogaRef.current = yoga;
              logRuntimeEvent(
                "practice_catalog:screen_late_yoga_pending_mb",
                { seq, yogaCount: yoga.practices.length, state: yoga.state },
                "debug",
              );
              return;
            }
            pendingLateYogaRef.current = null;
            if (yoga.state === "timeout") {
              setYogaLateLoading(visibleYoga.length === 0);
              logRuntimeEvent("practice_catalog:screen_late_yoga_timeout", { seq }, "warn");
              return;
            }
            setYogaLateLoading(false);
            if (yoga.state === "error") {
              if (visibleYoga.length > 0) {
                logRuntimeEvent(
                  "practice_catalog:screen_late_yoga_error_using_cache",
                  {
                    seq,
                    message: yoga.errorMessage ?? strings.loadCatalogError,
                    cachedYogaCount: visibleYoga.length,
                  },
                  "warn",
                );
                return;
              }
              setCatalogState({
                status: "error",
                catalog: { ...mb, yoga: [] },
                error: yoga.errorMessage ?? strings.loadCatalogError,
              });
              logRuntimeEvent("practice_catalog:screen_late_yoga_error", {
                seq,
                message: yoga.errorMessage ?? strings.loadCatalogError,
              }, "warn");
              return;
            }
            const nextCatalog = { ...mb, yoga: yoga.practices };
            setCatalogState({
              status: "ready",
              catalog: nextCatalog,
              error: null,
            });
            void saveCachedYogaPractices(catalogLocale, yoga.practices);
            logRuntimeEvent("practice_catalog:screen_late_yoga_ready", {
              seq,
              yogaCount: yoga.practices.length,
            });
          },
        });
        catalogMeditationBreathRef.current = {
          meditation: catalog.meditation,
          breath: catalog.breath,
        };
        if (pendingLateYogaRef.current !== null) {
          const pendingYoga: LateYogaPracticesResult = pendingLateYogaRef.current;
          pendingLateYogaRef.current = null;
          lateYogaSlotRef.current = { resolved: true, result: pendingYoga };
          if (pendingYoga.state === "ready") {
            setYogaLateLoading(false);
            const nextCatalog = { ...catalogMeditationBreathRef.current, yoga: pendingYoga.practices };
            setCatalogState({
              status: "ready",
              catalog: nextCatalog,
              error: null,
            });
            void saveCachedYogaPractices(catalogLocale, pendingYoga.practices);
            logRuntimeEvent("practice_catalog:screen_late_yoga_flushed_pending", {
              seq,
              yogaCount: pendingYoga.practices.length,
            });
          } else if (pendingYoga.state === "error" && catalog.yoga.length === 0) {
            setYogaLateLoading(false);
            setCatalogState({
              status: "error",
              catalog,
              error: pendingYoga.errorMessage ?? strings.loadCatalogError,
            });
            return;
          } else {
            setYogaLateLoading(catalog.yoga.length === 0);
          }
        }
        // Late yoga can arrive on a later microtask/macrotask boundary; flush one
        // immediate turn before deciding that the list is truly empty.
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (seq !== loadSeqRef.current) return;
        const late = lateYogaSlotRef.current;
        const mergedYoga =
          late.resolved && late.result.state === "ready"
            ? late.result.practices
            : catalog.yoga;
        if (late.resolved && late.result.state === "error" && mergedYoga.length === 0) return;
        logRuntimeEvent("practice_catalog:screen_load_ready", {
          seq,
          durationMs: Date.now() - startedAt,
          meditationCount: catalog.meditation.length,
          breathCount: catalog.breath.length,
          yogaCount: mergedYoga.length,
          yogaLateAlready: late.resolved,
          yogaLateState: late.resolved ? late.result.state : "initial",
        });
        setCatalogState({ status: "ready", catalog: { ...catalog, yoga: mergedYoga }, error: null });
        if (late.resolved) {
          setYogaLateLoading(late.result.state === "timeout" && mergedYoga.length === 0);
        } else {
          setYogaLateLoading(mergedYoga.length === 0);
        }
      } catch (error) {
        if (seq !== loadSeqRef.current) return;
        const message = formatPracticeCatalogError(error);
        logRuntimeEvent(
          "practice_catalog:screen_load_error",
          { seq, durationMs: Date.now() - startedAt, message },
          "warn",
        );
        setYogaLateLoading(false);
        setCatalogState({
          status: "error",
          catalog: EMPTY_CATALOG,
          error: message || strings.loadCatalogError,
        });
      }
    },
    [catalogLocale, setCatalogState, strings.loadCatalogError],
  );

  useEffect(() => {
    void load();
    return () => {
      loadSeqRef.current += 1;
      logRuntimeEvent("practice_catalog:screen_unmount", undefined, "debug");
    };
  }, [load]);

  const catalog = state.catalog ?? EMPTY_CATALOG;
  const selectedPractices = useMemo(
    () =>
      selectedKind === "yoga"
        ? filterPractices(catalog[selectedKind], {
            chakra: chakraFilter,
            duration: durationFilter,
          })
        : catalog[selectedKind],
    [catalog, chakraFilter, durationFilter, selectedKind],
  );
  const meditationAllowed = canUseFeature("meditations");
  const breathAllowed = canUseFeature("breath_practices");
  const asanaAllowed = canUseFeature("asana_practices");

  const requestYogaThumbnails = useCallback(
    (practices: PracticeSummary[]) => {
      const pairs = practices
        .map((practice) => ({
          practiceId: practice.id,
          hasPersistedThumbnail: Boolean(practice.video?.thumbnail?.url),
          videoId:
            practice.kind === "yoga" && practice.video?.provider === "vimeo"
              ? practice.video.externalId?.trim() ?? ""
              : "",
        }))
        .filter((item) => item.videoId && !item.hasPersistedThumbnail);

      const videoIds = [...new Set(pairs.map((item) => item.videoId))].filter((videoId) => {
        if (requestedThumbnailIdsRef.current.has(videoId)) return false;
        requestedThumbnailIdsRef.current.add(videoId);
        return true;
      });

      if (!videoIds.length) return;
      const seq = loadSeqRef.current;
      logRuntimeEvent("practice_catalog:yoga_thumbnails_request", { count: videoIds.length }, "debug");

      void fetchPracticeVimeoThumbnails({
        videoIds,
        targetWidth: CATALOG_THUMBNAIL_WIDTH,
      })
        .then((thumbnails) => {
          if (seq !== loadSeqRef.current) return;
          logRuntimeEvent(
            "practice_catalog:yoga_thumbnails_ready",
            {
              count: Object.keys(thumbnails).length,
              loaded: Object.values(thumbnails).filter((item) => Boolean(item?.url)).length,
            },
            "debug",
          );
          setYogaThumbnails((current) => {
            const next = { ...current };
            for (const item of pairs) {
              if (Object.prototype.hasOwnProperty.call(thumbnails, item.videoId)) {
                next[item.practiceId] = thumbnails[item.videoId] ?? null;
              }
            }
            return next;
          });
        })
        .catch((error: unknown) => {
          for (const videoId of videoIds) requestedThumbnailIdsRef.current.delete(videoId);
          logRuntimeEvent(
            "practice_catalog:yoga_thumbnails_error",
            { message: error instanceof Error ? error.message : String(error), count: videoIds.length },
            "warn",
          );
        });
    },
    [],
  );

  useEffect(() => {
    if (!catalog.yoga.length) return;
    requestYogaThumbnails(catalog.yoga.slice(0, INITIAL_THUMBNAILS_TO_PREFETCH));
  }, [catalog.yoga, requestYogaThumbnails]);

  const requestYogaThumbnailsRef = useRef(requestYogaThumbnails);
  useEffect(() => {
    requestYogaThumbnailsRef.current = requestYogaThumbnails;
  }, [requestYogaThumbnails]);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<{ item: PracticeSummary | null }> }) => {
      const practices = viewableItems
        .map((item) => item.item)
        .filter((item): item is PracticeSummary => Boolean(item && item.kind === "yoga"));
      requestYogaThumbnailsRef.current(practices);
    },
  ).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 30,
  }).current;

  const onLaunch = useCallback((practice: PracticeSummary) => {
    logRuntimeTap("practice_launch", {
      id: practice.id,
      kind: practice.kind,
      slug: practice.slug,
      meditationAllowed,
      breathAllowed,
      asanaAllowed,
    });
    if (practice.kind === "meditation" && !meditationAllowed) {
      setLockedFeature("meditations");
      return;
    }
    if (practice.kind === "breath" && !breathAllowed) {
      setLockedFeature("breath_practices");
      return;
    }
    if (practice.kind === "yoga" && !asanaAllowed) {
      setLockedFeature("asana_practices");
      return;
    }
    if (practice.kind === "yoga" && practice.launch.kind === "yoga") {
      const thumb =
        yogaThumbnails[practice.id]?.url?.trim()
        || practice.video?.thumbnail?.url?.trim()
        || practice.launch.thumbnailUrl?.trim()
        || "";
      launchPractice(
        {
          ...practice.launch,
          ...(thumb ? { thumbnailUrl: thumb } : {}),
        },
        { launchSource: "catalog" },
      );
      return;
    }
    launchPractice(practice.launch, { launchSource: "catalog" });
  }, [asanaAllowed, breathAllowed, meditationAllowed, yogaThumbnails]);

  const onRemotePlay = useCallback(
    async (practice: PracticeSummary) => {
      logRuntimeTap("practice_remote_play", {
        id: practice.id,
        kind: practice.kind,
        connected: remotePlay.connected,
      });
      if (!asanaAllowed) {
        setLockedFeature("asana_practices");
        return;
      }
      const vimeoId = practice.video?.provider === "vimeo" ? practice.video.externalId : null;
      if (!vimeoId) {
        Alert.alert(strings.videoUnavailableTitle, strings.videoUnavailableMessage);
        return;
      }
      const audiotrack = vimeoAudiotrackForLocale(appLocale);
      const durationSec = practice.defaultDurationSec ? String(practice.defaultDurationSec) : "";
      const practiceParams = {
        vimeoId,
        title: practice.title,
        durationSec,
        audiotrack,
        practiceId: practice.id,
        slug: practice.slug,
        chakraIds: practice.chakraIds.join(","),
        launchSource: "catalog",
      };
      if (!remotePlay.connected) {
        router.push({ pathname: "/connect-tv", params: practiceParams } as Href);
        return;
      }

      setRemoteBusyPracticeId(practice.id);
      try {
        await remotePlay.playVimeo(vimeoId, audiotrack);
        router.push({ pathname: "/tv-remote", params: practiceParams } as Href);
      } catch (error) {
        Alert.alert(strings.remotePlayErrorTitle, error instanceof Error ? error.message : strings.loadCatalogError);
      } finally {
        setRemoteBusyPracticeId(null);
      }
    },
    [appLocale, asanaAllowed, remotePlay],
  );

  const renderPractice = useCallback(
    ({ item: practice }: { item: PracticeSummary }) => (
      <PracticeCard
        practice={practice}
        videoThumbnail={practice.kind === "yoga" ? yogaThumbnails[practice.id] : undefined}
        onLaunch={onLaunch}
        onRemotePlay={onRemotePlay}
        remotePlayDisabled={remoteBusyPracticeId === practice.id || remotePlay.busy}
      />
    ),
    [onLaunch, onRemotePlay, remoteBusyPracticeId, remotePlay.busy, remotePlay.connected, yogaThumbnails],
  );

  const listHeader = useMemo(
    () => (
      <View style={styles.headerContent}>
        <ScreenHeader title={strings.screenTitle} subtitle={strings.screenSubtitle} />

        {state.status === "loading" ? (
          <StateCard loading message={strings.loadingCatalog} />
        ) : null}

        {state.status === "error" ? (
          <StateCard
            title={strings.partialCatalogTitle}
            message={state.error}
            tone="warning"
            actionLabel={strings.retryButton}
            onAction={load}
          />
        ) : null}

        {state.status !== "loading" ? (
          <>
            <View style={styles.groupGrid}>
              {PRACTICE_GROUPS.map((group) => {
                const count = catalog[group.kind].length;
                const active = group.kind === selectedKind;
                return (
                  <Pressable
                    key={group.kind}
                    accessibilityRole="button"
                    onPress={() => {
                      logRuntimeTap("practice_group", {
                        kind: group.kind,
                      });
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
                    <AppText
                      variant="screenHint"
                      tone={active ? "accentOn" : "muted"}
                      style={styles.groupTitle}
                      numberOfLines={2}
                    >
                      {getPracticeGroupTitle(group.kind, strings)}
                    </AppText>
                    <AppText variant="technicalCaption" tone={active ? "accentOn" : "muted"}>
                      {count
                        ? strings.practiceCount(count)
                        : group.kind === "yoga" && yogaLateLoading
                          ? strings.yogaLateLoading
                          : strings.emptyGroup}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>

            {selectedKind === "breath" ? <AffirmationWidget /> : null}

            {selectedKind === "yoga" ? (
              <View style={[styles.filterPanel, { borderColor: theme.colors.surfaceBorder }]}>
                <AppText variant="technicalCaption" tone="muted">
                  {strings.filterTitle}
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
                    {strings.invalidChakraFilterHint}
                  </AppText>
                ) : null}
              </View>
            ) : null}
          </>
        ) : null}
      </View>
    ),
    [
      catalog,
      chakraFilter,
      durationFilter,
      load,
      selectedKind,
      state.error,
      state.status,
      theme.colors.accent,
      theme.colors.buttonPrimaryBg,
      theme.colors.surfaceBorder,
      theme.colors.surfaceElevated,
      theme.colors.warning,
      yogaLateLoading,
    ],
  );

  const listEmpty = useMemo(() => {
    if (state.status === "loading") return null;
    if (selectedKind === "yoga" && yogaLateLoading) {
      return (
        <StateCard loading title={strings.yogaLateLoadingTitle} message={strings.yogaLateHint} />
      );
    }

    return (
      <StateCard title={strings.emptyPracticesTitle} message={strings.emptyPracticesHint} />
    );
  }, [selectedKind, state.status, strings.emptyPracticesHint, strings.emptyPracticesTitle, strings.yogaLateHint, strings.yogaLateLoadingTitle, yogaLateLoading]);

  return (
    <TabScreenLayout>
      <FlatList
        data={selectedPractices}
        keyExtractor={(practice) => `${practice.kind}:${practice.slug}`}
        renderItem={renderPractice}
        extraData={{
          remoteBusyPracticeId,
          remotePlayBusy: remotePlay.busy,
          remotePlayConnected: remotePlay.connected,
          yogaThumbnails,
        }}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        ItemSeparatorComponent={() => <View style={styles.itemSeparator} />}
        contentContainerStyle={listContentProps.contentContainerStyle}
        initialNumToRender={6}
        maxToRenderPerBatch={8}
        updateCellsBatchingPeriod={50}
        windowSize={5}
        removeClippedSubviews
        scrollIndicatorInsets={listContentProps.scrollIndicatorInsets}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
      />
      {lockedFeature ? (
        <AccountGateDialog
          visible
          feature={lockedFeature}
          onClose={() => setLockedFeature(null)}
        />
      ) : null}
    </TabScreenLayout>
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
  content: {
    paddingTop: 20,
  },
  headerContent: {
    gap: 18,
    /** ~10px tighter under affirmation widget before first practice card. */
    paddingBottom: 8,
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
  groupTitle: {
    textAlign: "center",
    fontWeight: "600",
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
  itemSeparator: {
    height: 12,
  },
});
