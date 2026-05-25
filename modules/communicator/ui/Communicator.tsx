import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from "expo-av";
import { getInfoAsync, readAsStringAsync } from "expo-file-system/legacy";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Animated,
  AppState,
  Image,
  InteractionManager,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { FlashList, type FlashListRef, type ListRenderItem } from "@shopify/flash-list";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { mimeFromRecordingUri } from "@/modules/communicator/core/audioMime";
import {
  deleteVoiceRecordingFile,
  transcribeVoiceRecording,
  type RetainedVoiceRecording,
} from "@/modules/communicator/core/voiceTurnPipeline";
import { stripDialogScaffoldMarkdown } from "@/modules/communicator/core/dialogTextCleanup";
import {
  mergeExportMessages,
  reconcileExportPlanningPersistence,
  type ExportMessageSnapshot,
} from "@/modules/communicator/core/dialogExportMerge";
import {
  isFinalLikeTurnMode,
  mergeCompleteWithSession,
  needsAssistantTurnHydration,
  sessionAssistantMatchesTurn,
  type SessionAssistantTurnMeta,
} from "@/modules/communicator/core/dialogTurnHydration";
import { isSpuriousTranscription } from "@/modules/communicator/core/transcriptionGuard";
import { getCommunicatorStrings, type CommunicatorLocale } from "@/modules/communicator/i18n/communicator";
import { getUserErrorStrings } from "@/modules/ui/i18n/userErrors";
import { logErrorForDevelopers, resolveUserFacingAlert } from "@/services/userFacingErrors";
import { sliceHistoryForWindow } from "@/modules/communicator/core/session-helpers";
import {
  communicatorRecordingFallbackOptions,
  whisperRecordingOptions,
} from "@/modules/communicator/core/whisperRecording";
import type {
  CommunicatorHistoryMessage,
  CommunicatorInitialMode,
  CommunicatorModePolicy,
  CommunicatorSessionState,
  EmotionSegmentPayload,
} from "@/modules/communicator/core/types";
import {
  buildClientTurnHistory,
  fetchDialogSession,
  type DialogCompleteEvent,
  type DialogSessionMessage,
  type DialogueEntrySource,
  type DialogueUseCase,
  type PracticePicked,
} from "@/services/communicator-client";
import {
  clearDialogSessionCache,
  loadDialogSessionCache,
  saveDialogSessionCache,
} from "@/services/dialogSessionCache";
import { useAuth } from "@/modules/auth";
import { AppText } from "@/modules/ui/AppText";
import { COMMUNICATOR_MODEL_LABEL, COMMUNICATOR_TEXT_MODE_ENABLED, HARMONIZER_TEST_MODE } from "@/modules/ui/testMode";
import { useTheme } from "@/modules/ui/theme";
import type { PracticeLaunchParams, PracticeSummary } from "@/modules/practices/core/types";
import { launchPractice } from "@/modules/practices/ui/launchPractice";
import { PracticeCard as SharedPracticeCard } from "@/modules/practices/ui/PracticeCard";

import { AssistantBubble } from "./AssistantBubble";
import { ModeToggle } from "./ModeToggle";
import { ScrollDownHint } from "./ScrollDownHint";
import { StreamingAssistantLines } from "./StreamingAssistantLines";
import { UserBubble } from "./UserBubble";
import { useCommunicatorStream } from "./useCommunicatorStream";

const micOn = require("@/assets/icons/mic_button_on.png");
const micOff = require("@/assets/icons/mic_button_off.png");

function resolveUiMode(props: {
  mode?: CommunicatorModePolicy;
  initialMode?: CommunicatorInitialMode;
}): { uiMode: "VOICE" | "TXT"; canSwitch: boolean } {
  if (!COMMUNICATOR_TEXT_MODE_ENABLED) return { uiMode: "VOICE", canSwitch: false };
  const m = props.mode;
  if (m === "VOICE_ONLY") return { uiMode: "VOICE", canSwitch: false };
  if (m === "TXT_ONLY") return { uiMode: "TXT", canSwitch: false };
  if (m === "VOICE") return { uiMode: "VOICE", canSwitch: true };
  if (m === "TXT") return { uiMode: "TXT", canSwitch: true };
  return { uiMode: props.initialMode ?? "VOICE", canSwitch: true };
}

