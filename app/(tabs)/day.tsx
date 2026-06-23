import { useFocusEffect } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

import { useAuth } from "@/modules/auth";
import {
  CHAKRA_SEGMENT_COLORS,
  DonutChart,
  DonutVisibilityProvider,
  useDonutScrollProps,
  useDonutVisibilityRefresh,
  type DonutSegmentInput,
} from "@/modules/charts";
import { Communicator } from "@/modules/communicator/ui/Communicator";
import { getDayStrings, mapDateLabelKind, type DayStrings } from "@/modules/day/i18n/day";
import { useAppLocale, type AppLocale } from "@/modules/i18n";
import { localizeLifeSphereLabel } from "@/modules/life-spheres/labels";
import { loadPracticeCatalog } from "@/modules/practices";
import type { PracticeCatalog, PracticeSummary } from "@/modules/practices/core/types";
import { PracticeCard } from "@/modules/practices/ui/PracticeCard";
import { launchPractice } from "@/modules/practices/ui/launchPractice";
import { scheduleAssistantOverlayDismiss } from "@/modules/practices/ui/assistantPracticeOverlayDismiss";
import { AssistantModalShell } from "@/modules/ui/AssistantModalShell";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { ScreenHeader } from "@/modules/ui/ScreenHeader";
import { SURFACE_CARD } from "@/modules/ui/surfaceCard";
import { TabScreenLayout, TabScrollView } from "@/modules/ui/TabScreenLayout";
import { useTheme } from "@/modules/ui/theme";
import type { DayHealthContext } from "@/services/dayHealthContext";
import { startSummarizingHealthCollectionFromPlan } from "@/services/summarizingHealthContext";
import {
  cancelPendingDayPractice,
  deleteDayAction,
  loadDayPlan,
  renameDayAction,
  savePendingDayPractice,
  type DayAction,
  type DayPlan,
  type DaySection,
  type DaySphereStat,
} from "@/services/dayPlan";
import { consumePrefetchedDayPlan } from "@/services/dayPlanReloadRequest";
import { loadCachedDayPlan, peekCachedDayPlan } from "@/services/dayPlanCache";

type AssistantMode = "plan" | "add" | "summary";
type PracticeMenuLevel = "closed" | "root" | "breath" | "yoga";

type AssistantDayAction = {
  id: string;
  title: string;
  status: string;
  localDate: string;
};

/** Frozen snapshot for one assistant modal open — survives background day-plan refresh. */
type AssistantSession = {
  sessionKey: number;
  mode: AssistantMode;
  dayTabMode: AssistantMode;
  daySummaryRequested: boolean;
  workingLocalDate: string;
  dayActions: AssistantDayAction[];
  dayPractices: DaySection["practices"];
  dayHealthContext: DayHealthContext | null;
};

function buildAssistantActions(plan: DayPlan, mode: AssistantMode): AssistantDayAction[] {
  const sections =
    mode === "summary"
      ? summarySections(plan)
      : currentDaySection(plan)
        ? [currentDaySection(plan)!]
        : [];
  return sections.flatMap((section) =>
    section.actions.map((action) => ({
      id: action.id,
      title: action.title,
      status: action.status,
      localDate: section.localDate,
    })),
  );
}

function buildAssistantSession(
  plan: DayPlan,
  mode: AssistantMode,
  health: DayHealthContext | null,
  sessionKey: number,
  strings: DayStrings,
): AssistantSession {
  const summaryTargetLocalDate = plan.summaryTargetLocalDate ?? plan.currentLocalDate;
  const overdueSummaryStartsFullFlow = mode === "summary" && plan.mode === "overdue_summary";
  return {
    sessionKey,
    mode,
    dayTabMode: overdueSummaryStartsFullFlow ? "plan" : mode,
    daySummaryRequested: mode === "summary" && !overdueSummaryStartsFullFlow,
    workingLocalDate: mode === "summary" ? summaryTargetLocalDate : plan.currentLocalDate,
    dayActions: buildAssistantActions(plan, mode),
    dayPractices:
      mode === "summary"
        ? summaryPracticesForAssistant(plan, strings)
        : (currentDaySection(plan)?.practices ?? []),
    dayHealthContext: mode === "summary" ? health : null,
  };
}

