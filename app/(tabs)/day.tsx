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
import { collectDayHealthContext, type DayHealthContext } from "@/services/dayHealthContext";
import {
  cancelPendingDayPractice,
  deleteDayAction,
  loadDayPlan,
  renameDayAction,
  savePendingDayPractice,
  type DayAction,
  type DayPlan,
  type DaySphereStat,
} from "@/services/dayPlan";

type AssistantMode = "plan" | "add" | "summary";
type PracticeMenuLevel = "closed" | "root" | "breath" | "yoga";

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

function formatDateLabel(plan: DayPlan) {
  const [year, month, day] = plan.localDate.split("-").map((part) => Number.parseInt(part, 10));
  const date = new Date(year, (month ?? 1) - 1, day ?? 1, 12, 0, 0);
  const formatted = new Intl.DateTimeFormat("ru", { day: "numeric", month: "long" }).format(date);
  return plan.dateLabelKind === "yesterday" ? `Вчера, ${formatted}` : formatted;
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

function todayLocalDate() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function compactActionTitle(value: string) {
  return value.trim();
}

function dayTargetChakra(plan: DayPlan | null): 1 | 2 | 3 | 4 | 5 | 6 | 7 | null {
  const raw = Number(plan?.forecast?.day_target_chakra);
  return Number.isInteger(raw) && raw >= 1 && raw <= 7 ? raw as 1 | 2 | 3 | 4 | 5 | 6 | 7 : null;
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
}: {
  action: DayAction;
  onChanged: () => void;
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
      <Pressable style={styles.actionMainRow} onPress={() => setExpanded((value) => !value)}>
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
        {!summarized && !editing ? (
          <View style={styles.actionIcons}>
            <Pressable accessibilityRole="button" accessibilityLabel={expanded ? "Свернуть рекомендацию" : "Развернуть рекомендацию"} onPress={() => setExpanded((value) => !value)} style={styles.iconButton}>
              <AppText variant="buttonLabel">{expanded ? "▴" : "▾"}</AppText>
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
      {expanded && !editing ? (
        <AppText variant="dialogBody" tone="muted" style={styles.actionRecommendation}>
          {action.recommendation ?? "Рекомендация появится после обновления ассистента для этого действия."}
        </AppText>
      ) : null}
    </View>
  );
}

function AssistantModal({
  visible,
  mode,
  plan,
  onClose,
  onPracticeOffered,
  dayHealthContext,
}: {
  visible: boolean;
  mode: AssistantMode;
  plan: DayPlan | null;
  onClose: () => void;
  onPracticeOffered: (practice: PracticeSummary) => void | Promise<void>;
  dayHealthContext: DayHealthContext | null;
}) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  if (!visible || !plan) return null;
  const modePrompt =
    mode === "summary"
      ? "Давайте подытожим этот день. Проведите меня по всем неподытоженным действиям и учитывайте, выполнял ли я практики йоги."
      : mode === "add"
        ? "Что бы вы хотели добавить в список действий на этот день?"
        : "Что делать сегодня? Помогите составить список действий на день.";
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
          systemPrompt="Ты эмпатичный наставник приложения Harmonizer. Помоги пользователю заполнить или подытожить вкладку «День»."
          locale="ru"
          useCase="daily_dialog"
          entrySource="day"
          triggerMeta={{
            dayTabMode: mode,
            workingLocalDate: plan.localDate,
            daySummaryRequested: mode === "summary",
            dayActions: plan.actions.map((action) => ({
              id: action.id,
              title: action.title,
              status: action.status,
            })),
            dayPractices: plan.practices,
            dayHealthContext: mode === "summary" ? dayHealthContext : null,
          }}
          autoSendInitialMessage={modePrompt}
          memoryWindow={24}
          onPracticeOffered={onPracticeOffered}
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
  const [plan, setPlan] = useState<DayPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assistantMode, setAssistantMode] = useState<AssistantMode | null>(null);
  const [dayHealthContext, setDayHealthContext] = useState<DayHealthContext | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [catalog, setCatalog] = useState<PracticeCatalog | null>(null);
  const [practiceMenuLevel, setPracticeMenuLevel] = useState<PracticeMenuLevel>("closed");

  const refresh = useCallback(async (options?: { showRefreshing?: boolean }) => {
    setLoading((current) => (plan && !options?.showRefreshing ? current : true));
    setError(null);
    try {
      setPlan(await loadDayPlan());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить день.");
    } finally {
      setLoading(false);
    }
  }, [plan]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  useEffect(() => {
    if (practiceMenuLevel === "closed" || catalog) return;
    void loadPracticeCatalog().then(setCatalog).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить практики.");
    });
  }, [catalog, practiceMenuLevel]);

  const hasActions = (plan?.actions.length ?? 0) > 0;
  const hasUnsummary = (plan?.actions ?? []).some((action) => action.status !== "summarized");
  const activeSphereStats = useMemo(
    () => (plan?.sphereStats ?? []).filter((item) => item.value > 0.001),
    [plan?.sphereStats],
  );
  const isPastUnfinishedDay = plan ? plan.localDate < todayLocalDate() : false;

  const saveOffer = async (practice: PracticeSummary) => {
    if (!plan) return;
    await savePendingDayPractice(plan.localDate, practiceForDayTarget(practice, dayTargetChakra(plan)));
    setPracticeMenuLevel("closed");
    await refresh({ showRefreshing: true });
  };

  const openAssistant = (mode: AssistantMode) => {
    setDayHealthContext(null);
    if (mode !== "summary" || !plan) {
      setAssistantMode(mode);
      return;
    }
    setHealthLoading(true);
    void collectDayHealthContext(plan)
      .then(setDayHealthContext)
      .catch((loadError) => {
        console.warn("[Day] Failed to collect health context", loadError);
      })
      .finally(() => {
        setHealthLoading(false);
        setAssistantMode(mode);
      });
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.screenBg }]}>
      <StatusBar style={theme.scheme === "dark" ? "light" : "dark"} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <AppText variant="screenTitle" accessibilityRole="header">
            {plan ? formatDateLabel(plan) : "День"}
          </AppText>
        </View>

        {loading ? <ActivityIndicator color={theme.colors.accent} /> : null}
        {error ? (
          <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.danger }]}>
            <AppText variant="dialogBody" tone="danger">{error}</AppText>
            <AppButton label="Повторить" onPress={() => void refresh()} />
          </View>
        ) : null}

        {plan ? (
          <>
            {plan.dayRecommendation ? (
              <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
                <AppText variant="sectionTitle">Фокус дня</AppText>
                <AppText variant="dialogBody" tone="muted">{plan.dayRecommendation}</AppText>
              </View>
            ) : null}

            <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
              <AppText variant="sectionTitle">Действия</AppText>
              {hasActions ? (
                plan.actions.map((action) => (
                  <DayActionRow key={action.id} action={action} onChanged={() => void refresh()} />
                ))
              ) : (
                <AppText variant="dialogBody" tone="muted">
                  Пока действий нет. Начните с ассистента, и он поможет собрать день.
                </AppText>
              )}
              {activeSphereStats.length ? (
                <>
                <AppText variant="sectionTitle" style={styles.innerSectionTitle}>Сферы жизни</AppText>
                <SphereRadialChart stats={plan.sphereStats} />
                {plan.sphereHint ? <AppText variant="technicalCaption" tone="muted">{plan.sphereHint}</AppText> : null}
                </>
              ) : null}
              {!isPastUnfinishedDay ? (
                <AppButton
                  label={hasActions ? "Добавить действие" : "Что делать?"}
                  onPress={() => openAssistant(hasActions ? "add" : "plan")}
                />
              ) : null}
            </View>

            <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
              <AppText variant="sectionTitle">Йога</AppText>
              {plan.practices.length ? (
                <View style={styles.practiceLogList}>
                  {plan.practices.map((practice) => {
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

              {plan.pendingPractice ? (
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
                !isPastUnfinishedDay ? (
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
                ) : null
              )}
            </View>

            {hasUnsummary ? (
              <>
                {healthLoading ? <ActivityIndicator color={theme.colors.accent} /> : null}
                <AppButton label="Подытожить этот день" onPress={() => openAssistant("summary")} />
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      <AssistantModal
        visible={assistantMode != null}
        mode={assistantMode ?? "plan"}
        plan={plan}
        dayHealthContext={dayHealthContext}
        onPracticeOffered={async (practice) => {
          if (!plan) return;
          await savePendingDayPractice(plan.localDate, practiceForDayTarget(practice, dayTargetChakra(plan)));
          await refresh({ showRefreshing: true });
        }}
        onClose={() => {
          setAssistantMode(null);
          void refresh({ showRefreshing: true });
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