function newMessageId(): string {
  const c = globalThis.crypto;
  if (c && "randomUUID" in c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

type PendingAssistantCommit =
  | { mode: "append"; message: CommunicatorHistoryMessage }
  | { mode: "replaceInitiate"; message: CommunicatorHistoryMessage };

type CommunicatorListRow =
  | { kind: "user"; id: string; message: CommunicatorHistoryMessage }
  | { kind: "assistant"; id: string; message: CommunicatorHistoryMessage }
  | { kind: "stream"; id: "__stream__" };

/** Короткие ответы — сразу в историю, без отложенного «догона» после сети. */
const SHORT_ASSISTANT_DEFER_THRESHOLD = 14;
const SESSION_HYDRATION_RETRY_DELAYS_MS = [700, 1400, 2600] as const;

/** Пузырь пользователя (голос) — якорь ~¼ высоты экрана, место под расшифровку и ответ. */
const VOICE_USER_SCROLL_VIEW_POSITION = 0.24;

const MARKER_RE = /\[(STATE_PROPOSAL|PRACTICE_PICK|CORRECT_RECOMMENDATION|PLANNED_EVENT|SUMMARIZE_EVENT|MATRIX_CELLS):[^\]]*\]|\[\s*PLAN_TOMORROW\s*\]/gi;
const READY_MARKER_RE = /\[\s*ready_for_recommendation\s*\]/gi;
const TRAILING_OPEN_MARKER_RE = /\[[A-Z_]+(?::[^\]]*)?$/i;

/**
 * Strip LLM-internal markers from partially-streamed text so the user
 * never sees raw `[PRACTICE_PICK: ...]` etc. in the chat bubble.
 * Also handles an incomplete trailing marker that hasn't closed yet.
 */
function stripStreamingMarkers(text: string): string {
  return text
    .replace(MARKER_RE, "")
    .replace(READY_MARKER_RE, "")
    .replace(TRAILING_OPEN_MARKER_RE, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/**
 * Итоговый текст: `complete.fullText` приходит уже sanitized (без маркеров),
 * поэтому он авторитетнее агрегата SSE-чанков (raw, содержит маркеры).
 * Используем SSE-агрегат только если `complete.fullText` пуст.
 */
function resolveAssistantReplyText(streamed: string, completeFullText: string | undefined): string {
  const fin = stripDialogScaffoldMarkdown((completeFullText ?? "").trim());
  if (fin) return fin;
  return stripDialogScaffoldMarkdown(stripStreamingMarkers((streamed ?? "").trim()));
}

function ensureIds(
  list: CommunicatorHistoryMessage[] | undefined,
): CommunicatorHistoryMessage[] {
  if (!list?.length) return [];
  return list.map((m) => ({
    ...m,
    id: m.id || newMessageId(),
  }));
}

/**
 * Server stores meta in snake_case (turn_mode, model_used, model_id),
 * but in-session messages use camelCase (turnMode, modelTier, modelUsed).
 * This normalizes both conventions into the camelCase shape the client expects.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeMessageMeta(raw: any): CommunicatorHistoryMessage["meta"] {
  if (!raw) return undefined;
  const insightMetrics = raw.insightMetrics ?? raw.insight_metrics;
  return {
    turnMode: raw.turnMode ?? raw.turn_mode,
    modelTier: raw.modelTier ?? raw.model_used,
    modelUsed: raw.modelUsed ?? raw.model_id,
    iteration: raw.iteration,
    insightMetrics,
    csi: raw.csi ?? insightMetrics?.csi,
    practicePicked: raw.practicePicked ?? raw.practice_picked,
    readyMarkerTriggered: raw.readyMarkerTriggered ?? raw.ready_marker_triggered,
    validation: raw.validation,
    shouldClose: raw.shouldClose ?? raw.should_close,
    recommendationCorrected: raw.recommendationCorrected ?? raw.recommendation_corrected,
    orchestratorDecision: raw.orchestratorDecision ?? raw.orchestrator_decision,
    branches: raw.branches ?? raw.dialog_branches,
    phaseTime: raw.phaseTime ?? raw.phase_time,
    targetChakra: raw.targetChakra ?? raw.target_chakra,
    relatedEventIds: raw.relatedEventIds ?? raw.related_event_ids,
    matrixCells: raw.matrixCells ?? raw.matrix_cells,
    skippedPlannedEvents: raw.skippedPlannedEvents ?? raw.skipped_planned_events,
    planningPersistence: raw.planningPersistence ?? raw.planning_persistence,
    debug: raw.debug,
  };
}


function completeFromSessionMessage(
  message: DialogSessionMessage,
  recoveredText: string,
  currentComplete?: DialogCompleteEvent | null,
): DialogCompleteEvent {
  const normalizedMeta = normalizeMessageMeta(message.meta) as SessionAssistantTurnMeta | undefined;
  const merged = mergeCompleteWithSession({
    complete: currentComplete,
    sessionMeta: normalizedMeta,
    sessionText: recoveredText,
    sessionMessageId: message.id,
  });
  return {
    ...merged,
    branches:
      Array.isArray((message.meta as { branches?: unknown } | undefined)?.branches)
        ? ((message.meta as { branches?: string[] }).branches)
        : Array.isArray((message.meta as { dialog_branches?: unknown } | undefined)?.dialog_branches)
          ? ((message.meta as { dialog_branches?: string[] }).dialog_branches)
          : merged.branches,
    phaseTime:
      typeof (message.meta as { phaseTime?: unknown } | undefined)?.phaseTime === "string"
        ? ((message.meta as { phaseTime: string }).phaseTime)
        : typeof (message.meta as { phase_time?: unknown } | undefined)?.phase_time === "string"
          ? ((message.meta as { phase_time: string }).phase_time)
          : merged.phaseTime,
    targetChakra:
      ((message.meta as { targetChakra?: unknown; target_chakra?: unknown } | undefined)?.targetChakra as DialogCompleteEvent["targetChakra"])
      ?? ((message.meta as { target_chakra?: unknown } | undefined)?.target_chakra as DialogCompleteEvent["targetChakra"])
      ?? merged.targetChakra,
  };
}

function parseIntParam(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Убирает устаревший хвост из `reason` (старые ответы API / кэш сессии). */
function stripLegacyPracticeCardReason(reason: string | null | undefined): string | undefined {
  if (reason == null || !reason.trim()) return reason ?? undefined;
  const tails = [
    "Рядом с тем, о чём вы написали:",
    "Рядом с вашим запросом:",
    "It meets you where you are with:",
    "It connects with",
  ];
  let t = reason.trim();
  for (const head of tails) {
    const i = t.indexOf(head);
    if (i >= 0) t = t.slice(0, i).trim();
  }
  const out = t.replace(/[.,…\s]+$/g, "").trim();
  return out || undefined;
}

function normalizePracticeVideo(video: PracticePicked["video"]): PracticeSummary["video"] | undefined {
  if (!video) return undefined;
  return {
    provider: video.provider,
    url: video.url ?? undefined,
    externalId: video.externalId ?? undefined,
    thumbnail: video.thumbnail ?? null,
  };
}

function practiceToSummary(practice: PracticePicked): PracticeSummary | null {
  const launchParams = practice.launch?.params ?? {};
  const durationMs = parseIntParam(launchParams.durationMs);
  const chakra = parseIntParam(launchParams.chakra);
  const baseChakra = practice.chakraIds?.[0] ?? chakra;
  const slug = practice.slug ?? practice.id;

  if (practice.kind === "breath") {
    return {
      id: practice.id,
      slug,
      kind: "breath",
      title: practice.name ?? slug,
      description: stripLegacyPracticeCardReason(practice.card_blurb ?? practice.reason) ?? undefined,
      defaultDurationSec: practice.durationSec ?? (durationMs ? Math.round(durationMs / 1000) : undefined),
      minDurationSec: practice.minDurationSec ?? undefined,
      maxDurationSec: practice.maxDurationSec ?? undefined,
      durationPolicy:
        practice.minDurationSec != null && practice.maxDurationSec != null && practice.minDurationSec !== practice.maxDurationSec
          ? "user_selectable"
          : "fixed",
      chakraIds: (practice.chakraIds ?? []).filter((value): value is number => Number.isInteger(value)) as PracticeSummary["chakraIds"],
      primaryChakra: typeof baseChakra === "number" ? (baseChakra as PracticeSummary["primaryChakra"]) : undefined,
      source: "breath_catalog",
      video: normalizePracticeVideo(practice.video),
      launch: {
        kind: "breath",
        route: "/breath-coherence",
        practiceId: (launchParams.practiceId ?? slug) as never,
        durationMs: durationMs ?? (practice.durationSec ?? 600) * 1000,
        chakra: (chakra ?? baseChakra ?? 4) as NonNullable<PracticeLaunchParams["chakra"]>,
        usePulseSensor: launchParams.usePulseSensor !== "false",
      },
    };
  }

  if (practice.kind === "meditation") {
    return {
      id: practice.id,
      slug,
      kind: "meditation",
      title: practice.name ?? slug,
      description: stripLegacyPracticeCardReason(practice.card_blurb ?? practice.reason) ?? undefined,
      defaultDurationSec: practice.durationSec ?? (durationMs ? Math.round(durationMs / 1000) : undefined),
      minDurationSec: practice.minDurationSec ?? undefined,
      maxDurationSec: practice.maxDurationSec ?? undefined,
      durationPolicy:
        practice.minDurationSec != null && practice.maxDurationSec != null && practice.minDurationSec !== practice.maxDurationSec
          ? "user_selectable"
          : "fixed",
      chakraIds: (practice.chakraIds ?? []).filter((value): value is number => Number.isInteger(value)) as PracticeSummary["chakraIds"],
      primaryChakra: typeof baseChakra === "number" ? (baseChakra as PracticeSummary["primaryChakra"]) : undefined,
      source: "static",
      video: normalizePracticeVideo(practice.video),
      launch: {
        kind: "meditation",
        route: "/sacred-symbol-stream",
        practiceId: launchParams.practiceId ?? slug,
        durationMs: durationMs ?? (practice.durationSec ? practice.durationSec * 1000 : undefined),
        chakra: typeof (chakra ?? baseChakra) === "number"
          ? ((chakra ?? baseChakra) as PracticeLaunchParams["chakra"])
          : undefined,
      },
    };
  }

  if (practice.kind === "yoga") {
    return {
      id: practice.id,
      slug,
      kind: "yoga",
      title: practice.name ?? slug,
    description: stripLegacyPracticeCardReason(practice.card_blurb ?? practice.reason) ?? undefined,
      defaultDurationSec: practice.durationSec ?? undefined,
      minDurationSec: practice.minDurationSec ?? undefined,
      maxDurationSec: practice.maxDurationSec ?? undefined,
      durationPolicy: "fixed",
      chakraIds: (practice.chakraIds ?? []).filter((value): value is number => Number.isInteger(value)) as PracticeSummary["chakraIds"],
      primaryChakra: typeof baseChakra === "number" ? (baseChakra as PracticeSummary["primaryChakra"]) : undefined,
      source: "supabase",
      video: normalizePracticeVideo(practice.video),
      launch: {
        kind: "yoga",
        route: "/asana-practice",
        practiceId: launchParams.practiceId ?? practice.id,
        durationMs: durationMs ?? (practice.durationSec ? practice.durationSec * 1000 : undefined),
        chakra: typeof (chakra ?? baseChakra) === "number"
          ? ((chakra ?? baseChakra) as PracticeLaunchParams["chakra"])
          : undefined,
      },
    };
  }

  return null;
}

function summaryToPractice(practice: PracticePicked, configured: PracticeSummary): PracticePicked {
  if (configured.launch.kind === "breath") {
    return {
      ...practice,
      durationSec: Math.round(configured.launch.durationMs / 1000),
      chakraIds: [configured.launch.chakra],
      launch: {
        route: configured.launch.route,
        params: {
          practiceId: configured.launch.practiceId,
          durationMs: String(configured.launch.durationMs),
          chakra: String(configured.launch.chakra),
          ...(typeof configured.launch.usePulseSensor === "boolean"
            ? { usePulseSensor: String(configured.launch.usePulseSensor) }
            : {}),
        },
      },
    };
  }

  if (configured.launch.kind === "meditation") {
    return {
      ...practice,
      durationSec: configured.launch.durationMs ? Math.round(configured.launch.durationMs / 1000) : practice.durationSec,
      chakraIds: configured.launch.chakra ? [configured.launch.chakra] : practice.chakraIds,
      launch: {
        route: configured.launch.route,
        params: {
          practiceId: configured.launch.practiceId,
          ...(configured.launch.durationMs ? { durationMs: String(configured.launch.durationMs) } : {}),
          ...(configured.launch.chakra ? { chakra: String(configured.launch.chakra) } : {}),
        },
      },
    };
  }

  return {
    ...practice,
    launch: {
      route: configured.launch.route,
      params: {
        practiceId: configured.launch.practiceId,
        ...(configured.launch.durationMs ? { durationMs: String(configured.launch.durationMs) } : {}),
        ...(configured.launch.chakra ? { chakra: String(configured.launch.chakra) } : {}),
      },
    },
  };
}

export interface CommunicatorProps {
  initialMode?: CommunicatorInitialMode;
  mode?: CommunicatorModePolicy;
  systemPrompt: string;
  locale?: CommunicatorLocale;
  useCase?: DialogueUseCase;
  entrySource?: DialogueEntrySource;
  triggerMeta?: Record<string, unknown>;
  conversationId?: string | null;
  history?: CommunicatorHistoryMessage[];
  /** Последние N пар сообщений в запросе; без ограничения — вся переданная история */
  memoryWindow?: number;
  /**
   * Автоматически отправить это сообщение от имени пользователя при
   * монтировании (эквивалент ручного ввода + send). Используется, когда
   * другой модуль открывает коммуникатор с заранее заданным контекстом
   * для обсуждения — например, «Обсудить результаты практики» из BREATH.
   *
   * Отправляется ровно один раз на mount: смена значения после первого
   * рендера эффекта не повторит отправку (ref-guard). Если надо запустить
   * новый auto-send — пере-смонтируй компонент (например, `key` по id
   * очереди).
   */
  autoSendInitialMessage?: string;
  onEmotionSegment?: (payload: EmotionSegmentPayload) => void;
  onMessage?: (msg: CommunicatorHistoryMessage) => void;
  onPracticePicked?: (practice: PracticePicked) => void;
  onError?: (err: Error) => void;
  onAbort?: () => void;
  onStateChange?: (state: CommunicatorSessionState) => void;
}

type Phase = "idle" | "arming" | "recording" | "transcribing" | "error";

const MIN_VOICE_MS = 450;
const LOW_TRANSCRIPTION_CONFIDENCE = 0.65;

function isGeminiJsonError(error: Error): boolean {
  return /Gemini response is not valid JSON/i.test(error.message);
}

function isRecorderPrepareError(error: Error): boolean {
  return /prepare.*recorder|recorder not prepared|prepareToRecord/i.test(error.message);
}

function tierLabelFromProfile(profile: { membership_tier?: string | null; trial_expires_at?: string | null } | null): string {
  if (!profile) return COMMUNICATOR_MODEL_LABEL;
  if (profile.membership_tier === "premium") return "premium";
  if (profile.membership_tier === "free" && profile.trial_expires_at) {
    if (new Date(profile.trial_expires_at).getTime() > Date.now()) return "premium";
  }
  return "standard";
}

function ModelBadge({ model, accessTier }: { model?: string; accessTier: string }) {
  const theme = useTheme();
  if (!__DEV__) return null;
  return (
    <View style={[styles.modelBadge, { borderColor: theme.colors.surfaceBorder, backgroundColor: theme.colors.controlButtonBg }]}>
      <AppText variant="technicalCaption" tone="muted">
        model: {model ?? accessTier}
      </AppText>
    </View>
  );
}

function RecordingAura({ level }: { level: Animated.Value }) {
  const theme = useTheme();
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.recordingAura,
        {
          borderColor: theme.colors.accent,
          opacity: level.interpolate({
            inputRange: [0, 1],
            outputRange: [0.18, 0.42],
          }),
          transform: [
            {
              scale: level.interpolate({
                inputRange: [0, 1],
                outputRange: [1.05, 1.35],
              }),
            },
          ],
        },
      ]}
    />
  );
}