function sphereStatsToDonutSegments(stats: DaySphereStat[], locale: AppLocale): DonutSegmentInput[] {
  return stats.map((item) => ({
    id: item.id,
    value: item.value,
    color: CHAKRA_SEGMENT_COLORS[item.id - 1] ?? CHAKRA_SEGMENT_COLORS[0],
    label: localizeLifeSphereLabel(item.id, item.title, locale),
  }));
}

function formatDayHeaderDateLabel(section: DaySection, strings: DayStrings): string {
  return strings.formatDateHeader(section.localDate, mapDateLabelKind(section.dateLabelKind));
}

function formatPracticeLineTime(value: string, strings: DayStrings) {
  return strings.formatTime(value);
}

function formatPracticeDuration(seconds: number | null, strings: DayStrings) {
  if (!seconds || seconds <= 0) return "";
  return strings.formatDurationMinutes(Math.max(1, Math.round(seconds / 60)));
}

function compactActionTitle(value: string) {
  return value.trim();
}

function dayTargetChakra(plan: DayPlan | null): 1 | 2 | 3 | 4 | 5 | 6 | 7 | null {
  const raw = Number(plan?.forecast?.day_target_chakra);
  return Number.isInteger(raw) && raw >= 1 && raw <= 7 ? raw as 1 | 2 | 3 | 4 | 5 | 6 | 7 : null;
}

function currentDaySection(plan: DayPlan | null): DaySection | null {
  if (!plan) return null;
  return plan.sections.find((section) => section.localDate === plan.currentLocalDate) ?? plan.sections[0] ?? null;
}

function summarySections(plan: DayPlan | null): DaySection[] {
  if (!plan) return [];
  if (plan.mode === "overdue_summary") return plan.sections;
  const todaySection = currentDaySection(plan);
  return todaySection ? [todaySection] : [];
}

function summaryPracticesForAssistant(plan: DayPlan, strings: DayStrings): DayPlan["sections"][number]["practices"] {
  const sections = summarySections(plan);
  const includeDatePrefix = sections.length > 1;
  return sections.flatMap((section) =>
    section.practices.map((practice) => ({
      ...practice,
      title: includeDatePrefix
        ? `${strings.formatDateHeader(section.localDate, mapDateLabelKind(section.dateLabelKind))}: ${practice.title}`
        : practice.title,
    })),
  );
}

function practiceForDayTarget(practice: PracticeSummary, target: 1 | 2 | 3 | 4 | 5 | 6 | 7 | null): PracticeSummary {
  if (!target || practice.kind === "yoga") return practice;
  return {
    ...practice,
    primaryChakra: target,
    chakraIds: [target],
    launch: {
      ...practice.launch,
      chakra: target,
    } as PracticeSummary["launch"],
  };
}

