import { Audio } from "expo-av";
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
  AppState,
  Image,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { mimeFromRecordingUri } from "@/modules/communicator/core/audioMime";
import { buildSystemInstruction, sliceHistoryForWindow } from "@/modules/communicator/core/session-helpers";
import { sanitizeTranscriptText } from "@/modules/communicator/core/transcript-parser";
import type {
  CommunicatorHistoryMessage,
  CommunicatorInitialMode,
  CommunicatorModePolicy,
  CommunicatorSessionState,
  EmotionSegmentPayload,
} from "@/modules/communicator/core/types";
import type { CommunicatorStreamChunk } from "@/modules/communicator/api/communicator-stream";

import { AssistantBubble } from "./AssistantBubble";
import { DecodingDots } from "./DecodingDots";
import { ModeToggle } from "./ModeToggle";
import { ScrollDownHint } from "./ScrollDownHint";
import { UserBubble } from "./UserBubble";
import { useCommunicatorStream } from "./useCommunicatorStream";

const micOn = require("@/assets/icons/mic_button_on.png");
const micOff = require("@/assets/icons/mic_button_off.png");

function resolveUiMode(props: {
  mode?: CommunicatorModePolicy;
  initialMode?: CommunicatorInitialMode;
}): { uiMode: "VOICE" | "TXT"; canSwitch: boolean } {
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
  history?: CommunicatorHistoryMessage[];
  /** Последние N пар сообщений в запросе; без ограничения — вся переданная история */
  memoryWindow?: number;
  onEmotionSegment?: (payload: EmotionSegmentPayload) => void;
  onMessage?: (msg: CommunicatorHistoryMessage) => void;
  onError?: (err: Error) => void;
  onAbort?: () => void;
  onStateChange?: (state: CommunicatorSessionState) => void;
}

type Phase = "idle" | "recording" | "error";

const MIN_VOICE_MS = 450;

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

