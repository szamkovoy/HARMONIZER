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
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { mimeFromRecordingUri } from "@/modules/communicator/core/audioMime";
import { getCommunicatorStrings, type CommunicatorLocale } from "@/modules/communicator/i18n/communicator";
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
  fetchDialogSession,
  transcribeCommunicatorAudio,
  type DialogueEntrySource,
  type DialogueUseCase,
  type PracticePicked,
} from "@/services/communicator-client";
import type { OrchestratorDecision } from "@/services/communicator-client";
import { useAuth } from "@/modules/auth";
import { AppText } from "@/modules/ui/AppText";
import { COMMUNICATOR_MODEL_LABEL, COMMUNICATOR_TEXT_MODE_ENABLED, HARMONIZER_TEST_MODE } from "@/modules/ui/testMode";
import { useTheme } from "@/modules/ui/theme";

import { AssistantBubble } from "./AssistantBubble";
import { DecodingDots } from "./DecodingDots";
import { ModeToggle } from "./ModeToggle";
import { PracticeCard } from "./PracticeCard";
import { ScrollDownHint } from "./ScrollDownHint";
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

/** Итоговый текст: не подменяем более длинный агрегат SSE более коротким `complete.fullText`. */
function resolveAssistantReplyText(streamed: string, completeFullText: string | undefined): string {
  const raw = streamed ?? "";
  const fin = completeFullText ?? "";
  const rawT = raw.trim();
  const finT = fin.trim();
  if (!rawT && !finT) return "";
  if (!rawT) return fin.trimEnd();
  if (!finT) return raw.trimEnd();
  if (finT.length > rawT.length) return fin.trimEnd();
  if (rawT.length > finT.length) return raw.trimEnd();
  return fin.trimEnd();
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

function getTurnUserAnchorIndex(
  list: CommunicatorHistoryMessage[],
): number | null {
  const n = list.length;
  if (n < 1) return null;
  if (list[n - 1].role === "assistant" && n >= 2 && list[n - 2].role === "user") {
    return n - 2;
  }
  if (list[n - 1].role === "user") return n - 1;
  return null;
}

function getTurnAssistantAnchorIndex(
  list: CommunicatorHistoryMessage[],
): number | null {
  const n = list.length;
  if (n < 1) return null;
  if (list[n - 1].role === "assistant") return n - 1;
  return null;
}

function ThinkingIndicator() {
  const theme = useTheme();
  return (
    <View style={styles.assistantStatusRow}>
      <View
        style={[
          styles.assistantStatusBubble,
          {
            backgroundColor: theme.colors.surfaceElevated,
            borderColor: theme.colors.surfaceBorder,
          },
        ]}
      >
        <DecodingDots />
      </View>
    </View>
  );
}

function isGeminiJsonError(error: Error): boolean {
  return /Gemini response is not valid JSON/i.test(error.message);
}

function isRecorderPrepareError(error: Error): boolean {
  return /prepare.*recorder|recorder not prepared|prepareToRecord/i.test(error.message);
}

/** Не показывать сырой стектрейс/англ. текст SDK при перегрузке или после исчерпания fallback на сервере. */
function userFacingAssistantNetworkMessage(err: Error): string {
  const m = err.message;
  if (/Сервис временно недоступен/.test(m)) return m;
  if (
    /\b503\b/i.test(m) ||
    /service unavailable/i.test(m) ||
    /high demand/i.test(m) ||
    /\b429\b/i.test(m) ||
    /rate_limit_exceeded/i.test(m) ||
    /GoogleGenerativeAI/i.test(m) ||
    /resource exhausted/i.test(m) ||
    /overloaded/i.test(m) ||
    /\bUNAVAILABLE\b/i.test(m)
  ) {
    return "Сервис временно недоступен, попробуйте через минуту.";
  }
  return m;
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
  autoSendInitialMessage,
  onEmotionSegment,
  onMessage,
  onPracticePicked,
  onError,
  onAbort,
  onStateChange,
}: CommunicatorProps) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { profile } = useAuth();
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

  const [phase, setPhase] = useState<Phase>("idle");
  const [activeConversationId, setActiveConversationId] = useState<string | null>(conversationId ?? null);
  const [sessionSynced, setSessionSynced] = useState(false);
  const [txtDraft, setTxtDraft] = useState("");
  const [pendingTranscript, setPendingTranscript] = useState<string | null>(null);
  const [pendingTranscriptConfidence, setPendingTranscriptConfidence] = useState<number | undefined>(undefined);
  const initialHistoryRef = useRef<CommunicatorHistoryMessage[]>(ensureIds(sliceHistoryForWindow(history, memoryWindow)));

  useEffect(() => {
    initialHistoryRef.current = ensureIds(sliceHistoryForWindow(history, memoryWindow));
  }, [history, memoryWindow]);

  const reportError = useCallback(
    (err: Error) => {
      if (isGeminiJsonError(err)) return;
      const recorderPrepareError = isRecorderPrepareError(err);
      const displayMessage = recorderPrepareError
        ? "Не удалось включить запись. Попробуйте ещё раз."
        : userFacingAssistantNetworkMessage(err);
      if (recorderPrepareError) {
        console.warn("[Communicator]", err.message, err.stack ?? "");
      } else {
        console.error("[Communicator]", err.message, err.stack ?? "");
      }
      onError?.(err);
      Alert.alert(strings.sendErrorTitle, displayMessage, [
        { text: strings.alertOk },
      ]);
    },
    [onError, strings.alertOk, strings.sendErrorTitle],
  );

  const {
    assistantText,
    decision,
    modelUsed,
    status: streamStatus,
    run: runChatStream,
    abort: abortChatStream,
    reset: resetChatStream,
    isBusy: streamBusy,
  } = useCommunicatorStream({ onError: reportError });

  const recordingRef = useRef<Audio.Recording | null>(null);
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

  const scrollRef = useRef<ScrollView>(null);
  const [scrollViewH, setScrollViewH] = useState(0);
  const [contentH, setContentH] = useState(0);
  const [scrollY, setScrollY] = useState(0);
  const [anchorY, setAnchorY] = useState<number | null>(null);
  const [tailBottom, setTailBottom] = useState<number | null>(null);

  const programmaticScrollRef = useRef(false);
  const scrollHintDismissedRef = useRef(true);
  const streamScrollUserAdjustedRef = useRef(false);
  const prevStreamBusyRef = useRef(false);
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

  const isBusy =
    phase === "arming" || phase === "recording" || phase === "transcribing" || streamBusy;

  useEffect(() => {
    const ac = new AbortController();
    setSessionSynced(false);
    void fetchDialogSession({ useCase, entrySource, signal: ac.signal })
      .then((session) => {
        if (ac.signal.aborted) return;
        setActiveConversationId(session.conversationId);
        if (session.messages.length > 0) {
          setMessages(
            ensureIds(
              sliceHistoryForWindow(
                session.messages.map((message) => ({
                  id: message.id,
                  role: message.role,
                  content: message.content,
                  createdAt: message.createdAt,
                  meta: message.meta,
                })),
                memoryWindow,
              ),
            ),
          );
        } else {
          const seed = initialHistoryRef.current;
          setMessages(seed.length ? [...seed] : []);
        }
      })
      .catch((error) => {
        if (ac.signal.aborted) return;
        reportError(error instanceof Error ? error : new Error(String(error)));
        setMessages(initialHistoryRef.current);
        setActiveConversationId(conversationId ?? null);
      })
      .finally(() => {
        if (!ac.signal.aborted) setSessionSynced(true);
      });
    return () => ac.abort();
  }, [conversationId, entrySource, memoryWindow, reportError, useCase]);

  const updateScrollDownFlag = useCallback(() => {
    if (scrollHintDismissedRef.current) {
      setShowScrollDown(false);
      return;
    }
    const gap = contentH - scrollY - scrollViewH;
    setShowScrollDown(gap > 56);
  }, [contentH, scrollY, scrollViewH]);

  const alignTurnAnchorToTop = useCallback(() => {
    if (anchorY == null || !scrollRef.current) return;
    programmaticScrollRef.current = true;
    const maxScroll = Math.max(0, contentH - scrollViewH);
    let target = anchorY;
    if (tailBottom != null && scrollViewH > 0) {
      const bottomAlign = tailBottom - scrollViewH;
      if (bottomAlign > 0) {
        target = Math.min(anchorY, bottomAlign);
      }
    }
    target = Math.min(Math.max(0, target), maxScroll);
    scrollRef.current.scrollTo({ y: target, animated: false });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        programmaticScrollRef.current = false;
        updateScrollDownFlag();
      });
    });
  }, [anchorY, contentH, scrollViewH, tailBottom, updateScrollDownFlag]);

  useLayoutEffect(() => {
    const prev = prevStreamBusyRef.current;
    if (streamBusy && !prev) {
      scrollHintDismissedRef.current = false;
      streamScrollUserAdjustedRef.current = false;
    }
    if (prev && !streamBusy) {
      requestAnimationFrame(() => alignTurnAnchorToTop());
    }
    prevStreamBusyRef.current = streamBusy;
  }, [streamBusy, messages, alignTurnAnchorToTop]);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      setScrollY(y);
      if (!programmaticScrollRef.current) {
        scrollHintDismissedRef.current = true;
        if (streamBusy) streamScrollUserAdjustedRef.current = true;
      }
      if (!programmaticScrollRef.current) {
        const gap = contentH - y - scrollViewH;
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
    requestAnimationFrame(() => {
      if (!streamScrollUserAdjustedRef.current) {
        alignTurnAnchorToTop();
      } else {
        updateScrollDownFlag();
      }
    });
  }, [
    assistantText,
    streamBusy,
    alignTurnAnchorToTop,
    updateScrollDownFlag,
  ]);

  const scrollToBottom = useCallback(() => {
    const maxScroll = Math.max(0, contentH - scrollViewH);
    scrollRef.current?.scrollTo({ y: maxScroll, animated: true });
    scrollHintDismissedRef.current = true;
    setShowScrollDown(false);
  }, [contentH, scrollViewH]);

  const runStream = useCallback(
    async (input: { type: "text"; text: string } | { type: "audio"; uri: string }) => {
      try {
        let userMessageText = "";

        if (input.type === "text") {
          userMessageText = input.text.trim();
        } else {
          const mime = mimeFromRecordingUri(input.uri);
          const base64 = await readAsStringAsync(input.uri, {
            encoding: "base64",
          });
          setPhase("transcribing");
          const transcript = await transcribeCommunicatorAudio({
            mimeType: mime,
            base64,
            language: strings.transcribeLanguage,
          });
          userMessageText = transcript.text.trim();
          setPhase("idle");
          if (userMessageText && transcript.confidence != null && transcript.confidence < LOW_TRANSCRIPTION_CONFIDENCE) {
            setPendingTranscript(userMessageText);
            setPendingTranscriptConfidence(transcript.confidence);
            return;
          }
        }

        if (!userMessageText) return;

        const userMessage: CommunicatorHistoryMessage = {
          id: newMessageId(),
          role: "user",
          content: userMessageText,
          createdAt: Date.now(),
        };
        setMessages((prev) => [...prev, userMessage]);
        onMessage?.(userMessage);

        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
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
        });

        if (result == null) {
          return;
        }

        const complete = result.complete;
        if (complete?.conversationId) setActiveConversationId(complete.conversationId);
        const mergedText = resolveAssistantReplyText(result.assistantText, complete?.fullText).trim();
        const assistant: CommunicatorHistoryMessage = {
          id: complete?.messageId ?? newMessageId(),
          role: "assistant",
          content: mergedText.length > 0 ? mergedText : strings.emptyAssistantReplyFallback,
          createdAt: Date.now(),
          meta: {
            orchestratorDecision: result.decision,
            practicePicked: complete?.practicePicked,
            shouldClose: complete?.shouldClose,
            recommendationCorrected: complete?.recommendationCorrected,
          },
        };
        setMessages((prev) => [...prev, assistant]);
        onMessage?.(assistant);
        resetChatStream();
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
          resetChatStream();
          return;
        }
        reportError(err);
      }
    },
    [
      activeConversationId,
      entrySource,
      onMessage,
      onPracticePicked,
      reportError,
      resetChatStream,
      runChatStream,
      systemPrompt,
      triggerMeta,
      useCase,
      strings.emptyAssistantReplyFallback,
      strings.transcribeLanguage,
    ],
  );

  const abortRequest = useCallback(() => {
    abortChatStream();
    resetChatStream();
    onAbort?.();
  }, [abortChatStream, onAbort, resetChatStream]);

  /**
   * Автоматическая отправка первого сообщения при монтировании компонента.
   * См. проп `autoSendInitialMessage`. Ref-guard защищает от повторной
   * отправки при StrictMode-двойном ране эффекта или при смене пропа —
   * «первое» должно остаться ровно одним.
   */
  const autoSendFiredRef = useRef(false);
  useEffect(() => {
    if (autoSendFiredRef.current) return;
    if (!sessionSynced) return;
    const text = autoSendInitialMessage?.trim();
    if (!text) return;
    autoSendFiredRef.current = true;
    // Небольшая задержка: даём UI смонтироваться, чтобы пользователь видел,
    // как сообщение появляется «естественно», а не мгновенно
    const h = setTimeout(() => {
      void runStream({ type: "text", text });
    }, 120);
    return () => clearTimeout(h);
  }, [autoSendInitialMessage, runStream, sessionSynced]);

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

    let base64: string;
    try {
      const info = await getInfoAsync(uri);
      const size = info.exists && !info.isDirectory ? info.size : 0;
      if (size < 16 || durationMs < MIN_VOICE_MS) return;
      base64 = await readAsStringAsync(uri, { encoding: "base64" });
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      reportError(err);
      return;
    }
    const mime = mimeFromRecordingUri(uri);
    onEmotionSegment?.({
      mimeType: mime,
      base64,
      durationMs,
    });

    await runStream({ type: "audio", uri });
  }, [onEmotionSegment, phase, reportError, resetRecordingAudioMode, runStream]);

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

  const turnUserAnchorIdx = streamBusy ? null : getTurnUserAnchorIndex(messages);
  const turnAssistantIdx = streamBusy ? null : getTurnAssistantAnchorIndex(messages);

  const onAnchorLayout = useCallback((e: LayoutChangeEvent) => {
    setAnchorY(e.nativeEvent.layout.y);
  }, []);

  const onTailLayout = useCallback((e: LayoutChangeEvent) => {
    const { y, height } = e.nativeEvent.layout;
    setTailBottom(y + height);
  }, []);

  const onScrollViewLayout = useCallback((e: LayoutChangeEvent) => {
    setScrollViewH(e.nativeEvent.layout.height);
  }, []);

  const onContentSizeChange = useCallback(
    (_w: number, h: number) => {
      setContentH(h);
      updateScrollDownFlag();
    },
    [updateScrollDownFlag],
  );

  const borderColor = theme.colors.surfaceBorder;
  const footerBg = theme.colors.surface;
  const currentPhaseLabel = strings.phaseLabelFor(decision);
  const pendingStatus =
    streamStatus === "thinking"
      ? strings.thinkingStatus
      : streamStatus === "typing"
        ? strings.typingStatus(currentPhaseLabel)
        : undefined;

  const messagePhaseLabel = useCallback(
    (message: CommunicatorHistoryMessage): string | undefined => {
      const decisionMeta = message.meta?.orchestratorDecision as OrchestratorDecision | null | undefined;
      return strings.phaseLabelFor(decisionMeta ?? null);
    },
    [strings],
  );

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: theme.colors.screenBg }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={insets.bottom + 8}
    >
      <View style={styles.flex}>
        <ScrollView
          ref={scrollRef}
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
        >
          <View>
            {messages.map((m, i) =>
              m.role === "user" ? (
                <View
                  key={m.id}
                  onLayout={turnUserAnchorIdx === i ? onAnchorLayout : undefined}
                >
                  <UserBubble text={m.content} isStreaming={false} strings={strings} />
                </View>
              ) : (
                <View
                  key={m.id}
                  onLayout={turnAssistantIdx === i ? onTailLayout : undefined}
                >
                  <AssistantBubble
                    text={m.content}
                    isStreaming={false}
                    phaseLabel={messagePhaseLabel(m)}
                  />
                  {m.meta?.practicePicked ? (
                    <PracticeCard
                      practice={m.meta.practicePicked}
                      strings={strings}
                      onPress={onPracticePicked}
                    />
                  ) : null}
                </View>
              ),
            )}

            {!sessionSynced ? (
              <View key="session-sync-pending" onLayout={onTailLayout}>
                <ThinkingIndicator />
              </View>
            ) : null}

            {streamBusy && (
              <View key="pending-assistant" onLayout={onTailLayout}>
                {streamStatus === "thinking" ? (
                  <ThinkingIndicator />
                ) : (
                  <AssistantBubble
                    text={assistantText}
                    isStreaming={streamStatus === "typing"}
                    phaseLabel={pendingStatus}
                  />
                )}
              </View>
            )}
          </View>
        </ScrollView>

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
  assistantStatusRow: {
    width: "100%",
    paddingHorizontal: 12,
    paddingTop: 8,
    alignItems: "flex-start",
  },
  assistantStatusBubble: {
    alignItems: "center",
    borderRadius: 20,
    borderBottomLeftRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 2,
    maxWidth: "92%",
    paddingHorizontal: 16,
    paddingVertical: 10,
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