function DayActionRow({
  action,
  onChanged,
  readonly = false,
  strings,
}: {
  action: DayAction;
  onChanged: () => void;
  readonly?: boolean;
  strings: DayStrings;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(action.title);
  const inputRef = useRef<TextInput>(null);
  const summarized = action.status === "summarized";

  const save = async () => {
    const next = draft.trim();
    if (!next || next === action.title) {
      setEditing(false);
      setDraft(action.title);
      return;
    }
    await renameDayAction(action.id, next);
    setEditing(false);
    onChanged();
  };

  const remove = () => {
    Alert.alert(strings.deleteActionTitle, strings.deleteActionMessage, [
      { text: strings.cancelButton, style: "cancel" },
      {
        text: strings.deleteButton,
        style: "destructive",
        onPress: () => {
          void deleteDayAction(action.id).then(onChanged);
        },
      },
    ]);
  };

  return (
    <View
      style={[
        styles.actionCard,
        {
          backgroundColor: "transparent",
          opacity: summarized ? 0.72 : 1,
        },
      ]}
    >
      <Pressable style={styles.actionMainRow} onPress={() => { if (!readonly) setExpanded((value) => !value); }}>
        <View style={styles.actionTitleBlock}>
          {editing ? (
            <TextInput
              ref={inputRef}
              value={draft}
              onChangeText={setDraft}
              autoFocus
              onFocus={() => {
                requestAnimationFrame(() => {
                  inputRef.current?.setNativeProps({ selection: { start: 0, end: 0 } });
                });
              }}
              style={[
                styles.actionInput,
                {
                  color: theme.colors.textPrimary,
                  borderColor: theme.colors.surfaceBorder,
                  backgroundColor: theme.colors.surfaceElevated,
                },
              ]}
            />
          ) : (
            <AppText variant="screenHint" tone={summarized ? "faint" : "primary"}>
              {compactActionTitle(action.explicitTimeText ? `${action.explicitTimeText} ${action.title}` : action.title)}
            </AppText>
          )}
        </View>
        {!readonly && !summarized && !editing ? (
          <View style={styles.actionIcons}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={expanded ? strings.hideRecommendationA11y : strings.showRecommendationA11y}
              onPress={() => setExpanded((value) => !value)}
              style={styles.iconButton}
            >
              <AppText variant="buttonLabel" tone="accent">
                {expanded ? "▴" : "▾"}
              </AppText>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={strings.editActionA11y} onPress={() => setEditing(true)} style={styles.iconButton}>
              <AppText variant="buttonLabel">✎</AppText>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={strings.deleteActionA11y} onPress={remove} style={styles.iconButton}>
              <AppText variant="buttonLabel">×</AppText>
            </Pressable>
          </View>
        ) : null}
        {summarized && !editing ? (
          <AppText variant="buttonLabel" tone="accent" style={styles.doneIcon}>✓</AppText>
        ) : null}
      </Pressable>
      {editing ? (
        <View style={styles.editActions}>
          <AppButton label={strings.saveButton} onPress={() => void save()} style={styles.smallButton} />
          <AppButton label={strings.cancelButton} variant="secondary" onPress={() => {
            setDraft(action.title);
            setEditing(false);
          }} style={styles.smallButton} />
        </View>
      ) : null}
      {expanded && !editing && !readonly ? (
        <AppText variant="screenHint" tone="muted" style={styles.actionRecommendation}>
          {action.recommendation ?? strings.actionRecommendationFallback}
        </AppText>
      ) : null}
    </View>
  );
}

function AssistantModal({
  visible,
  session,
  onClose,
  onPracticeOffered,
  onAssistantMessage,
  onPracticeStarted,
  strings,
  appLocale,
}: {
  visible: boolean;
  session: AssistantSession | null;
  onClose: () => void;
  onPracticeOffered: (practice: PracticeSummary) => void | Promise<void>;
  onAssistantMessage?: (message: { meta?: Record<string, unknown> }) => void;
  onPracticeStarted: () => void;
  strings: DayStrings;
  appLocale: AppLocale;
}) {
  const [practiceHandoff, setPracticeHandoff] = useState(false);

  const finishPracticeLaunch = useCallback(() => {
    setPracticeHandoff(false);
    onPracticeStarted();
  }, [onPracticeStarted]);

  useEffect(() => {
    if (visible) return;
    setPracticeHandoff(false);
  }, [visible]);

  if (!visible || !session) return null;
  return (
    <AssistantModalShell
      visible={visible}
      title={strings.assistantTitle}
      closeLabel={strings.closeButton}
      handoffVisible={practiceHandoff}
      onClose={onClose}
    >
      <Communicator
        key={`day-assistant-${session.sessionKey}`}
        systemPrompt={strings.assistantSystemPrompt}
        locale={appLocale}
        useCase="daily_dialog"
        entrySource="day"
        startFreshSession
        triggerMeta={{
          dayTabMode: session.dayTabMode,
          workingLocalDate: session.workingLocalDate,
          daySummaryRequested: session.daySummaryRequested,
          dayActions: session.dayActions,
          dayPractices: session.dayPractices,
          dayHealthContext: session.dayHealthContext,
        }}
        memoryWindow={24}
        onPracticeOffered={onPracticeOffered}
        onPracticeLaunchStart={() => setPracticeHandoff(true)}
        onPracticeLaunchAbort={() => setPracticeHandoff(false)}
        onPracticePicked={() => scheduleAssistantOverlayDismiss(finishPracticeLaunch)}
        onMessage={(message) => {
          if (message.role === "assistant") {
            onAssistantMessage?.(message);
          }
        }}
        onRequestClose={onClose}
      />
    </AssistantModalShell>
  );
}

function chooseYogaByBucket(catalog: PracticeCatalog, bucket: "20-30" | "31-40" | "41-50" | "50+") {
  const [min, max] =
    bucket === "20-30" ? [20, 30] :
    bucket === "31-40" ? [31, 40] :
    bucket === "41-50" ? [41, 50] :
    [51, Number.POSITIVE_INFINITY];
  return catalog.yoga.find((practice) => {
    const minutes = practice.defaultDurationSec ? Math.round(practice.defaultDurationSec / 60) : 0;
    return minutes >= min && minutes <= max;
  }) ?? catalog.yoga[0] ?? null;
}

export default function DayTabRoute() {
  const theme = useTheme();
  const { authUser } = useAuth();
  const { locale: appLocale } = useAppLocale();
  const dayStrings = useMemo(() => getDayStrings(appLocale), [appLocale]);
  const reportLocale = appLocale;
  const scrollRef = useRef<ScrollView>(null);
  const donutScrollProps = useDonutScrollProps();
  const refreshDonutVisibility = useDonutVisibilityRefresh();
  const [plan, setPlan] = useState<DayPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assistantSession, setAssistantSession] = useState<AssistantSession | null>(null);
  const assistantSessionKeyRef = useRef(0);
  const [catalog, setCatalog] = useState<PracticeCatalog | null>(null);
  const [practiceMenuLevel, setPracticeMenuLevel] = useState<PracticeMenuLevel>("closed");

  // Mirrors of state read inside the stable callbacks below. Keeping `refresh`
  // and the focus effect dependency-free prevents a feedback loop where every
  // setPlan() recreated `refresh`, re-ran useFocusEffect, and snapped scroll
  // back to the top — making the page impossible to scroll.
  const planRef = useRef<DayPlan | null>(null);
  planRef.current = plan;
  const assistantSessionRef = useRef<AssistantSession | null>(null);
  assistantSessionRef.current = assistantSession;

  const refresh = useCallback(async (options?: { showRefreshing?: boolean; force?: boolean }) => {
    // Keep the in-dialog experience stable once the day plan is on screen, but never
    // block the initial load (or recovery after a failed load) while the modal is open.
    if (assistantSessionRef.current && !options?.force && planRef.current) return;
    setLoading((current) => (planRef.current && !options?.showRefreshing ? current : true));
    setError(null);
    try {
      setPlan(await loadDayPlan());
    } catch (loadError) {
      if (planRef.current) {
        console.warn("[Day] Background refresh failed", loadError);
        setError(null);
      } else {
        setError(
          loadError instanceof Error && loadError.message === "DAY_PLAN_TIMEOUT"
            ? dayStrings.loadDayError
            : loadError instanceof Error
              ? loadError.message
              : dayStrings.loadDayError,
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Scroll to the top only when the tab actually gains focus (returning from a
  // dialog or a practice), not on every background data refresh.
  useFocusEffect(
    useCallback(() => {
      if (assistantSessionRef.current && planRef.current) return;
      let cancelled = false;
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ y: 0, animated: false });
      });
      const prefetched = consumePrefetchedDayPlan();
      if (prefetched) {
        setPlan(prefetched);
        setError(null);
        setLoading(false);
      } else if (authUser?.id) {
        const cached = peekCachedDayPlan({ userId: authUser.id, locale: reportLocale });
        if (cached) {
          setPlan(cached);
          setError(null);
          setLoading(false);
        }
        void loadCachedDayPlan({ userId: authUser.id, locale: reportLocale }).then((persisted) => {
          if (cancelled || !persisted || planRef.current) return;
          setPlan(persisted);
          setError(null);
          setLoading(false);
        });
      }
      void refresh();
      return () => {
        cancelled = true;
      };
    }, [authUser?.id, refresh, reportLocale]),
  );

  useFocusEffect(
    useCallback(() => {
      refreshDonutVisibility();
    }, [refreshDonutVisibility]),
  );

  useEffect(() => {
    if (practiceMenuLevel === "closed" || catalog) return;
    void loadPracticeCatalog({ locale: reportLocale }).then(setCatalog).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : dayStrings.loadPracticesError);
    });
  }, [catalog, practiceMenuLevel, dayStrings.loadPracticesError, reportLocale]);

  const todaySection = currentDaySection(plan);
  const hasActions = (todaySection?.actions.length ?? 0) > 0;
  const canSummarizeCurrentDay = Boolean(plan?.canSummarizeCurrentDay);
  const activeSphereStats = useMemo(
    () => (todaySection?.sphereStats ?? []).filter((item) => item.value > 0.001),
    [todaySection?.sphereStats],
  );
  const showRefreshingBanner = loading && Boolean(plan);

  const saveOffer = async (practice: PracticeSummary) => {
    if (!plan) return;
    await savePendingDayPractice(plan.currentLocalDate, practiceForDayTarget(practice, dayTargetChakra(plan)));
    setPracticeMenuLevel("closed");
    await refresh({ showRefreshing: true });
  };

  const prefetchDayPlan = useCallback(async () => {
    try {
      setPlan(await loadDayPlan());
    } catch (loadError) {
      console.warn("[Day] Failed to prefetch day plan", loadError);
    }
  }, []);

  const handleAssistantMessage = useCallback((message: { meta?: Record<string, unknown> }) => {
    const persistence = message.meta?.planningPersistence as {
      inserted?: unknown[];
      updated?: unknown[];
      summarized?: unknown[];
    } | null | undefined;
    const inserted = Array.isArray(persistence?.inserted) ? persistence.inserted : [];
    const updated = Array.isArray(persistence?.updated) ? persistence.updated : [];
    const summarized = Array.isArray(persistence?.summarized) ? persistence.summarized : [];
    const branches = Array.isArray(message.meta?.branches) ? message.meta.branches : [];
    const isSummarizingFinal =
      message.meta?.turnMode === "final_without_practice" && branches.includes("summarizing");
    if (inserted.length > 0 || updated.length > 0 || summarized.length > 0 || isSummarizingFinal) {
      void prefetchDayPlan();
    }
  }, [prefetchDayPlan]);

  const openAssistant = (mode: AssistantMode) => {
    if (!plan) return;
    assistantSessionKeyRef.current += 1;
    const sessionKey = assistantSessionKeyRef.current;
    if (mode !== "summary") {
      setAssistantSession(buildAssistantSession(plan, mode, null, sessionKey, dayStrings));
      return;
    }
    const healthCollection = startSummarizingHealthCollectionFromPlan(plan);
    setAssistantSession(buildAssistantSession(plan, mode, healthCollection.getSnapshot(), sessionKey, dayStrings));
    void healthCollection.whenReady().then((health) => {
      setAssistantSession((current) =>
        current?.sessionKey === sessionKey ? { ...current, dayHealthContext: health } : current,
      );
    });
  };

  return (
    <DonutVisibilityProvider>
      <TabScreenLayout>
        <TabScrollView
          ref={scrollRef}
          contentOptions={{ horizontalPadding: 24 }}
          keyboardShouldPersistTaps="handled"
          {...donutScrollProps}
        >
        <ScreenHeader
          title={
            plan && plan.mode !== "overdue_summary" && todaySection
              ? formatDayHeaderDateLabel(todaySection, dayStrings)
              : dayStrings.screenTitle
          }
          subtitle={plan && plan.mode !== "overdue_summary" && todaySection ? plan.dayRecommendation?.trim() : undefined}
        />

        {loading && !plan ? <ActivityIndicator color={theme.colors.accent} /> : null}
        {error ? (
          <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.danger }]}>
            <AppText variant="dialogBody" tone="danger">{error}</AppText>
            <AppButton label={dayStrings.retryButton} onPress={() => void refresh()} />
          </View>
        ) : null}
        {showRefreshingBanner ? (
          <View style={[styles.card, styles.refreshingBanner, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
            <ActivityIndicator color={theme.colors.accent} />
            <AppText variant="technicalCaption" tone="muted">{dayStrings.refreshingHint}</AppText>
          </View>
        ) : null}

        {plan ? (
          <>
            {plan.mode === "overdue_summary" ? (
              <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
                <AppText variant="screenHint" tone="muted">
                  {dayStrings.overdueSummaryHint}
                </AppText>
                <AppButton label={dayStrings.summarizeButton} onPress={() => openAssistant("summary")} />
              </View>
            ) : null}

            {plan.sections.map((section) => (
              <View key={section.localDate} style={styles.sectionGroup}>
                {plan.mode === "overdue_summary" ? (
                  <AppText variant="sectionTitle">{formatDayHeaderDateLabel(section, dayStrings)}</AppText>
                ) : null}
                <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
                  <AppText variant="sectionTitle">{dayStrings.actionsTitle}</AppText>
                  {section.actions.length ? (
                    section.actions.map((action) => (
                      <DayActionRow
                        key={action.id}
                        action={action}
                        readonly={plan.mode === "overdue_summary"}
                        onChanged={() => void refresh({ showRefreshing: true })}
                        strings={dayStrings}
                      />
                    ))
                  ) : (
                    <AppText variant="screenHint" tone="muted">
                      {dayStrings.noActionsHint}
                    </AppText>
                  )}
                  {plan.mode === "current_day" && activeSphereStats.length ? (
                    <>
                      <AppText variant="sectionTitle" style={styles.innerSectionTitle}>{dayStrings.lifeSpheresTitle}</AppText>
                      <DonutChart
                        segments={sphereStatsToDonutSegments(section.sphereStats, reportLocale)}
                        locale={reportLocale}
                        animationKey={section.sphereStats.map((item) => `${item.id}:${item.value}`).join("|")}
                        revealMode="inViewport"
                      />
                      {section.sphereHint ? <AppText variant="screenHint" tone="muted">{section.sphereHint}</AppText> : null}
                    </>
                  ) : null}
                  {plan.mode === "empty_today" || plan.mode === "current_day" ? (
                    <AppButton
                      label={hasActions ? dayStrings.addButton : dayStrings.whatToDoButton}
                      onPress={() => openAssistant(hasActions ? "add" : "plan")}
                    />
                  ) : null}
                </View>

                {plan.mode === "overdue_summary" && section.practices.length === 0 ? null : (
                  <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
                    <AppText variant="sectionTitle">{dayStrings.yogaTitle}</AppText>
                    {section.practices.length ? (
                      <View style={styles.practiceLogList}>
                        {section.practices.map((practice) => {
                          const time = formatPracticeLineTime(practice.startedAt, dayStrings);
                          const duration = formatPracticeDuration(practice.durationSec, dayStrings);
                          return (
                            <AppText key={practice.id} variant="screenHint" tone="muted">
                              {time ? `${time} ` : ""}{practice.title}{duration ? ` (${duration})` : ""}
                            </AppText>
                          );
                        })}
                      </View>
                    ) : (
                      <AppText variant="screenHint" tone="muted">
                        {dayStrings.emptyYogaHint}
                      </AppText>
                    )}

                    {plan.mode !== "overdue_summary" ? (
                      plan.pendingPractice ? (
                        <View style={styles.pendingPractice}>
                          <PracticeCard
                            practice={plan.pendingPractice.practice_summary}
                            onLaunch={(practice) => {
                              launchPractice(practice.launch, { launchSource: "day" });
                            }}
                          />
                          <AppButton
                            label={dayStrings.cancelPracticeButton}
                            variant="secondary"
                            onPress={() => {
                              void cancelPendingDayPractice(plan.pendingPractice!.id).then(() => refresh({ showRefreshing: true }));
                            }}
                          />
                        </View>
                      ) : (
                        <>
                          <AppButton label={dayStrings.choosePracticeButton} onPress={() => setPracticeMenuLevel((value) => value === "closed" ? "root" : "closed")} />
                          {practiceMenuLevel !== "closed" ? (
                            <View style={[styles.practicePicker, { borderColor: theme.colors.surfaceBorder, backgroundColor: theme.colors.surface }]}>
                              {!catalog ? <ActivityIndicator color={theme.colors.accent} /> : null}
                              {catalog ? (
                                <>
                                  {practiceMenuLevel === "root" ? (
                                    <>
                                      {catalog.meditation[0] ? <Pressable style={styles.menuItem} onPress={() => void saveOffer(catalog.meditation[0]!)}><AppText variant="dialogBody">{dayStrings.meditationLabel}</AppText></Pressable> : null}
                                      <Pressable style={styles.menuItem} onPress={() => setPracticeMenuLevel("breath")}><AppText variant="dialogBody">{dayStrings.breathLabel}</AppText></Pressable>
                                      <Pressable style={styles.menuItem} onPress={() => setPracticeMenuLevel("yoga")}><AppText variant="dialogBody">{dayStrings.asanasLabel}</AppText></Pressable>
                                    </>
                                  ) : null}
                                  {practiceMenuLevel === "breath" ? (
                                    <>
                                      <Pressable style={styles.menuItem} onPress={() => setPracticeMenuLevel("root")}><AppText variant="dialogBody" tone="muted">{dayStrings.backLabel}</AppText></Pressable>
                                      {catalog.breath.map((practice) => (
                                        <Pressable key={practice.id} style={styles.menuItem} onPress={() => void saveOffer(practice)}><AppText variant="dialogBody">{practice.title}</AppText></Pressable>
                                      ))}
                                    </>
                                  ) : null}
                                  {practiceMenuLevel === "yoga" ? (
                                    <>
                                      <Pressable style={styles.menuItem} onPress={() => setPracticeMenuLevel("root")}><AppText variant="dialogBody" tone="muted">{dayStrings.backLabel}</AppText></Pressable>
                                      {(["20-30", "31-40", "41-50", "50+"] as const).map((bucket) => (
                                        <Pressable
                                          key={bucket}
                                          style={styles.menuItem}
                                          onPress={() => {
                                            const yoga = chooseYogaByBucket(catalog, bucket);
                                            if (yoga) void saveOffer(yoga);
                                          }}
                                        >
                                          <AppText variant="dialogBody">{dayStrings.minutesBucket(bucket)}</AppText>
                                        </Pressable>
                                      ))}
                                    </>
                                  ) : null}
                                </>
                              ) : null}
                            </View>
                          ) : null}
                        </>
                      )
                    ) : null}
                  </View>
                )}
              </View>
            ))}

            {plan.mode === "current_day" && canSummarizeCurrentDay ? (
              <AppButton label={dayStrings.summarizeDayButton} onPress={() => openAssistant("summary")} />
            ) : null}
          </>
        ) : null}
      </TabScrollView>

      <AssistantModal
        visible={assistantSession != null}
        session={assistantSession}
        onAssistantMessage={handleAssistantMessage}
        onPracticeOffered={async (practice) => {
          if (!plan) return;
          await savePendingDayPractice(plan.currentLocalDate, practiceForDayTarget(practice, dayTargetChakra(plan)));
          await prefetchDayPlan();
        }}
        onClose={() => {
          setAssistantSession(null);
          requestAnimationFrame(() => {
            scrollRef.current?.scrollTo({ y: 0, animated: false });
          });
          void refresh({ force: true });
        }}
        onPracticeStarted={() => {
          setAssistantSession(null);
          void prefetchDayPlan();
        }}
        strings={dayStrings}
        appLocale={reportLocale}
      />
    </TabScreenLayout>
    </DonutVisibilityProvider>
  );
}