export function Communicator({
  initialMode,
  mode,
  systemPrompt,
  history,
  memoryWindow,
  onEmotionSegment,
  onMessage,
  onError,
  onAbort,
  onStateChange,
}: CommunicatorProps) {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const isDark = scheme === "dark";

  const resolved = useMemo(
    () => resolveUiMode({ mode, initialMode }),
    [mode, initialMode],
  );

  const [uiMode, setUiMode] = useState(resolved.uiMode);
  const canSwitchMode = resolved.canSwitch;

  useEffect(() => {
    setUiMode(resolved.uiMode);
  }, [resolved.uiMode]);

  const [messages, setMessages] = useState<CommunicatorHistoryMessage[]>(() =>
    ensureIds(sliceHistoryForWindow(history, memoryWindow)),
  );

  const [phase, setPhase] = useState<Phase>("idle");
  const [localUserLine, setLocalUserLine] = useState("");
  const [txtDraft, setTxtDraft] = useState("");

  const reportError = useCallback(
    (err: Error) => {
      console.error("[Communicator]", err.message, err.stack ?? "");
      onError?.(err);
      Alert.alert("Не удалось отправить сообщение", err.message, [
        { text: "OK" },
      ]);
    },
    [onError],
  );

  const {
    raw: streamRaw,
    parsed: parts,
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
  /** true от старта startRecording до момента, пока запись реально не пошла (показ системного окна разрешений) */
  const micWarmupRef = useRef(false);
  const startRecordingGenerationRef = useRef(0);
  /** Сброс нативного «залипания» Pressable после отмены / отказа в разрешениях */
  const [micPressResetKey, setMicPressResetKey] = useState(0);

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
    if (phase === "recording") p = "recording";
    else if (streamStatus === "processing") p = "processing";
    else if (streamStatus === "streaming") p = "streaming";
    else if (phase === "error") p = "error";
    return { phase: p, uiMode, canSwitchMode };
  }, [phase, streamStatus, uiMode, canSwitchMode]);

  useEffect(() => {
    onStateChange?.(sessionState);
  }, [sessionState, onStateChange]);

  const userBubbleText =
    parts.transcript.length > 0
      ? parts.transcriptComplete
        ? sanitizeTranscriptText(parts.transcript)
        : parts.transcript
      : uiMode === "TXT" && localUserLine
        ? localUserLine
        : "";

  const isBusy = phase === "recording" || streamBusy;

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
    streamRaw,
    parts.transcript,
    parts.answer,
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

  const historyPayload = useCallback(() => {
    const base = sliceHistoryForWindow(messages, memoryWindow);
    return base.map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }, [messages, memoryWindow]);

  const finalizeStream = useCallback(
    (result: CommunicatorStreamChunk) => {
      const p = result.parsed;
      const u: CommunicatorHistoryMessage = {
        id: newMessageId(),
        role: "user",
        content: sanitizeTranscriptText(p.transcript || localUserLine),
        createdAt: Date.now(),
      };
      const a: CommunicatorHistoryMessage = {
        id: newMessageId(),
        role: "assistant",
        content: p.answer,
        createdAt: Date.now(),
      };
      setMessages((prev) => [...prev, u, a]);
      onMessage?.(u);
      onMessage?.(a);
    },
    [localUserLine, onMessage],
  );

  const runStream = useCallback(
    async (input: { type: "text"; text: string } | { type: "audio"; uri: string }) => {
      setLocalUserLine("");

      const systemInstruction = buildSystemInstruction(systemPrompt);

      try {
        let bodyInput:
          | { type: "text"; text: string }
          | { type: "audio"; mimeType: string; base64: string };

        if (input.type === "text") {
          bodyInput = { type: "text", text: input.text };
          setLocalUserLine(input.text);
        } else {
          const mime = mimeFromRecordingUri(input.uri);
          const base64 = await readAsStringAsync(input.uri, {
            encoding: "base64",
          });
          bodyInput = { type: "audio", mimeType: mime, base64 };
        }

        const result = await runChatStream({
          systemInstruction,
          history: historyPayload(),
          input: bodyInput,
        });

        if (result == null) {
          setLocalUserLine("");
          return;
        }

        finalizeStream(result);
        resetChatStream();
        setLocalUserLine("");
      } catch (e) {
        setPhase("error");
        setTimeout(() => setPhase("idle"), 400);
        const err = e instanceof Error ? e : new Error(String(e));
        reportError(err);
      }
    },
    [finalizeStream, historyPayload, reportError, resetChatStream, runChatStream, systemPrompt],
  );

  const abortRequest = useCallback(() => {
    abortChatStream();
    resetChatStream();
    setLocalUserLine("");
    onAbort?.();
  }, [abortChatStream, onAbort, resetChatStream]);

  const discardRecording = useCallback(async () => {
    const rec = recordingRef.current;
    if (!rec) return;
    try {
      await rec.stopAndUnloadAsync();
    } catch {
      /* ignore */
    }
    recordingRef.current = null;
    setPhase("idle");
  }, []);

  const cancelMicWarmup = useCallback(() => {
    startRecordingGenerationRef.current += 1;
    micWarmupRef.current = false;
    setPhase("idle");
    setMicPressResetKey((k) => k + 1);
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "inactive" && micWarmupRef.current) {
        cancelMicWarmup();
        return;
      }
      if (next === "background") {
        void discardRecording();
      }
    });
    return () => sub.remove();
  }, [cancelMicWarmup, discardRecording]);

  const startRecording = useCallback(async () => {
    if (phase !== "idle" || uiMode !== "VOICE" || streamBusy) return;
    const generation = ++startRecordingGenerationRef.current;
    micWarmupRef.current = true;
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (generation !== startRecordingGenerationRef.current) return;
      if (!perm.granted) {
        micWarmupRef.current = false;
        reportError(new Error("Нет доступа к микрофону"));
        setMicPressResetKey((k) => k + 1);
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      if (generation !== startRecordingGenerationRef.current) return;
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      if (generation !== startRecordingGenerationRef.current) {
        try {
          await recording.stopAndUnloadAsync();
        } catch {
          /* ignore */
        }
        return;
      }
      micWarmupRef.current = false;
      recordingRef.current = recording;
      recordStartRef.current = Date.now();
      setPhase("recording");
    } catch (e) {
      micWarmupRef.current = false;
      setPhase("idle");
      setMicPressResetKey((k) => k + 1);
      const err = e instanceof Error ? e : new Error(String(e));
      reportError(err);
    }
  }, [phase, reportError, streamBusy, uiMode]);

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
      setPhase("idle");
      return;
    }

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
  }, [onEmotionSegment, phase, reportError, runStream]);

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

  const toggleMode = useCallback(() => {
    if (!canSwitchMode || isBusy) return;
    setUiMode((m) => (m === "VOICE" ? "TXT" : "VOICE"));
  }, [canSwitchMode, isBusy]);

  const micShowsBusyAsset = isBusy && phase !== "recording";

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

  const borderColor = isDark ? "#262626" : "#e5e5e5";
  const footerBg = isDark ? "rgba(10,10,10,0.96)" : "rgba(255,255,255,0.96)";

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: isDark ? "#0a0a0a" : "#fafafa" }]}
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
                  <UserBubble text={m.content} isStreaming={false} />
                </View>
              ) : (
                <View
                  key={m.id}
                  onLayout={turnAssistantIdx === i ? onTailLayout : undefined}
                >
                  <AssistantBubble text={m.content} isStreaming={false} />
                </View>
              ),
            )}

            {streamBusy && (
              <>
                <View key="pending-user" onLayout={onAnchorLayout}>
                  <UserBubble
                    text={userBubbleText}
                    isStreaming={!parts.transcriptComplete}
                  />
                </View>
                <View key="pending-assistant" onLayout={onTailLayout}>
                  <AssistantBubble
                    text={parts.answer}
                    isStreaming={streamStatus === "streaming"}
                  />
                </View>
              </>
            )}
          </View>
        </ScrollView>

        <ScrollDownHint visible={showScrollDown} onPress={scrollToBottom} />
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
        <View style={styles.footerRow}>
          {uiMode === "VOICE" ? (
            <View style={styles.voiceCol}>
              {(streamStatus === "processing" || streamStatus === "streaming") && (
                <Text
                  style={[styles.hint, { color: isDark ? "#a3a3a3" : "#737373" }]}
                >
                  Расшифровка
                  <DecodingDots />
                </Text>
              )}
              <Pressable
                key={micPressResetKey}
                accessibilityRole="button"
                accessibilityLabel={
                  isBusy ? "Отменить запрос" : "Удерживайте для записи"
                }
                onPressIn={onMicPressIn}
                onPressOut={onMicPressOut}
                onPress={onMicPress}
                style={styles.micHit}
              >
                <Image
                  source={micShowsBusyAsset ? micOff : micOn}
                  style={styles.micImg}
                  resizeMode="contain"
                />
                {phase === "recording" ? (
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
                  backgroundColor: isDark ? "#171717" : "#fff",
                },
              ]}
            >
              <TextInput
                value={txtDraft}
                onChangeText={setTxtDraft}
                placeholder="Сообщение…"
                placeholderTextColor={isDark ? "#737373" : "#a3a3a3"}
                editable={!isBusy}
                multiline
                maxLength={8000}
                style={[
                  styles.input,
                  { color: isDark ? "#fafafa" : "#171717" },
                ]}
                onSubmitEditing={() => void sendText()}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Отправить"
                disabled={isBusy || !txtDraft.trim()}
                onPress={() => void sendText()}
                style={[
                  styles.sendBtn,
                  (isBusy || !txtDraft.trim()) && styles.sendBtnDisabled,
                ]}
              >
                <Text style={styles.sendBtnText}>Отпр.</Text>
              </Pressable>
            </View>
          )}

          {canSwitchMode ? (
            <ModeToggle
              targetMode={uiMode === "VOICE" ? "TXT" : "VOICE"}
              onToggle={toggleMode}
              disabled={isBusy}
            />
          ) : (
            <View style={styles.toggleSpacer} />
          )}
        </View>
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
  voiceCol: {
    flex: 1,
    minHeight: 72,
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 4,
  },
  hint: {
    fontSize: 12,
    textAlign: "center",
  },
  micHit: {
    width: 72,
    height: 72,
    alignItems: "center",
    justifyContent: "center",
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
    backgroundColor: "#0ea5e9",
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 2,
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  toggleSpacer: { width: 40 },
});