export function Communicator({
  initialMode,
  mode,
  systemPrompt,
  locale,
  useCase = "daily_dialog",
  entrySource = "home",
  triggerMeta,
  conversationId,
  history,
  memoryWindow,
  onEmotionSegment,
  onMessage,
  onPracticePicked,
  onError,
  onAbort,
  onStateChange,
}: CommunicatorProps) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { profile, profileLoading } = useAuth();
  const localDialogUserId = profile?.id ?? null;
  const modelAccessTier = useMemo(() => tierLabelFromProfile(profile), [profile]);
  const strings = useMemo(() => getCommunicatorStrings(locale ?? "ru"), [locale]);

  const resolved = useMemo(
    () => resolveUiMode({ mode, initialMode }),
    [mode, initialMode],
  );

  const [uiMode, setUiMode] = useState(resolved.uiMode);
  const canSwitchMode = resolved.canSwitch;
  const canSwitchInputMode = canSwitchMode;

  useEffect(() => {
    setUiMode(resolved.uiMode);
  }, [resolved.uiMode]);

  const [messages, setMessages] = useState<CommunicatorHistoryMessage[]>([]);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [pendingRevealGoal, setPendingRevealGoal] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [activeConversationId, setActiveConversationId] = useState<string | null>(conversationId ?? null);
  const [sessionSynced, setSessionSynced] = useState(false);
  const [txtDraft, setTxtDraft] = useState("");
  const [pendingTranscript, setPendingTranscript] = useState<string | null>(null);
  const [pendingTranscriptConfidence, setPendingTranscriptConfidence] = useState<number | undefined>(undefined);
  /** Инкремент для привязки скролла к голосовому пузырю после добавления/замены текста */
  const [voiceAnchorTick, setVoiceAnchorTick] = useState(0);
  /** После голоса не дёргаем авто-якорь к строке стрима ассистента — окно остаётся на месте */
  const [suppressStreamAnchorScroll, setSuppressStreamAnchorScroll] = useState(false);
  const initialHistoryRef = useRef<CommunicatorHistoryMessage[]>(ensureIds(sliceHistoryForWindow(history, memoryWindow)));

  useEffect(() => {
    initialHistoryRef.current = ensureIds(sliceHistoryForWindow(history, memoryWindow));
  }, [history, memoryWindow]);

  const retryHandlerRef = useRef<(() => void) | null>(null);
  const initiateFiredRef = useRef(false);

  const reportError = useCallback(
    (err: Error) => {
      if (isGeminiJsonError(err)) return;
      const recorderPrepareError = isRecorderPrepareError(err);
      if (recorderPrepareError) {
        console.warn("[Communicator]", err.message, err.stack ?? "");
        onError?.(err);
        Alert.alert(strings.sendErrorTitle, strings.recorderPrepareErrorMessage, [
          { text: strings.alertOk },
        ]);
        return;
      }
      logErrorForDevelopers("Communicator", err);
      onError?.(err);
      const copy = resolveUserFacingAlert(err, strings.locale, { genericTitle: strings.sendErrorTitle });
      const userErrors = getUserErrorStrings(strings.locale);
      const buttons: { text: string; style?: "cancel"; onPress?: () => void }[] = [
        { text: userErrors.dismissButton, style: "cancel" },
      ];
      if (copy.retryable && retryHandlerRef.current) {
        buttons.unshift({
          text: userErrors.retryButton,
          onPress: () => {
            const retry = retryHandlerRef.current;
            if (retry) retry();
          },
        });
      }
      Alert.alert(copy.title, copy.message, buttons);
    },
    [onError, strings.alertOk, strings.locale, strings.recorderPrepareErrorMessage, strings.sendErrorTitle],
  );

  const {
    assistantText,
    decision,
    modelUsed,
    status: streamStatus,
    run: runChatStream,
    abort: abortChatStream,
    reset: resetChatStream,
    syncDisplayText: syncChatStreamDisplayText,
    isBusy: streamBusy,
  } = useCommunicatorStream();

  const recordingRef = useRef<Audio.Recording | null>(null);
  /** Плейсхолдер-пузырь пользователя на время расшифровки голоса; сбрасывается при ошибке до замены на текст */
  const voicePendingMessageIdRef = useRef<string | null>(null);
  /** URI записи до успешного ответа ассистента — для повторной отправки и удаления после успеха */
  const retainedVoiceRef = useRef<RetainedVoiceRecording | null>(null);
  /** Якорь скролла к последнему голосовому сообщению (id строки в `messages`) */
  const voiceUserAnchorMessageIdRef = useRef<string | null>(null);
  /** Не дублировать scrollToIndex на каждый чанк стрима при том же `voiceAnchorTick`. */
  const lastVoiceLayoutScrollTickRef = useRef(-1);
  const prevStreamBusyForScrollRef = useRef(false);
  const recordStartRef = useRef(0);
  const suppressClickRef = useRef(false);
  const suppressAbortAfterRecordRef = useRef(false);
  /** true от старта startRecording до момента, пока запись реально не пошла (в т.ч. показ системного окна разрешений) */
  const micWarmupRef = useRef(false);
  /** Пока ждём ответ в системном диалоге разрешения микрофона — нельзя отменять warmup по onPressOut (палец уже не на кнопке). */
  const awaitingMicPermissionRef = useRef(false);
  const startRecordingGenerationRef = useRef(0);
  /** Сброс нативного «залипания» Pressable после отмены / отказа в разрешениях */
  const [micPressResetKey, setMicPressResetKey] = useState(0);
  const voiceLevel = useRef(new Animated.Value(0.1)).current;

  /** Пока нативный рекордер готовится — лёгкая пульсация ауры (фаза `arming`). */
  useEffect(() => {
    if (phase !== "arming") return;
    voiceLevel.setValue(0.14);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(voiceLevel, {
          toValue: 0.34,
          duration: 360,
          useNativeDriver: true,
        }),
        Animated.timing(voiceLevel, {
          toValue: 0.14,
          duration: 360,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [phase, voiceLevel]);

  const scrollRef = useRef<FlashListRef<CommunicatorListRow> | null>(null);
  const [scrollViewH, setScrollViewH] = useState(0);
  const [contentH, setContentH] = useState(0);
  const [scrollY, setScrollY] = useState(0);

  const programmaticScrollRef = useRef(false);
  const scrollHintDismissedRef = useRef(true);
  const streamScrollUserAdjustedRef = useRef(false);
  const prevStreamBusyRef = useRef(false);
  const prevContentHRef = useRef(0);
  const userHasScrolledUpRef = useRef(false);
  const [showScrollDown, setShowScrollDown] = useState(false);

  const sessionState: CommunicatorSessionState = useMemo(() => {
    let p: CommunicatorSessionState["phase"] = "idle";
    if (phase === "recording" || phase === "arming") p = "recording";
    else if (phase === "transcribing") p = "processing";
    else if (streamStatus === "thinking") p = "thinking";
    else if (streamStatus === "typing") p = "typing";
    else if (phase === "error") p = "error";
    return { phase: p, uiMode, canSwitchMode: canSwitchInputMode };
  }, [phase, streamStatus, uiMode, canSwitchInputMode]);

  useEffect(() => {
    onStateChange?.(sessionState);
  }, [sessionState, onStateChange]);

  useEffect(() => {
    if (streamBusy) {
      voiceUserAnchorMessageIdRef.current = null;
    }
    if (prevStreamBusyForScrollRef.current && !streamBusy) {
      setSuppressStreamAnchorScroll(false);
    }
    prevStreamBusyForScrollRef.current = streamBusy;
  }, [streamBusy]);

  const isBusy =
    phase === "arming" || phase === "recording" || phase === "transcribing" || streamBusy;

  useEffect(() => {
    if (profileLoading) return;
    const ac = new AbortController();
    let cancelled = false;
    setSessionSynced(false);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

    void (async () => {
      try {
        const cached = localDialogUserId
          ? await loadDialogSessionCache({
              userId: localDialogUserId,
              useCase,
              entrySource,
              timeZone: timezone,
            })
          : null;
        if (cancelled) return;

        const session = await fetchDialogSession({
          useCase,
          entrySource,
          ...(conversationId ? { conversationId } : {}),
          signal: ac.signal,
        });
        if (cancelled) return;

        const serverReset = session.reset || !session.conversationId;
        if (serverReset) {
          if (localDialogUserId) {
            await clearDialogSessionCache({
              userId: localDialogUserId,
              useCase,
              entrySource,
              timeZone: timezone,
            });
          }
          initiateFiredRef.current = false;
          setActiveConversationId(null);
          const seed = initialHistoryRef.current;
          setMessages(seed.length ? [...seed] : []);
          return;
        }

        const cachedMessages = (cached?.messages ?? []).filter(
          (m) => !(m.role === "assistant" && !m.content?.trim()),
        );
        if (
          cached
          && cached.conversationId === session.conversationId
          && cachedMessages.length > 0
        ) {
          setActiveConversationId(session.conversationId);
          setMessages(
            ensureIds(
              sliceHistoryForWindow(
                cachedMessages.map((message) => ({
                  id: message.id,
                  role: message.role,
                  content: message.content,
                  createdAt: message.createdAt,
                  meta: normalizeMessageMeta(message.meta),
                })),
                memoryWindow,
              ),
            ),
          );
          return;
        }

        setActiveConversationId(session.conversationId);
        const serverMessages = session.messages.filter(
          (m) => !(m.role === "assistant" && !m.content?.trim()),
        );
        if (serverMessages.length > 0) {
          setMessages(
            ensureIds(
              sliceHistoryForWindow(
                serverMessages.map((message) => ({
                  id: message.id,
                  role: message.role,
                  content: message.content,
                  createdAt: message.createdAt,
                  meta: normalizeMessageMeta(message.meta),
                })),
                memoryWindow,
              ),
            ),
          );
          return;
        }

        const seed = initialHistoryRef.current;
        setMessages(seed.length ? [...seed] : []);
      } catch (error) {
        if (cancelled || ac.signal.aborted) return;
        reportError(error instanceof Error ? error : new Error(String(error)));
        setMessages(initialHistoryRef.current);
        setActiveConversationId(conversationId ?? null);
      } finally {
        if (!cancelled) setSessionSynced(true);
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [conversationId, entrySource, localDialogUserId, memoryWindow, profileLoading, reportError, useCase]);

  useEffect(() => {
    if (!sessionSynced || !localDialogUserId) return;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");
    const shouldClear = messages.length === 0 || latestAssistant?.meta?.shouldClose === true;
    if (shouldClear) {
      void clearDialogSessionCache({
        userId: localDialogUserId,
        useCase,
        entrySource,
        timeZone: timezone,
      });
      return;
    }

    void saveDialogSessionCache({
      userId: localDialogUserId,
      useCase,
      entrySource,
      timeZone: timezone,
      conversationId: activeConversationId,
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        meta: message.meta,
      })),
    });
  }, [activeConversationId, entrySource, localDialogUserId, messages, sessionSynced, useCase]);

  const updateScrollDownFlag = useCallback(() => {
    if (scrollHintDismissedRef.current) {
      setShowScrollDown(false);
      return;
    }
    const gap = contentH - scrollY - scrollViewH;
    setShowScrollDown(gap > 56);
  }, [contentH, scrollY, scrollViewH]);

  const streamBusyRef = useRef(false);
  useEffect(() => {
    streamBusyRef.current = streamBusy;
  }, [streamBusy]);

  useLayoutEffect(() => {
    const prev = prevStreamBusyRef.current;
    if (streamBusy && !prev) {
      userHasScrolledUpRef.current = false;
      scrollHintDismissedRef.current = false;
      streamScrollUserAdjustedRef.current = false;
    }
    prevStreamBusyRef.current = streamBusy;
  }, [streamBusy]);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      setScrollY(y);
      if (!programmaticScrollRef.current) {
        const gap = contentH - y - scrollViewH;
        userHasScrolledUpRef.current = gap > 80;
        scrollHintDismissedRef.current = true;
        if (streamBusy) streamScrollUserAdjustedRef.current = true;
        if (scrollHintDismissedRef.current) {
          setShowScrollDown(false);
        } else {
          setShowScrollDown(gap > 56);
        }
      }
    },
    [contentH, scrollViewH, streamBusy],
  );

  useEffect(() => {
    if (!streamBusy) return;
    if (streamScrollUserAdjustedRef.current) {
      updateScrollDownFlag();
    }
  }, [
    assistantText,
    streamBusy,
    updateScrollDownFlag,
  ]);

  const scrollToBottom = useCallback(() => {
    userHasScrolledUpRef.current = false;
    scrollRef.current?.scrollToEnd({ animated: true });
    scrollHintDismissedRef.current = true;
    setShowScrollDown(false);
  }, []);

  const pendingAssistantCommitRef = useRef<PendingAssistantCommit | null>(null);
  const deferredRevealForceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDeferredRevealForceTimer = useCallback(() => {
    if (deferredRevealForceTimerRef.current != null) {
      clearTimeout(deferredRevealForceTimerRef.current);
      deferredRevealForceTimerRef.current = null;
    }
  }, []);

  const flushPendingAssistantCommit = useCallback(() => {
    const p = pendingAssistantCommitRef.current;
    pendingAssistantCommitRef.current = null;
    clearDeferredRevealForceTimer();
    setPendingRevealGoal(null);
    if (!p) return;
    if (p.mode === "append") {
      setMessages((prev) => [...prev, p.message]);
    } else {
      setMessages([p.message]);
    }
    onMessage?.(p.message);
    resetChatStream();
  }, [clearDeferredRevealForceTimer, onMessage, resetChatStream]);

  const clearRetainedVoice = useCallback(async () => {
    const snap = retainedVoiceRef.current;
    retainedVoiceRef.current = null;
    voicePendingMessageIdRef.current = null;
    if (snap?.uri) await deleteVoiceRecordingFile(snap.uri);
  }, []);

  const scheduleDeferredAssistantCommit = useCallback(
    (p: PendingAssistantCommit) => {
      setPendingRevealGoal(stripDialogScaffoldMarkdown(stripStreamingMarkers(p.message.content)));
      pendingAssistantCommitRef.current = p;
      clearDeferredRevealForceTimer();
      deferredRevealForceTimerRef.current = setTimeout(() => {
        deferredRevealForceTimerRef.current = null;
        flushPendingAssistantCommit();
      }, 60_000);
    },
    [clearDeferredRevealForceTimer, flushPendingAssistantCommit],
  );

  const onStreamFullyRevealed = useCallback(() => {
    if (!pendingAssistantCommitRef.current) return;
    flushPendingAssistantCommit();
  }, [flushPendingAssistantCommit]);

  const strippedStreamTarget = useMemo(
    () => stripDialogScaffoldMarkdown(stripStreamingMarkers(assistantText)),
    [assistantText],
  );

  const communicatorListData = useMemo((): CommunicatorListRow[] => {
    const rows: CommunicatorListRow[] = [];
    for (const m of messages) {
      rows.push(
        m.role === "user"
          ? { kind: "user", id: m.id, message: m }
          : { kind: "assistant", id: m.id, message: m },
      );
    }
    if (streamBusy) rows.push({ kind: "stream", id: "__stream__" });
    return rows;
  }, [messages, streamBusy]);

  const communicatorListDataRef = useRef(communicatorListData);
  communicatorListDataRef.current = communicatorListData;
  const lastHydrationDebugRef = useRef<Record<string, unknown> | null>(null);

  const hydrateAssistantTurnFromSession = useCallback(
    async (params: {
      currentText: string;
      currentComplete?: DialogCompleteEvent | null;
    }): Promise<{ text: string; complete: DialogCompleteEvent } | null> => {
      const errors: string[] = [];
      let attempts = 0;
      let lastSyncConversationId: string | null = null;
      let lastRole: string | null = null;
      let lastRecoveredTextLength = 0;
      let lastMismatch = false;

      for (const delayMs of SESSION_HYDRATION_RETRY_DELAYS_MS) {
        await new Promise((r) => setTimeout(r, delayMs));
        attempts += 1;
        try {
          const sync = await fetchDialogSession({
            useCase,
            entrySource,
            conversationId: activeConversationId ?? undefined,
          });
          lastSyncConversationId = sync.conversationId;
          if (sync.conversationId && !params.currentComplete?.conversationId) {
            setActiveConversationId(sync.conversationId);
          }
          const last = sync.messages[sync.messages.length - 1];
          lastRole = last?.role ?? null;
          if (last?.role !== "assistant") continue;
          const recovered = stripDialogScaffoldMarkdown(String(last.content ?? "").trim());
          lastRecoveredTextLength = recovered.length;
          const sessionMeta = normalizeMessageMeta(last.meta) as SessionAssistantTurnMeta | undefined;
          if (!recovered) {
            if (
              sessionMeta?.practicePicked
              && isFinalLikeTurnMode(sessionMeta.turnMode)
              && params.currentText.trim().length > 0
            ) {
              lastHydrationDebugRef.current = {
                attempts,
                matched: true,
                syncConversationId: lastSyncConversationId,
                lastRole,
                lastRecoveredTextLength,
                hadCurrentComplete: Boolean(params.currentComplete),
              };
              return {
                text: params.currentText,
                complete: completeFromSessionMessage(last, params.currentText, params.currentComplete),
              };
            }
            continue;
          }
          const matches = sessionAssistantMatchesTurn({
            currentText: params.currentText,
            currentMessageId: params.currentComplete?.messageId,
            sessionText: recovered,
            sessionMessageId: last.id,
          });
          if (!matches) {
            lastMismatch = true;
            continue;
          }
          lastHydrationDebugRef.current = {
            attempts,
            matched: true,
            syncConversationId: lastSyncConversationId,
            lastRole,
            lastRecoveredTextLength,
            hadCurrentComplete: Boolean(params.currentComplete),
          };
          return {
            text: recovered,
            complete: completeFromSessionMessage(last, recovered, params.currentComplete),
          };
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
      lastHydrationDebugRef.current = {
        attempts,
        matched: false,
        syncConversationId: lastSyncConversationId,
        lastRole,
        lastRecoveredTextLength,
        mismatchAfterFetch: lastMismatch,
        hadCurrentComplete: Boolean(params.currentComplete),
        errors,
      };
      return null;
    },
    [activeConversationId, entrySource, fetchDialogSession, useCase],
  );

  const commitAssistantTurn = useCallback(
    async (
      result: NonNullable<Awaited<ReturnType<typeof runChatStream>>>,
      options?: { replaceAll?: boolean },
    ) => {
      lastHydrationDebugRef.current = null;
      const complete = result.complete;
      if (complete?.conversationId) setActiveConversationId(complete.conversationId);
      const mergedText = resolveAssistantReplyText(result.assistantText, complete?.fullText).trim();

      let recoveredFromSession = false;
      let finalText = mergedText;
      let hydratedComplete = complete;
      if (!finalText || needsAssistantTurnHydration(complete)) {
        const hydrated = await hydrateAssistantTurnFromSession({
          currentText: finalText || mergedText,
          currentComplete: hydratedComplete,
        });
        if (hydrated) {
          finalText = hydrated.text;
          recoveredFromSession = recoveredFromSession || !mergedText;
          hydratedComplete = hydrated.complete;
        }
      }
      const clientHydrationDebug = lastHydrationDebugRef.current;
      const mergedDebug =
        hydratedComplete?.debugExport && clientHydrationDebug
          ? { ...hydratedComplete.debugExport, clientHydration: clientHydrationDebug }
          : hydratedComplete?.debugExport ?? (clientHydrationDebug ? { clientHydration: clientHydrationDebug } : undefined);

      const assistant: CommunicatorHistoryMessage = {
        id: hydratedComplete?.messageId ?? newMessageId(),
        role: "assistant",
        content: finalText.length > 0 ? finalText : strings.emptyAssistantReplyFallback,
        createdAt: Date.now(),
        meta: {
          orchestratorDecision: result.decision,
          turnMode: hydratedComplete?.turnMode,
          modelTier: hydratedComplete?.modelTier,
          modelUsed: hydratedComplete?.modelUsed,
          iteration: hydratedComplete?.iteration,
          readyMarkerTriggered: hydratedComplete?.readyMarkerTriggered,
          validation: hydratedComplete?.validation,
          insightMetrics: hydratedComplete?.insightMetrics,
          csi: hydratedComplete?.insightMetrics?.csi,
          practicePicked: hydratedComplete?.practicePicked,
          branches: hydratedComplete?.branches,
          phaseTime: hydratedComplete?.phaseTime,
          targetChakra: hydratedComplete?.targetChakra,
          shouldClose: hydratedComplete?.shouldClose,
          recommendationCorrected: hydratedComplete?.recommendationCorrected,
          planningPersistence: hydratedComplete?.planningPersistence,
          relatedEventIds: hydratedComplete?.relatedEventIds,
          skippedPlannedEvents: hydratedComplete?.skippedPlannedEvents,
          matrixCells: hydratedComplete?.matrixCells,
          debug: mergedDebug,
        },
      };
      const contentLenSource =
        finalText.length > 0 ? finalText : strings.emptyAssistantReplyFallback;
      const strippedLen = stripDialogScaffoldMarkdown(
        stripStreamingMarkers(contentLenSource),
      ).length;
      const deferAllowed =
        !recoveredFromSession &&
        mergedText.trim().length > 0 &&
        strippedLen > SHORT_ASSISTANT_DEFER_THRESHOLD &&
        !hydratedComplete?.practicePicked;
      if (!deferAllowed) {
        setPendingRevealGoal(null);
        if (options?.replaceAll) {
          setMessages([assistant]);
        } else {
          setMessages((prev) => [...prev, assistant]);
        }
        onMessage?.(assistant);
        resetChatStream();
        retryHandlerRef.current = null;
        void clearRetainedVoice();
      } else {
        syncChatStreamDisplayText(finalText);
        scheduleDeferredAssistantCommit({
          mode: options?.replaceAll ? "replaceInitiate" : "append",
          message: assistant,
        });
        retryHandlerRef.current = null;
        void clearRetainedVoice();
      }
    },
    [
      clearRetainedVoice,
      entrySource,
      hydrateAssistantTurnFromSession,
      onMessage,
      resetChatStream,
      scheduleDeferredAssistantCommit,
      syncChatStreamDisplayText,
      useCase,
      strings.emptyAssistantReplyFallback,
    ],
  );

  const submitDialogTurn = useCallback(
    async (userMessageText: string, voiceUserAlreadyCommitted: boolean) => {
      retryHandlerRef.current = () => {
        void submitDialogTurn(userMessageText, voiceUserAlreadyCommitted);
      };
      if (voiceUserAlreadyCommitted) {
        setSuppressStreamAnchorScroll(true);
      }

      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      try {
        const result = await runChatStream({
          conversationId: activeConversationId,
          useCase,
          entrySource,
          triggerMeta: {
            systemPrompt,
            ...(triggerMeta ?? {}),
          },
          userMessage: userMessageText,
          userTimezone: timezone,
          turnHistory: buildClientTurnHistory(
            messagesRef.current,
            userMessageText,
            voiceUserAlreadyCommitted,
          ),
        });
        if (result == null) return;
        await commitAssistantTurn(result);
      } catch (error) {
        try {
          const hydrated = await hydrateAssistantTurnFromSession({
            currentText: "",
            currentComplete: null,
          });
          if (hydrated) {
            await commitAssistantTurn({
              assistantText: hydrated.text,
              decision: null,
              complete: hydrated.complete,
            });
            return;
          }
        } catch {
          /* ignore session salvage */
        }
        throw error;
      }
    },
    [
      activeConversationId,
      commitAssistantTurn,
      entrySource,
      hydrateAssistantTurnFromSession,
      runChatStream,
      systemPrompt,
      triggerMeta,
      useCase,
    ],
  );

  const processVoiceFromUri = useCallback(
    async (uri: string, durationMs: number) => {
      const existing = retainedVoiceRef.current;
      let pendingVoiceId = existing?.uri === uri ? existing.pendingVoiceId : undefined;

      if (!pendingVoiceId) {
        pendingVoiceId = newMessageId();
        voicePendingMessageIdRef.current = pendingVoiceId;
        setMessages((prev) => [
          ...prev,
          {
            id: pendingVoiceId!,
            role: "user",
            content: "",
            createdAt: Date.now(),
            meta: { voiceTranscribing: true },
          },
        ]);
        voiceUserAnchorMessageIdRef.current = pendingVoiceId;
        setVoiceAnchorTick((n) => n + 1);
      } else {
        voicePendingMessageIdRef.current = pendingVoiceId;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingVoiceId
              ? { ...m, content: "", meta: { voiceTranscribing: true }, createdAt: Date.now() }
              : m,
          ),
        );
        setVoiceAnchorTick((n) => n + 1);
      }

      retainedVoiceRef.current = { uri, durationMs, pendingVoiceId };
      retryHandlerRef.current = () => {
        void processVoiceFromUri(uri, durationMs);
      };

      const clearVoicePlaceholder = () => {
        voicePendingMessageIdRef.current = null;
        voiceUserAnchorMessageIdRef.current = null;
        setMessages((prev) => prev.filter((m) => m.id !== pendingVoiceId));
      };

      try {
        const mime = mimeFromRecordingUri(uri);
        const base64 = await readAsStringAsync(uri, { encoding: "base64" });
        onEmotionSegment?.({ mimeType: mime, base64, durationMs });

        setPhase("transcribing");
        const transcript = await transcribeVoiceRecording({
          uri,
          language: strings.transcribeLanguage,
        });
        const userMessageText = transcript.text.trim();
        setPhase("idle");

        if (isSpuriousTranscription(userMessageText)) {
          clearVoicePlaceholder();
          await clearRetainedVoice();
          return;
        }
        if (
          userMessageText &&
          transcript.confidence != null &&
          transcript.confidence < LOW_TRANSCRIPTION_CONFIDENCE
        ) {
          clearVoicePlaceholder();
          await clearRetainedVoice();
          setPendingTranscript(userMessageText);
          setPendingTranscriptConfidence(transcript.confidence);
          return;
        }

        if (!userMessageText) {
          clearVoicePlaceholder();
          await clearRetainedVoice();
          return;
        }

        retainedVoiceRef.current = {
          uri,
          durationMs,
          transcribedText: userMessageText,
          pendingVoiceId,
        };

        const userVoiceMessage: CommunicatorHistoryMessage = {
          id: pendingVoiceId!,
          role: "user",
          content: userMessageText,
          createdAt: Date.now(),
        };
        setMessages((prev) => prev.map((m) => (m.id === pendingVoiceId ? userVoiceMessage : m)));
        voicePendingMessageIdRef.current = null;
        voiceUserAnchorMessageIdRef.current = pendingVoiceId;
        setVoiceAnchorTick((n) => n + 1);
        onMessage?.(userVoiceMessage);

        if (pendingAssistantCommitRef.current) {
          flushPendingAssistantCommit();
        }
        userHasScrolledUpRef.current = false;
        setSuppressStreamAnchorScroll(true);

        await submitDialogTurn(userMessageText, true);
      } catch (e) {
        setPhase("idle");
        const retained = retainedVoiceRef.current;
        if (pendingVoiceId && !retained?.transcribedText) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === pendingVoiceId
                ? {
                    ...m,
                    meta: { voiceTranscribing: false },
                    content: strings.voiceTranscribeFailedBubble,
                  }
                : m,
            ),
          );
          voicePendingMessageIdRef.current = null;
        }
        setPhase("error");
        setTimeout(() => setPhase("idle"), 400);
        const err = e instanceof Error ? e : new Error(String(e));
        if (isGeminiJsonError(err)) {
          const fallback: CommunicatorHistoryMessage = {
            id: newMessageId(),
            role: "assistant",
            content:
              "Я услышал вопрос, но сейчас не смог корректно разобрать ответ сервера. Если коротко: выбери один главный фокус дня, не распыляйся, и начни с практики на 5-10 минут, которая возвращает тело в спокойный ритм. Напиши ещё раз, что именно у тебя сегодня впереди, и я помогу привязать рекомендацию к ситуации.",
            createdAt: Date.now(),
            meta: { shouldClose: false },
          };
          setMessages((prev) => [...prev, fallback]);
          onMessage?.(fallback);
          setPendingRevealGoal(null);
          resetChatStream();
          return;
        }
        reportError(err);
      }
    },
    [
      clearRetainedVoice,
      flushPendingAssistantCommit,
      onEmotionSegment,
      onMessage,
      reportError,
      resetChatStream,
      strings.transcribeLanguage,
      strings.voiceTranscribeFailedBubble,
      submitDialogTurn,
    ],
  );

  const runStream = useCallback(
    async (input: { type: "text"; text: string }) => {
      try {
        setSuppressStreamAnchorScroll(false);
        const userMessageText = input.text.trim();
        if (!userMessageText) return;

        if (pendingAssistantCommitRef.current) {
          flushPendingAssistantCommit();
        }

        userHasScrolledUpRef.current = false;
        const userMessage: CommunicatorHistoryMessage = {
          id: newMessageId(),
          role: "user",
          content: userMessageText,
          createdAt: Date.now(),
        };
        setMessages((prev) => [...prev, userMessage]);
        onMessage?.(userMessage);

        await submitDialogTurn(userMessageText, false);
      } catch (e) {
        setPhase("error");
        setTimeout(() => setPhase("idle"), 400);
        const err = e instanceof Error ? e : new Error(String(e));
        if (isGeminiJsonError(err)) {
          const fallback: CommunicatorHistoryMessage = {
            id: newMessageId(),
            role: "assistant",
            content:
              "Я услышал вопрос, но сейчас не смог корректно разобрать ответ сервера. Если коротко: выбери один главный фокус дня, не распыляйся, и начни с практики на 5-10 минут, которая возвращает тело в спокойный ритм. Напиши ещё раз, что именно у тебя сегодня впереди, и я помогу привязать рекомендацию к ситуации.",
            createdAt: Date.now(),
            meta: { shouldClose: false },
          };
          setMessages((prev) => [...prev, fallback]);
          onMessage?.(fallback);
          setPendingRevealGoal(null);
          resetChatStream();
          return;
        }
        reportError(err);
      }
    },
    [
      flushPendingAssistantCommit,
      onMessage,
      reportError,
      resetChatStream,
      submitDialogTurn,
    ],
  );

  const abortRequest = useCallback(() => {
    abortChatStream();
    if (pendingAssistantCommitRef.current) {
      flushPendingAssistantCommit();
    } else {
      setPendingRevealGoal(null);
      resetChatStream();
    }
    onAbort?.();
  }, [abortChatStream, flushPendingAssistantCommit, onAbort, resetChatStream]);

  /**
   * Initiate dialog: when the session is new (empty), request the
   * orchestrator's opening message from the server without sending
   * any user-message. The server receives `initiateDialog: true` and
   * generates opening using dialog_system_v3 context alone.
   */
  const performInitiateDialog = useCallback(async () => {
    retryHandlerRef.current = () => {
      void performInitiateDialog();
    };
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const result = await runChatStream({
        conversationId: activeConversationId,
        useCase,
        entrySource,
        triggerMeta: {
          systemPrompt,
          ...(triggerMeta ?? {}),
        },
        userMessage: "__initiate__",
        userTimezone: timezone,
        initiateDialog: true,
        turnHistory: [],
      });
      if (result == null) return;
      await commitAssistantTurn(result, { replaceAll: true });
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      reportError(err);
    }
  }, [
    activeConversationId,
    commitAssistantTurn,
    entrySource,
    reportError,
    runChatStream,
    systemPrompt,
    triggerMeta,
    useCase,
  ]);

  useEffect(() => {
    if (initiateFiredRef.current) return;
    if (!sessionSynced) return;
    if (messages.length > 0) return;
    initiateFiredRef.current = true;
    const h = setTimeout(() => void performInitiateDialog(), 120);
    return () => clearTimeout(h);
  }, [sessionSynced, messages.length, performInitiateDialog]);

  const resetRecordingAudioMode = useCallback(async () => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        interruptionModeIOS: InterruptionModeIOS.DoNotMix,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
        playThroughEarpieceAndroid: false,
      });
    } catch {
      /* ignore audio-session reset failures */
    }
  }, []);

  const discardRecording = useCallback(async () => {
    const rec = recordingRef.current;
    if (!rec) {
      await resetRecordingAudioMode();
      return;
    }
    try {
      await rec.stopAndUnloadAsync();
    } catch {
      /* ignore */
    } finally {
      await resetRecordingAudioMode();
    }
    recordingRef.current = null;
    setPhase("idle");
  }, [resetRecordingAudioMode]);

  const cancelMicWarmup = useCallback(() => {
    startRecordingGenerationRef.current += 1;
    micWarmupRef.current = false;
    setPhase("idle");
    setMicPressResetKey((k) => k + 1);
    void resetRecordingAudioMode();
  }, [resetRecordingAudioMode]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background") {
        if (micWarmupRef.current) {
          cancelMicWarmup();
          return;
        }
        void discardRecording();
      }
    });
    return () => sub.remove();
  }, [cancelMicWarmup, discardRecording]);

  /** Запросить доступ к микрофону заранее, чтобы первый жест «удержать» не совпадал с системным диалогом. */
  useEffect(() => {
    if (uiMode !== "VOICE") return;
    let cancelled = false;
    void (async () => {
      try {
        const cur = await Audio.getPermissionsAsync();
        if (cancelled) return;
        if (cur.granted) return;
        await Audio.requestPermissionsAsync();
      } catch {
        /* preflight не обязан быть успешным — финальная проверка в startRecording */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uiMode]);

  const startRecording = useCallback(async () => {
    if (phase !== "idle" || uiMode !== "VOICE" || streamBusy || micWarmupRef.current || recordingRef.current) return;
    const generation = ++startRecordingGenerationRef.current;
    micWarmupRef.current = true;
    setPhase("arming");
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    const wipeStale = (): boolean => {
      if (generation === startRecordingGenerationRef.current) return false;
      micWarmupRef.current = false;
      setPhase("idle");
      return true;
    };

    const applyRecordingAudioMode = async () => {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        interruptionModeIOS: InterruptionModeIOS.DoNotMix,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
        interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
        playThroughEarpieceAndroid: false,
      });
    };

    const prepareRecordingSession = async () => {
      await discardRecording();
      await Audio.setIsEnabledAsync(true);
      await applyRecordingAudioMode();
      await sleep(Platform.OS === "ios" ? 180 : 70);
    };

    try {
      awaitingMicPermissionRef.current = true;
      let perm: Awaited<ReturnType<typeof Audio.requestPermissionsAsync>>;
      try {
        perm = await Audio.requestPermissionsAsync();
      } finally {
        awaitingMicPermissionRef.current = false;
      }
      if (wipeStale()) return;
      if (!perm.granted) {
        micWarmupRef.current = false;
        setPhase("idle");
        reportError(new Error(strings.microphonePermissionError));
        setMicPressResetKey((k) => k + 1);
        return;
      }

      type RecordingOpts = ReturnType<typeof whisperRecordingOptions>;

      const createStartedRecording = async (
        options: RecordingOpts,
        { awaitIdleQueue }: { awaitIdleQueue: boolean },
      ) => {
        if (Platform.OS === "ios" && awaitIdleQueue) {
          await new Promise<void>((resolve) => {
            InteractionManager.runAfterInteractions(() => resolve());
          });
        }
        const created = await Audio.Recording.createAsync(options);
        return created.recording;
      };

      const recordingVariants = [
        whisperRecordingOptions({ isMeteringEnabled: false }),
        whisperRecordingOptions({ isMeteringEnabled: true }),
        communicatorRecordingFallbackOptions(),
      ] as const;

      let recording: Audio.Recording | null = null;
      let lastErr: unknown;
      outer: for (let attempt = 0; attempt < 3; attempt += 1) {
        if (wipeStale()) return;
        await prepareRecordingSession();
        if (wipeStale()) return;
        for (let vi = 0; vi < recordingVariants.length; vi += 1) {
          if (wipeStale()) return;
          const variantOptions = recordingVariants[vi];
          try {
            recording = await createStartedRecording(variantOptions, {
              awaitIdleQueue: attempt > 0 || vi > 0,
            });
            break outer;
          } catch (e) {
            lastErr = e;
            /* Нельзя оставлять allowsRecordingIOS: false между пресетами — следующий createAsync падает с «Recording not allowed». */
            try {
              await applyRecordingAudioMode();
            } catch {
              /* ignore */
            }
            await sleep(Platform.OS === "ios" ? 110 : 70);
          }
        }
        if (attempt < 2) {
          await sleep(attempt === 0 ? 200 : 360);
        }
      }

      if (wipeStale()) return;

      if (!recording) {
        throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "Recording failed"));
      }

      if (generation !== startRecordingGenerationRef.current) {
        try {
          await recording.stopAndUnloadAsync();
        } catch {
          /* ignore */
        }
        await resetRecordingAudioMode();
        micWarmupRef.current = false;
        setPhase("idle");
        return;
      }
      micWarmupRef.current = false;
      recordingRef.current = recording;
      recording.setOnRecordingStatusUpdate((status) => {
        const metering = "metering" in status && typeof status.metering === "number" ? status.metering : null;
        const fallbackPulse = 0.28 + 0.12 * Math.sin(Date.now() / 180);
        const normalized = metering == null ? fallbackPulse : Math.max(0.08, Math.min(1, (metering + 60) / 60));
        Animated.timing(voiceLevel, {
          toValue: normalized,
          duration: 90,
          useNativeDriver: true,
        }).start();
      });
      recording.setProgressUpdateInterval(90);
      recordStartRef.current = Date.now();
      setPhase("recording");
    } catch (e) {
      if (generation !== startRecordingGenerationRef.current) return;
      micWarmupRef.current = false;
      recordingRef.current = null;
      await resetRecordingAudioMode();
      setPhase("idle");
      setMicPressResetKey((k) => k + 1);
      const err = e instanceof Error ? e : new Error(String(e));
      reportError(err);
    }
  }, [discardRecording, phase, reportError, resetRecordingAudioMode, streamBusy, strings.microphonePermissionError, uiMode]);

  const stopRecordingAndSend = useCallback(async () => {
    const rec = recordingRef.current;
    if (!rec || phase !== "recording") return;

    micWarmupRef.current = false;
    recordingRef.current = null;
    let uri: string | null = null;
    try {
      await rec.stopAndUnloadAsync();
      uri = rec.getURI() ?? null;
    } catch {
      await resetRecordingAudioMode();
      setPhase("idle");
      return;
    }
    await resetRecordingAudioMode();

    const durationMs = Date.now() - recordStartRef.current;
    setPhase("idle");

    suppressClickRef.current = true;
    suppressAbortAfterRecordRef.current = true;
    setTimeout(() => {
      suppressClickRef.current = false;
      suppressAbortAfterRecordRef.current = false;
    }, 450);

    if (!uri) return;

    try {
      const info = await getInfoAsync(uri);
      const size = info.exists && !info.isDirectory ? info.size : 0;
      if (size < 16 || durationMs < MIN_VOICE_MS) return;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      reportError(err);
      return;
    }

    await processVoiceFromUri(uri, durationMs);
  }, [phase, processVoiceFromUri, reportError, resetRecordingAudioMode]);

  const onMicPressIn = useCallback(() => {
    if (isBusy) return;
    if (uiMode !== "VOICE") return;
    void startRecording();
  }, [isBusy, startRecording, uiMode]);

  const onMicPressOut = useCallback(() => {
    if (phase === "recording") {
      void stopRecordingAndSend();
      return;
    }
    if (micWarmupRef.current && awaitingMicPermissionRef.current) {
      return;
    }
    if (micWarmupRef.current) {
      cancelMicWarmup();
    }
  }, [cancelMicWarmup, phase, stopRecordingAndSend]);

  const onMicPress = useCallback(() => {
    if (suppressClickRef.current || suppressAbortAfterRecordRef.current) return;
    if (isBusy) abortRequest();
  }, [abortRequest, isBusy]);

  const sendText = useCallback(async () => {
    const t = txtDraft.trim();
    if (!t || isBusy) return;
    setTxtDraft("");
    await runStream({ type: "text", text: t });
  }, [isBusy, runStream, txtDraft]);

  const cancelTranscriptReview = useCallback(() => {
    setPendingTranscript(null);
    setPendingTranscriptConfidence(undefined);
  }, []);

  const sendReviewedTranscript = useCallback(async () => {
    const text = pendingTranscript?.trim();
    if (!text || streamBusy) return;
    setPendingTranscript(null);
    setPendingTranscriptConfidence(undefined);
    await runStream({ type: "text", text });
  }, [pendingTranscript, runStream, streamBusy]);

  const toggleMode = useCallback(() => {
    if (!canSwitchInputMode || isBusy) return;
    setUiMode((m) => (m === "VOICE" ? "TXT" : "VOICE"));
  }, [canSwitchInputMode, isBusy]);

  const micShowsBusyAsset = isBusy && phase !== "recording" && phase !== "arming";

  const onScrollViewLayout = useCallback((e: LayoutChangeEvent) => {
    setScrollViewH(e.nativeEvent.layout.height);
  }, []);

  const onContentSizeChange = useCallback(
    (_w: number, h: number) => {
      const prevH = prevContentHRef.current;
      prevContentHRef.current = h;
      setContentH(h);

      if (!streamBusyRef.current && !userHasScrolledUpRef.current && h > prevH) {
        if (voiceUserAnchorMessageIdRef.current != null) {
          updateScrollDownFlag();
          return;
        }
        programmaticScrollRef.current = true;
        scrollRef.current?.scrollToEnd({ animated: false });
        requestAnimationFrame(() => {
          programmaticScrollRef.current = false;
        });
      }

      updateScrollDownFlag();
    },
    [updateScrollDownFlag],
  );

  const borderColor = theme.colors.surfaceBorder;
  const footerBg = theme.colors.surface;

  const handlePracticeLaunch = useCallback(
    (practice: PracticePicked, configured: PracticeSummary) => {
      launchPractice(configured.launch, { launchSource: "assistant" });
      onPracticePicked?.(summaryToPractice(practice, configured));
    },
    [onPracticePicked],
  );

  const renderCommunicatorItem = useCallback<ListRenderItem<CommunicatorListRow>>(
    ({ item }) => {
      if (item.kind === "user") {
        const pendingVoice = Boolean(item.message.meta?.voiceTranscribing);
        return (
          <View>
            <UserBubble
              text={item.message.content}
              isStreaming={false}
              voicePending={pendingVoice}
              strings={strings}
            />
          </View>
        );
      }
      if (item.kind === "assistant") {
        const m = item.message;
        return (
          <View>
            <AssistantBubble text={m.content} isStreaming={false} />
            {m.meta?.practicePicked ? (() => {
              const practice = m.meta.practicePicked as PracticePicked;
              const summary = practiceToSummary(practice);
              const rawOverrides = (practice as PracticePicked & { overrides?: { durationMin?: number; chakraIndex?: number } }).overrides;
              const useDialogOverrides = summary && summary.kind !== "yoga";
              return summary ? (
                <View style={styles.practiceCardWrap}>
                  <SharedPracticeCard
                    practice={summary}
                    onLaunch={(configured) => handlePracticeLaunch(practice, configured)}
                    overrideDurationMinutes={useDialogOverrides ? rawOverrides?.durationMin : undefined}
                    overrideChakraIndex={useDialogOverrides ? rawOverrides?.chakraIndex : undefined}
                  />
                </View>
              ) : null;
            })() : null}
          </View>
        );
      }
      return (
        <View>
          <StreamingAssistantLines
            stripTarget={strippedStreamTarget}
            isStreamingTyping={streamStatus === "typing"}
            revealGoal={pendingRevealGoal}
            onRevealComplete={onStreamFullyRevealed}
          />
        </View>
      );
    },
    [handlePracticeLaunch, onStreamFullyRevealed, pendingRevealGoal, streamStatus, strippedStreamTarget, strings],
  );

  const streamAnchorIndex = streamBusy ? communicatorListData.length - 1 : -1;

  useLayoutEffect(() => {
    if (voiceAnchorTick === lastVoiceLayoutScrollTickRef.current) return;
    const anchorId = voiceUserAnchorMessageIdRef.current;
    if (!anchorId) return;
    const voiceUserIndex = communicatorListData.findIndex(
      (r) => r.kind === "user" && r.message.id === anchorId,
    );
    if (voiceUserIndex < 0) return;

    let cancelled = false;
    const maxAttempts = 8;
    const tickAtStart = voiceAnchorTick;

    const attemptScroll = (attempt: number) => {
      if (cancelled) return;
      if (attempt >= maxAttempts) {
        lastVoiceLayoutScrollTickRef.current = tickAtStart;
        return;
      }
      const list = scrollRef.current;
      const rows = communicatorListDataRef.current;
      const idx = rows.findIndex((r) => r.kind === "user" && r.message.id === anchorId);
      if (idx < 0 || !list) {
        setTimeout(() => attemptScroll(attempt + 1), 45 + attempt * 35);
        return;
      }
      void list
        .scrollToIndex({
          index: idx,
          animated: true,
          viewPosition: VOICE_USER_SCROLL_VIEW_POSITION,
        })
        .then(() => {
          if (!cancelled) lastVoiceLayoutScrollTickRef.current = tickAtStart;
        })
        .catch(() => {
          setTimeout(() => attemptScroll(attempt + 1), 45 + attempt * 35);
        });
    };

    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(() => attemptScroll(0), 32);
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [communicatorListData, voiceAnchorTick]);

  useLayoutEffect(() => {
    if (suppressStreamAnchorScroll) return;
    if (streamAnchorIndex < 0) return;
    const row = communicatorListData[streamAnchorIndex];
    if (!row || row.kind !== "stream") return;
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          scrollRef.current?.scrollToIndex({
            index: streamAnchorIndex,
            animated: true,
            viewPosition: 0.3,
          });
        } catch {
          scrollRef.current?.scrollToEnd({ animated: true });
        }
      });
    });
    return () => cancelAnimationFrame(id);
  }, [communicatorListData, streamAnchorIndex, streamBusy, messages.length, suppressStreamAnchorScroll]);

  const exportDialogJson = useCallback(async () => {
    const forecastDate = typeof triggerMeta?.forecastDate === "string" ? triggerMeta.forecastDate : new Date().toISOString().slice(0, 10);
    const forecastDt = new Date(`${forecastDate}T12:00:00`);
    const dayContext = {
      day_of_week: forecastDt.toLocaleDateString(strings.locale === "en" ? "en-US" : "ru-RU", { weekday: "long" }),
      date: forecastDate,
      chakra_label: typeof triggerMeta?.chakraLabel === "string" ? triggerMeta.chakraLabel : null,
      planet: typeof triggerMeta?.planetOfTheDay === "string" ? triggerMeta.planetOfTheDay : null,
      harmoniousness_value:
        typeof triggerMeta?.harmoniousnessValue === "number" ? triggerMeta.harmoniousnessValue : null,
      harmoniousness_label:
        typeof triggerMeta?.harmoniousnessLabel === "string" ? triggerMeta.harmoniousnessLabel : null,
    };
    const localHasDebugExport = messages.some(
      (message) => message.role === "assistant" && message.meta?.debug != null,
    );
    let syncedConversationId: string | null | undefined;
    let syncedMessages: DialogSessionMessage[] | null = null;
    let dialogStateAfter: Record<string, unknown> | undefined;
    let syncError: string | null = null;
    try {
      const sync = await fetchDialogSession({
        useCase,
        entrySource,
        conversationId: activeConversationId ?? undefined,
        debugExport: true,
      });
      syncedConversationId = sync.conversationId;
      syncedMessages = sync.messages;
      dialogStateAfter = sync.dialogStateAfter;
    } catch {
      syncError = "session_sync_failed";
    }
    const canUseSyncedMessages =
      Array.isArray(syncedMessages)
      && syncedMessages.length > 0
      && (activeConversationId == null || syncedConversationId == null || syncedConversationId === activeConversationId);
    const localExportMessages: ExportMessageSnapshot[] = messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      meta: message.meta,
      rawMeta: message.meta && typeof message.meta === "object" ? message.meta as Record<string, unknown> : undefined,
    }));
    const syncedExportMessages: ExportMessageSnapshot[] = canUseSyncedMessages && syncedMessages
      ? syncedMessages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          createdAt: message.createdAt,
          meta: normalizeMessageMeta(message.meta),
          rawMeta: message.meta,
        }))
      : [];
    const exportMessages = canUseSyncedMessages
      ? mergeExportMessages({
          localMessages: localExportMessages,
          syncedMessages: syncedExportMessages,
        })
      : localExportMessages;
    const exportCanonicalSource =
      !canUseSyncedMessages
        ? "local_client_state"
        : exportMessages.length === syncedExportMessages.length
          ? "server_session_sync"
          : "server_session_sync_merged_with_local";
    const hasDebugExport = localHasDebugExport || Boolean(dialogStateAfter);
    const exportMessageRows = exportMessages.map((message) => {
        const normalizedMeta = message.meta as CommunicatorHistoryMessage["meta"] | undefined;
        const rawMeta = message.rawMeta && typeof message.rawMeta === "object" ? message.rawMeta as Record<string, unknown> : undefined;
        const practicePicked =
          normalizedMeta?.practicePicked && typeof normalizedMeta.practicePicked === "object"
            ? normalizedMeta.practicePicked
            : null;
        const branches = Array.isArray(normalizedMeta?.branches)
          ? normalizedMeta.branches.filter((value): value is string => typeof value === "string")
          : null;
        const targetChakra =
          normalizedMeta?.targetChakra && typeof normalizedMeta.targetChakra === "object"
            ? normalizedMeta.targetChakra
            : null;
        const relatedEventIds = Array.isArray(rawMeta?.related_event_ids)
          ? rawMeta.related_event_ids.filter((value): value is string => typeof value === "string")
          : Array.isArray(normalizedMeta?.relatedEventIds)
            ? normalizedMeta.relatedEventIds.filter((value): value is string => typeof value === "string")
            : null;
        const matrixCells = Array.isArray(rawMeta?.matrix_cells)
          ? rawMeta.matrix_cells
          : Array.isArray(normalizedMeta?.matrixCells)
            ? normalizedMeta.matrixCells
            : null;
        const planningPersistence =
          rawMeta?.planning_persistence && typeof rawMeta.planning_persistence === "object"
            ? rawMeta.planning_persistence
            : normalizedMeta?.planningPersistence && typeof normalizedMeta.planningPersistence === "object"
              ? normalizedMeta.planningPersistence
              : null;
        const baseMeta = {
          turn_mode: typeof normalizedMeta?.turnMode === "string" ? normalizedMeta.turnMode : null,
          csi: typeof normalizedMeta?.csi === "number"
            ? normalizedMeta.csi
            : typeof (normalizedMeta?.insightMetrics as { csi?: unknown } | undefined)?.csi === "number"
              ? (normalizedMeta?.insightMetrics as { csi: number }).csi
              : null,
          ttm_stage: typeof (normalizedMeta?.insightMetrics as { ttm_stage?: unknown } | undefined)?.ttm_stage === "string"
            ? (normalizedMeta?.insightMetrics as { ttm_stage: string }).ttm_stage
            : null,
          etv: typeof (normalizedMeta?.insightMetrics as { etv?: unknown } | undefined)?.etv === "number"
            ? (normalizedMeta?.insightMetrics as { etv: number }).etv
            : null,
          model_used: typeof normalizedMeta?.modelTier === "string" ? normalizedMeta.modelTier : null,
          model_id: typeof normalizedMeta?.modelUsed === "string" ? normalizedMeta.modelUsed : null,
          iteration: typeof normalizedMeta?.iteration === "number" ? normalizedMeta.iteration : null,
          latency_ms: null,
          complete_text_chars: message.content.length,
          prompt_tokens: null,
          completion_tokens: null,
          ready_marker_triggered: typeof normalizedMeta?.readyMarkerTriggered === "boolean"
            ? normalizedMeta.readyMarkerTriggered
            : null,
          validation:
            normalizedMeta?.validation && typeof normalizedMeta.validation === "object"
              ? normalizedMeta.validation
              : null,
          practice_picked: practicePicked,
          branches_active: branches,
          phase_time: typeof normalizedMeta?.phaseTime === "string" ? normalizedMeta.phaseTime : null,
          target_chakra: targetChakra,
          related_event_ids: relatedEventIds,
          matrix_cells: matrixCells,
          skipped_planned_events: Array.isArray(rawMeta?.skipped_planned_events)
            ? rawMeta.skipped_planned_events
            : Array.isArray(normalizedMeta?.skippedPlannedEvents)
              ? normalizedMeta.skippedPlannedEvents
              : null,
          planning_persistence: planningPersistence,
          recommendation_corrected:
            normalizedMeta?.recommendationCorrected && typeof normalizedMeta.recommendationCorrected === "object"
              ? normalizedMeta.recommendationCorrected
              : null,
        };
        const debug = message.role === "assistant" && normalizedMeta?.debug != null ? normalizedMeta.debug : undefined;
        const row = {
          message_id: message.id,
          role: message.role,
          text: message.content,
          timestamp: message.createdAt ?? null,
          meta: baseMeta,
          ...(debug != null ? { debug } : {}),
        };
        return row;
    });
    reconcileExportPlanningPersistence(
      exportMessageRows as Array<{ role: string; meta: { planning_persistence: { inserted: unknown[]; summarized: unknown[]; skipped: unknown[] } | null } }>,
      dialogStateAfter,
    );
    const payload = {
      conversation: {
        conversation_id: (canUseSyncedMessages ? syncedConversationId : activeConversationId) ?? null,
        use_case: useCase,
        entry_source: entrySource,
        debug_export_enabled: hasDebugExport,
        canonical_source: exportCanonicalSource,
        server_sync: {
          attempted: true,
          used_for_export: canUseSyncedMessages,
          fetched_conversation_id: syncedConversationId ?? null,
          error: syncError,
        },
      },
      day_context: dayContext,
      messages: exportMessageRows,
      ...(dialogStateAfter ? { dialog_state_after: dialogStateAfter } : {}),
    };
    await Share.share({
      title: "dialog-export.json",
      message: JSON.stringify(payload, null, 2),
    });
  }, [activeConversationId, entrySource, messages, strings.locale, triggerMeta, useCase]);

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: theme.colors.screenBg }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={insets.bottom + 8}
    >
      <View style={styles.flex}>
        <FlashList
          ref={scrollRef}
          data={communicatorListData}
          renderItem={renderCommunicatorItem}
          keyExtractor={(item) => (item.kind === "stream" ? "__stream__" : item.id)}
          getItemType={(item) => item.kind}
          drawDistance={280}
          extraData={{
            strip: strippedStreamTarget,
            typing: streamStatus,
            goal: pendingRevealGoal,
            voiceTick: voiceAnchorTick,
          }}
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: 112 + insets.bottom },
          ]}
          onScroll={onScroll}
          scrollEventThrottle={16}
          onLayout={onScrollViewLayout}
          onContentSizeChange={onContentSizeChange}
          keyboardShouldPersistTaps="handled"
        />

        <ScrollDownHint visible={showScrollDown} onPress={scrollToBottom} strings={strings} />
      </View>

      <View
        style={[
          styles.footer,
          {
            borderTopColor: borderColor,
            backgroundColor: footerBg,
            paddingBottom: Math.max(10, insets.bottom),
            paddingLeft: Math.max(12, insets.left),
            paddingRight: Math.max(12, insets.right),
          },
        ]}
      >
        {__DEV__ ? (
          <View style={styles.debugActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => void exportDialogJson()}
              style={[styles.debugButton, { borderColor: borderColor, backgroundColor: theme.colors.surfaceElevated }]}
            >
              <AppText variant="technicalCaption" tone="muted">Export dialog to JSON</AppText>
            </Pressable>
          </View>
        ) : null}
        {pendingTranscript != null ? (
          <View
            style={[
              styles.transcriptReview,
              {
                borderColor,
                backgroundColor: theme.colors.surfaceElevated,
              },
            ]}
          >
            <AppText variant="buttonLabel">{strings.transcriptionReviewTitle}</AppText>
            <AppText variant="technicalCaption" tone="muted">
              {strings.transcriptionReviewHint(pendingTranscriptConfidence)}
            </AppText>
            <TextInput
              value={pendingTranscript}
              onChangeText={setPendingTranscript}
              placeholder={strings.textPlaceholder}
              placeholderTextColor={theme.colors.textFaint}
              editable={!streamBusy}
              multiline
              maxLength={8000}
              style={[
                styles.transcriptReviewInput,
                {
                  color: theme.colors.textPrimary,
                  borderColor,
                  backgroundColor: theme.colors.surface,
                  fontSize: theme.typography.screenHint.fontSize,
                  lineHeight: theme.typography.screenHint.lineHeight,
                  fontWeight: theme.typography.screenHint.fontWeight,
                  fontFamily: theme.typography.screenHint.fontFamily,
                },
              ]}
            />
            <View style={styles.transcriptReviewActions}>
              <Pressable
                accessibilityRole="button"
                disabled={streamBusy}
                onPress={cancelTranscriptReview}
                style={[styles.reviewSecondaryBtn, streamBusy && styles.sendBtnDisabled]}
              >
                <AppText variant="buttonLabel" tone="muted">{strings.transcriptionReviewCancel}</AppText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={streamBusy || !pendingTranscript.trim()}
                onPress={() => void sendReviewedTranscript()}
                style={[
                  styles.reviewPrimaryBtn,
                  { backgroundColor: theme.colors.buttonPrimaryBg },
                  (streamBusy || !pendingTranscript.trim()) && styles.sendBtnDisabled,
                ]}
              >
                <AppText variant="buttonLabel" tone="accentOn">{strings.transcriptionReviewSend}</AppText>
              </Pressable>
            </View>
          </View>
        ) : (
        <View style={styles.footerRow}>
          {uiMode === "VOICE" ? (
            <View style={styles.toggleSpacer} />
          ) : null}
          {uiMode === "VOICE" ? (
            <View style={styles.voiceCol}>
              {HARMONIZER_TEST_MODE && (phase === "transcribing" || streamStatus === "thinking" || streamStatus === "typing") ? (
                <View style={styles.hintRow}>
                  <AppText variant="technicalCaption" tone="muted">
                    {phase === "transcribing"
                      ? strings.transcribingStatus
                      : streamStatus === "thinking"
                        ? strings.thinkingStatus
                        : strings.respondingStatus}
                  </AppText>
                </View>
              ) : null}
              <ModelBadge model={modelUsed} accessTier={modelAccessTier} />
              <Pressable
                key={micPressResetKey}
                accessibilityRole="button"
                accessibilityLabel={
                  isBusy ? strings.cancelRequestAccessibilityLabel : strings.holdToRecordAccessibilityLabel
                }
                onPressIn={onMicPressIn}
                onPressOut={onMicPressOut}
                onPress={onMicPress}
                style={styles.micHit}
              >
                {phase === "recording" || phase === "arming" ? <RecordingAura level={voiceLevel} /> : null}
                <Image
                  source={micShowsBusyAsset ? micOff : micOn}
                  style={styles.micImg}
                  resizeMode="contain"
                />
                {phase === "recording" || phase === "arming" ? (
                  <View style={styles.micDim} />
                ) : null}
              </Pressable>
            </View>
          ) : (
            <View
              style={[
                styles.txtBar,
                {
                  borderColor,
                  backgroundColor: theme.colors.surfaceElevated,
                },
              ]}
            >
              <TextInput
                value={txtDraft}
                onChangeText={setTxtDraft}
                placeholder={strings.textPlaceholder}
                placeholderTextColor={theme.colors.textFaint}
                editable={!isBusy}
                multiline
                maxLength={8000}
                style={[
                  styles.input,
                  {
                    color: theme.colors.textPrimary,
                    fontSize: theme.typography.screenHint.fontSize,
                    lineHeight: theme.typography.screenHint.lineHeight,
                    fontWeight: theme.typography.screenHint.fontWeight,
                    fontFamily: theme.typography.screenHint.fontFamily,
                  },
                ]}
                onSubmitEditing={() => void sendText()}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={strings.sendAccessibilityLabel}
                disabled={isBusy || !txtDraft.trim()}
                onPress={() => void sendText()}
                style={({ pressed }) => [
                  styles.sendBtn,
                  { backgroundColor: theme.colors.buttonPrimaryBg },
                  (isBusy || !txtDraft.trim()) && styles.sendBtnDisabled,
                  pressed && !(isBusy || !txtDraft.trim()) && styles.sendBtnPressed,
                ]}
              >
                <AppText variant="buttonLabel" tone="accentOn">{strings.sendButton}</AppText>
              </Pressable>
            </View>
          )}

          {COMMUNICATOR_TEXT_MODE_ENABLED && canSwitchInputMode ? (
            <ModeToggle
              targetMode={uiMode === "VOICE" ? "TXT" : "VOICE"}
              onToggle={toggleMode}
              disabled={isBusy}
              strings={strings}
            />
          ) : (
            <View style={styles.toggleSpacer} />
          )}
        </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1, minHeight: 0 },
  scroll: { flex: 1 },
  scrollContent: {
    paddingTop: 8,
    maxWidth: 560,
    width: "100%",
    alignSelf: "center",
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    maxWidth: 560,
    width: "100%",
    alignSelf: "center",
  },
  debugActions: {
    maxWidth: 560,
    width: "100%",
    alignSelf: "center",
    marginBottom: 8,
    alignItems: "flex-start",
  },
  debugButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  transcriptReview: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    gap: 8,
    maxWidth: 560,
    width: "100%",
    alignSelf: "center",
    padding: 12,
  },
  transcriptReviewInput: {
    minHeight: 72,
    maxHeight: 140,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlignVertical: "top",
  },
  transcriptReviewActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  reviewSecondaryBtn: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  reviewPrimaryBtn: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  voiceCol: {
    flex: 1,
    minHeight: 72,
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 4,
  },
  hintRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    minHeight: 18,
  },
  modelBadge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  practiceCardWrap: {
    width: "100%",
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  micHit: {
    width: 72,
    height: 72,
    alignItems: "center",
    justifyContent: "center",
  },
  recordingAura: {
    position: "absolute",
    width: 76,
    height: 76,
    borderRadius: 999,
    borderWidth: 8,
  },
  micImg: {
    width: 56,
    height: 56,
  },
  micDim: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  txtBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    fontSize: 15,
    lineHeight: 20,
    paddingVertical: 8,
  },
  sendBtn: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 2,
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnPressed: { opacity: 0.85 },
  toggleSpacer: { width: 40 },
});