const styles = StyleSheet.create({
  sectionGroup: {
    gap: 12,
  },
  card: {
    borderRadius: SURFACE_CARD.borderRadius,
    borderWidth: SURFACE_CARD.borderWidth,
    gap: SURFACE_CARD.gap,
    padding: SURFACE_CARD.padding,
  },
  actionCard: {
    gap: 3,
    paddingVertical: 1,
  },
  actionMainRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  actionCheck: {
    textAlign: "center",
    width: 22,
  },
  actionTitleBlock: {
    flex: 1,
  },
  actionIcons: {
    alignItems: "center",
    flexDirection: "row",
    gap: 2,
  },
  iconButton: {
    paddingHorizontal: 5,
    paddingVertical: 4,
  },
  doneIcon: {
    paddingHorizontal: 5,
  },
  actionInput: {
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 15,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  editActions: {
    flexDirection: "row",
    gap: 8,
  },
  smallButton: {
    flex: 1,
  },
  actionRecommendation: {
    paddingRight: 8,
  },
  refreshingBanner: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  innerSectionTitle: {
    marginTop: 10,
  },
  practiceLogList: {
    gap: 6,
  },
  pendingPractice: {
    gap: 10,
  },
  practicePicker: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    gap: 2,
    overflow: "hidden",
  },
  menuItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  durationBuckets: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  bucketButton: {
    flexGrow: 1,
  },
  modalRoot: {
    flex: 1,
  },
  modalHeader: {
    alignItems: "center",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 10,
    paddingHorizontal: 18,
  },
  modalClose: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
