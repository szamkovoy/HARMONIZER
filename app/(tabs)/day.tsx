import { useFocusEffect } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { Communicator } from "@/modules/communicator/ui/Communicator";
import { loadPracticeCatalog } from "@/modules/practices";
import type { PracticeCatalog, PracticeSummary } from "@/modules/practices/core/types";
import { PracticeCard } from "@/modules/practices/ui/PracticeCard";
import { launchPractice } from "@/modules/practices/ui/launchPractice";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
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
        ? summaryPracticesForAssistant(plan)
        : (currentDaySection(plan)?.practices ?? []),
    dayHealthContext: mode === "summary" ? health : null,
  };
}

const SPHERE_COLORS = ["#D32F2F", "#FF6F00", "#FFC107", "#4CAF50", "#03A9F4", "#3F51B5", "#9B5BEB"] as const;

function polar(cx: number, cy: number, radius: number, angle: number) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

function sectorPath(cx: number, cy: number, radius: number, startAngle: number, endAngle: number) {
  const start = polar(cx, cy, radius, startAngle);
  const end = polar(cx, cy, radius, endAngle);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;
  return [`M ${cx} ${cy}`, `L ${start.x} ${start.y}`, `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`, "Z"].join(" ");
}

function formatLocalDateLabel(localDate: string, kind: DaySection["dateLabelKind"]) {
  const [year, month, day] = localDate.split("-").map((part) => Number.parseInt(part, 10));
  const date = new Date(year, (month ?? 1) - 1, day ?? 1, 12, 0, 0);
  const formatted = new Intl.DateTimeFormat("ru", { day: "numeric", month: "long" }).format(date);
  if (kind === "yesterday") return `Вчера, ${formatted}`;
  return formatted;
}

function formatDayHeaderDateLabel(section: DaySection): string {
  return formatLocalDateLabel(section.localDate, section.dateLabelKind);
}

function formatPracticeLineTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("ru", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatPracticeDuration(seconds: number | null) {
  if (!seconds || seconds <= 0) return "";
  return `${Math.max(1, Math.round(seconds / 60))} мин`;
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

function summaryPracticesForAssistant(plan: DayPlan): DayPlan["sections"][number]["practices"] {
  const sections = summarySections(plan);
  const includeDatePrefix = sections.length > 1;
  return sections.flatMap((section) =>
    section.practices.map((practice) => ({
      ...practice,
      title: includeDatePrefix ? `${formatLocalDateLabel(section.localDate, section.dateLabelKind)}: ${practice.title}` : practice.title,
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

function SphereRadialChart({ stats }: { stats: DaySphereStat[] }) {
  const theme = useTheme();
  const size = 220;
  const cx = 110;
  const cy = 110;
  const maxRadius = 82;
  const step = 360 / 7;
  return (
    <View style={styles.sphereChartWrap}>
      <Svg width="100%" height={size} viewBox={`0 0 ${size} ${size}`}>
        {stats.map((item, index) => {
          const radius = Math.max(8, item.radius * maxRadius);
          const start = index * step;
          const end = start + step - 2;
          return (
            <Path
              key={item.id}
              d={sectorPath(cx, cy, radius, start, end)}
              fill={SPHERE_COLORS[index] ?? theme.colors.accent}
              opacity={item.value > 0 ? 0.82 : 0.12}
              stroke={theme.colors.surfaceElevated}
              strokeWidth={1.5}
            />
          );
        })}
      </Svg>
      <View style={styles.sphereLegend}>
        {stats.map((item, index) => (
          <View key={item.id} style={styles.sphereLegendRow}>
            <View style={[styles.legendDot, { backgroundColor: SPHERE_COLORS[index] ?? theme.colors.accent, opacity: item.value > 0 ? 1 : 0.25 }]} />
            <AppText variant="technicalCaption" tone="muted" style={styles.legendText}>
              {item.title}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

function DayActionRow({
  action,
  onChanged,
  readonly = false,
}: {
  action: DayAction;
  onChanged: () => void;
  readonly?: boolean;
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
    Alert.alert("Удалить действие?", "Рекомендация к этому действию тоже исчезнет из дня.", [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
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
            <AppText variant="dialogBody" tone={summarized ? "faint" : "primary"}>
              {compactActionTitle(action.explicitTimeText ? `${action.explicitTimeText} ${action.title}` : action.title)}
            </AppText>
          )}
        </View>
        {!readonly && !summarized && !editing ? (
          <View style={styles.actionIcons}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={expanded ? "Скрыть рекомендацию" : "Показать рекомендацию"}
              onPress={() => setExpanded((value) => !value)}
              style={styles.iconButton}
            >
              <AppText variant="buttonLabel" tone="accent">
                {expanded ? "▴" : "▾"}
              </AppText>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Редактировать действие" onPress={() => setEditing(true)} style={styles.iconButton}>
              <AppText variant="buttonLabel">✎</AppText>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Удалить действие" onPress={remove} style={styles.iconButton}>
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
          <AppButton label="Сохранить" onPress={() => void save()} style={styles.smallButton} />
          <AppButton label="Отмена" variant="secondary" onPress={() => {
            setDraft(action.title);
            setEditing(false);
          }} style={styles.smallButton} />
        </View>
      ) : null}
      {expanded && !editing && !readonly ? (
        <AppText variant="dialogBody" tone="muted" style={styles.actionRecommendation}>
          {action.recommendation ?? "Рекомендация появится после обновления ассистента для этого действия."}
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
}: {
  visible: boolean;
  session: AssistantSession | null;
  onClose: () => void;
  onPracticeOffered: (practice: PracticeSummary) => void | Promise<void>;
  onAssistantMessage?: (message: { meta?: Record<string, unknown> }) => void;
}) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  if (!visible || !session) return null;
  return (
    <Modal animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.modalRoot, { backgroundColor: theme.colors.screenBg }]}>
        <View
          style={[
            styles.modalHeader,
            {
              paddingTop: insets.top + 10,
              borderBottomColor: theme.colors.surfaceBorder,
            },
          ]}
        >
          <AppText variant="sectionTitle">Ассистент дня</AppText>
          <Pressable accessibilityRole="button" onPress={onClose} style={[styles.modalClose, { backgroundColor: theme.colors.controlButtonBg }]}>
            <AppText variant="buttonLabel">Закрыть</AppText>
          </Pressable>
        </View>
        <Communicator
          key={`day-assistant-${session.sessionKey}`}
          systemPrompt="Ты эмпатичный наставник приложения Harmonizer. Помоги пользователю заполнить или подытожить вкладку «День»."
          locale="ru"
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
          onPracticePicked={onClose}
          onMessage={(message) => {
            if (message.role === "assistant") {
              onAssistantMessage?.(message);
            }
          }}
          onRequestClose={onClose}
        />
      </View>
    </Modal>
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
  const scrollRef = useRef<ScrollView>(null);
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
    if (assistantSessionRef.current && !options?.force) return;
    setLoading((current) => (planRef.current && !options?.showRefreshing ? current : true));
    setError(null);
    try {
      setPlan(await loadDayPlan());
    } catch (loadError) {
      if (planRef.current) {
        console.warn("[Day] Background refresh failed", loadError);
        setError(null);
      } else {
        setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить день.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Scroll to the top only when the tab actually gains focus (returning from a
  // dialog or a practice), not on every background data refresh.
  useFocusEffect(
    useCallback(() => {
      if (assistantSessionRef.current) return;
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ y: 0, animated: false });
      });
      const prefetched = consumePrefetchedDayPlan();
      if (prefetched) {
        setPlan(prefetched);
        setError(null);
        setLoading(false);
      }
      void refresh();
    }, [refresh]),
  );

  useEffect(() => {
    if (practiceMenuLevel === "closed" || catalog) return;
    void loadPracticeCatalog().then(setCatalog).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить практики.");
    });
  }, [catalog, practiceMenuLevel]);

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
      setAssistantSession(buildAssistantSession(plan, mode, null, sessionKey));
      return;
    }
    const healthCollection = startSummarizingHealthCollectionFromPlan(plan);
    setAssistantSession(buildAssistantSession(plan, mode, healthCollection.getSnapshot(), sessionKey));
    void healthCollection.whenReady().then((health) => {
      setAssistantSession((current) =>
        current?.sessionKey === sessionKey ? { ...current, dayHealthContext: health } : current,
      );
    });
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.screenBg }]}>
      <StatusBar style={theme.scheme === "dark" ? "light" : "dark"} />
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          {plan && plan.mode !== "overdue_summary" && todaySection ? (
            <>
              <AppText variant="screenTitle" accessibilityRole="header">
                {formatDayHeaderDateLabel(todaySection)}
              </AppText>
              {plan.dayRecommendation?.trim() ? (
                <AppText variant="dialogBody">{plan.dayRecommendation.trim()}</AppText>
              ) : null}
            </>
          ) : (
            <AppText variant="screenTitle" accessibilityRole="header">
              День
            </AppText>
          )}
        </View>

        {loading && !plan ? <ActivityIndicator color={theme.colors.accent} /> : null}
        {error ? (
          <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.danger }]}>
            <AppText variant="dialogBody" tone="danger">{error}</AppText>
            <AppButton label="Повторить" onPress={() => void refresh()} />
          </View>
        ) : null}
        {showRefreshingBanner ? (
          <View style={[styles.card, styles.refreshingBanner, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
            <ActivityIndicator color={theme.colors.accent} />
            <AppText variant="technicalCaption" tone="muted">Обновляем день...</AppText>
          </View>
        ) : null}

        {plan ? (
          <>
            {plan.mode === "overdue_summary" ? (
              <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
                <AppText variant="dialogBody" tone="muted">
                  Для анализа данных, подытожьте действия, которые вы планировали ранее.
                </AppText>
                <AppButton label="Подытожить" onPress={() => openAssistant("summary")} />
              </View>
            ) : null}

            {plan.sections.map((section) => (
              <View key={section.localDate} style={styles.sectionGroup}>
                {plan.mode === "overdue_summary" ? (
                  <AppText variant="sectionTitle">{formatLocalDateLabel(section.localDate, section.dateLabelKind)}</AppText>
                ) : null}
                <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
                  <AppText variant="sectionTitle">Действия</AppText>
                  {section.actions.length ? (
                    section.actions.map((action) => (
                      <DayActionRow
                        key={action.id}
                        action={action}
                        readonly={plan.mode === "overdue_summary"}
                        onChanged={() => void refresh({ showRefreshing: true })}
                      />
                    ))
                  ) : (
                    <AppText variant="dialogBody" tone="muted">
                      Пока действий нет. Начните с ассистента, и он поможет собрать день.
                    </AppText>
                  )}
                  {plan.mode === "current_day" && activeSphereStats.length ? (
                    <>
                      <AppText variant="sectionTitle" style={styles.innerSectionTitle}>Сферы жизни</AppText>
                      <SphereRadialChart stats={section.sphereStats} />
                      {section.sphereHint ? <AppText variant="dialogBody" tone="muted">{section.sphereHint}</AppText> : null}
                    </>
                  ) : null}
                  {plan.mode === "empty_today" || plan.mode === "current_day" ? (
                    <AppButton
                      label={hasActions ? "Добавить" : "Что делать?"}
                      onPress={() => openAssistant(hasActions ? "add" : "plan")}
                    />
                  ) : null}
                </View>

                {plan.mode === "overdue_summary" && section.practices.length === 0 ? null : (
                  <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
                    <AppText variant="sectionTitle">Йога</AppText>
                    {section.practices.length ? (
                      <View style={styles.practiceLogList}>
                        {section.practices.map((practice) => {
                          const time = formatPracticeLineTime(practice.startedAt);
                          const duration = formatPracticeDuration(practice.durationSec);
                          return (
                            <AppText key={practice.id} variant="dialogBody" tone="muted">
                              {time ? `${time} ` : ""}{practice.title}{duration ? ` (${duration})` : ""}
                            </AppText>
                          );
                        })}
                      </View>
                    ) : (
                      <AppText variant="dialogBody" tone="muted">
                        Выполните практику йоги, чтобы поддержать в себе способность гармонично проявлять рекомендованные состояния.
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
                            label="Отменить практику"
                            variant="secondary"
                            onPress={() => {
                              void cancelPendingDayPractice(plan.pendingPractice!.id).then(() => refresh({ showRefreshing: true }));
                            }}
                          />
                        </View>
                      ) : (
                        <>
                          <AppButton label="Выбрать практику" onPress={() => setPracticeMenuLevel((value) => value === "closed" ? "root" : "closed")} />
                          {practiceMenuLevel !== "closed" ? (
                            <View style={[styles.practicePicker, { borderColor: theme.colors.surfaceBorder, backgroundColor: theme.colors.surface }]}>
                              {!catalog ? <ActivityIndicator color={theme.colors.accent} /> : null}
                              {catalog ? (
                                <>
                                  {practiceMenuLevel === "root" ? (
                                    <>
                                      {catalog.meditation[0] ? <Pressable style={styles.menuItem} onPress={() => void saveOffer(catalog.meditation[0]!)}><AppText variant="dialogBody">Медитация</AppText></Pressable> : null}
                                      <Pressable style={styles.menuItem} onPress={() => setPracticeMenuLevel("breath")}><AppText variant="dialogBody">Дыхание</AppText></Pressable>
                                      <Pressable style={styles.menuItem} onPress={() => setPracticeMenuLevel("yoga")}><AppText variant="dialogBody">Асаны</AppText></Pressable>
                                    </>
                                  ) : null}
                                  {practiceMenuLevel === "breath" ? (
                                    <>
                                      <Pressable style={styles.menuItem} onPress={() => setPracticeMenuLevel("root")}><AppText variant="dialogBody" tone="muted">‹ Назад</AppText></Pressable>
                                      {catalog.breath.map((practice) => (
                                        <Pressable key={practice.id} style={styles.menuItem} onPress={() => void saveOffer(practice)}><AppText variant="dialogBody">{practice.title}</AppText></Pressable>
                                      ))}
                                    </>
                                  ) : null}
                                  {practiceMenuLevel === "yoga" ? (
                                    <>
                                      <Pressable style={styles.menuItem} onPress={() => setPracticeMenuLevel("root")}><AppText variant="dialogBody" tone="muted">‹ Назад</AppText></Pressable>
                                      {(["20-30", "31-40", "41-50", "50+"] as const).map((bucket) => (
                                        <Pressable
                                          key={bucket}
                                          style={styles.menuItem}
                                          onPress={() => {
                                            const yoga = chooseYogaByBucket(catalog, bucket);
                                            if (yoga) void saveOffer(yoga);
                                          }}
                                        >
                                          <AppText variant="dialogBody">{bucket} минут</AppText>
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
              <AppButton label="Подытожить этот день" onPress={() => openAssistant("summary")} />
            ) : null}
          </>
        ) : null}
      </ScrollView>

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
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    gap: 18,
    padding: 24,
    paddingBottom: 36,
  },
  header: {
    gap: 6,
  },
  sectionGroup: {
    gap: 12,
  },
  card: {
    borderRadius: 24,
    borderWidth: 1,
    gap: 14,
    padding: 18,
  },
  actionCard: {
    gap: 8,
    paddingVertical: 4,
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
  sphereChartWrap: {
    alignItems: "center",
    gap: 12,
  },
  sphereLegend: {
    alignSelf: "stretch",
    gap: 6,
  },
  sphereLegendRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  legendDot: {
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  legendText: {
    flex: 1,
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
