"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { blobToBase64, pickAudioMimeType } from "../core/blob-helpers";
import { sanitizeTranscriptText } from "../core/transcript-parser";
import { buildSystemInstruction, sliceHistoryForWindow } from "../core/session-helpers";
import type {
  CommunicatorHistoryMessage,
  CommunicatorInitialMode,
  CommunicatorModePolicy,
  CommunicatorSessionState,
  EmotionSegmentPayload,
} from "../core/types";
import { AssistantBubble } from "./AssistantBubble";
import { DecodingDots } from "./DecodingDots";
import { ModeToggle } from "./ModeToggle";
import { ScrollDownHint } from "./ScrollDownHint";
import { UserBubble } from "./UserBubble";
import type { CommunicatorStreamChunk } from "./communicator-stream";
import { useCommunicatorStream } from "./useCommunicatorStream";

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

function ensureIds(
  list: CommunicatorHistoryMessage[] | undefined,
): CommunicatorHistoryMessage[] {
  if (!list?.length) return [];
  return list.map((m) => ({
    ...m,
    id: m.id || (typeof crypto !== "undefined" ? crypto.randomUUID() : String(Math.random())),
  }));
}

export interface CommunicatorProps {
  initialMode?: CommunicatorInitialMode;
  mode?: CommunicatorModePolicy;
  systemPrompt: string;
  history?: CommunicatorHistoryMessage[];
  memoryWindow?: number;
  onEmotionSegment?: (payload: EmotionSegmentPayload) => void;
  onMessage?: (msg: CommunicatorHistoryMessage) => void;
  onError?: (err: Error) => void;
  onAbort?: () => void;
  onStateChange?: (state: CommunicatorSessionState) => void;
  className?: string;
}

type Phase = "idle" | "recording" | "error";

/** Короче — считаем случайным срабатыванием при системных окнах (разрешение микрофона и т.п.). */
const MIN_VOICE_MS = 450;

/** Индекс сообщения пользователя в паре «вопрос → ответ» для привязки ленты к верху экрана */
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

/** Индекс последнего ответа ассистента в текущей паре (для нижнего якоря хода) */
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
  className,
}: CommunicatorProps) {
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

  const {
    raw: streamRaw,
    parsed: parts,
    status: streamStatus,
    run: runChatStream,
    abort: abortChatStream,
    reset: resetChatStream,
    isBusy: streamBusy,
  } = useCommunicatorStream({ onError });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recordMimeRef = useRef("");
  const recordStartRef = useRef(0);
  const suppressClickRef = useRef(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  /** Верх блока с транскрипцией текущего хода — не выше верхней границы области прокрутки */
  const turnAnchorRef = useRef<HTMLDivElement>(null);
  /** Низ ответа ассистента в том же ходе — чтобы не оставлять лишний зазор снизу, если ответ короткий */
  const turnTailRef = useRef<HTMLDivElement>(null);
  const programmaticScrollRef = useRef(false);
  /** Скрыть стрелку «вниз» до следующего ответа ИИ после любого жеста прокрутки пользователя */
  const scrollHintDismissedRef = useRef(true);
  /** Пользователь сдвинул ленту во время стрима — не перетягивать якорь на каждом чанке */
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
    const el = scrollRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (scrollHintDismissedRef.current) {
      setShowScrollDown(false);
      return;
    }
    setShowScrollDown(gap > 56);
  }, []);

  const alignTurnAnchorToTop = useCallback(() => {
    const container = scrollRef.current;
    const anchor = turnAnchorRef.current;
    if (!container || !anchor) return;
    programmaticScrollRef.current = true;

    const cRect = container.getBoundingClientRect();
    const H = container.clientHeight;
    const maxScroll = Math.max(0, container.scrollHeight - H);
    const s0 = container.scrollTop;

    const pinScroll = s0 + (anchor.getBoundingClientRect().top - cRect.top);

    const tail = turnTailRef.current;
    let target = pinScroll;

    if (tail) {
      const tailBottomScroll =
        s0 + (tail.getBoundingClientRect().bottom - cRect.top);
      const bottomAlign = tailBottomScroll - H;
      if (bottomAlign > 0) {
        target = Math.min(pinScroll, bottomAlign);
      } else {
        target = pinScroll;
      }
    }

    target = Math.min(Math.max(0, target), maxScroll);
    container.scrollTop = target;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        programmaticScrollRef.current = false;
        updateScrollDownFlag();
      });
    });
  }, [updateScrollDownFlag]);

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

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (!programmaticScrollRef.current) {
        scrollHintDismissedRef.current = true;
        if (streamBusy) streamScrollUserAdjustedRef.current = true;
      }
      updateScrollDownFlag();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [streamBusy, updateScrollDownFlag]);

  useEffect(() => {
    if (!streamBusy) return;
    const el = scrollRef.current;
    if (!el) return;

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
    const el = scrollRef.current;
    if (!el) return;
    programmaticScrollRef.current = true;
    el.scrollTop = el.scrollHeight;
    scrollHintDismissedRef.current = true;
    setShowScrollDown(false);
    requestAnimationFrame(() => {
      programmaticScrollRef.current = false;
    });
  }, []);

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
        id: crypto.randomUUID(),
        role: "user",
        content: sanitizeTranscriptText(p.transcript || localUserLine),
        createdAt: Date.now(),
      };
      const a: CommunicatorHistoryMessage = {
        id: crypto.randomUUID(),
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
    async (input: { type: "text"; text: string } | { type: "audio"; blob: Blob }) => {
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
          const mime = input.blob.type || pickAudioMimeType();
          const base64 = await blobToBase64(input.blob);
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
      } catch {
        setPhase("error");
        setTimeout(() => setPhase("idle"), 400);
      }
    },
    [finalizeStream, historyPayload, resetChatStream, runChatStream, systemPrompt],
  );

  const abortRequest = useCallback(() => {
    abortChatStream();
    resetChatStream();
    setLocalUserLine("");
    onAbort?.();
  }, [abortChatStream, onAbort, resetChatStream]);

  const discardRecording = useCallback(async () => {
    const rec = mediaRecorderRef.current;
    if (!rec) return;
    await new Promise<void>((resolve) => {
      rec.addEventListener("error", () => resolve(), { once: true });
      rec.addEventListener("stop", () => resolve(), { once: true });
      try {
        rec.stop();
      } catch {
        resolve();
      }
    });
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    setPhase("idle");
  }, []);

  useEffect(() => {
    const onInterrupt = () => {
      void discardRecording();
    };
    window.addEventListener("blur", onInterrupt);
    const onVis = () => {
      if (document.visibilityState === "hidden") onInterrupt();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("blur", onInterrupt);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [discardRecording]);

  const startRecording = useCallback(async () => {
    if (phase !== "idle" || uiMode !== "VOICE") return;
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickAudioMimeType();
      recordMimeRef.current = mime;
      chunksRef.current = [];
      const rec = new MediaRecorder(mediaStream, mime ? { mimeType: mime } : undefined);
      mediaRecorderRef.current = rec;
      recordStartRef.current = performance.now();
      rec.ondataavailable = (ev) => {
        if (ev.data.size) chunksRef.current.push(ev.data);
      };
      rec.onstop = () => {
        mediaStream.getTracks().forEach((t) => t.stop());
      };
      rec.start();
      setPhase("recording");
    } catch (e) {
      setPhase("idle");
      const err = e instanceof Error ? e : new Error(String(e));
      onError?.(err);
    }
  }, [onError, phase, uiMode]);

  const stopRecordingAndSend = useCallback(async () => {
    const rec = mediaRecorderRef.current;
    if (!rec || phase !== "recording") return;

    await new Promise<void>((resolve) => {
      rec.addEventListener("error", () => resolve(), { once: true });
      rec.addEventListener("stop", () => resolve(), { once: true });
      try {
        rec.stop();
      } catch {
        resolve();
      }
    });

    mediaRecorderRef.current = null;
    const mime = recordMimeRef.current || pickAudioMimeType();
    const blob = new Blob(chunksRef.current, { type: mime });
    chunksRef.current = [];

    const durationMs = performance.now() - recordStartRef.current;
    if (blob.size < 16 || durationMs < MIN_VOICE_MS) {
      setPhase("idle");
      return;
    }

    // Запись закончилась — иначе phase остаётся "recording" и isBusy не даёт
    // повторить запись и блокирует переключатель TXT.
    setPhase("idle");

    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 450);

    const base64 = await blobToBase64(blob);
    onEmotionSegment?.({
      mimeType: mime,
      base64,
      durationMs,
    });

    await runStream({ type: "audio", blob });
  }, [onEmotionSegment, phase, runStream]);

  const onMicPointerDown = useCallback(() => {
    if (isBusy) return;
    if (uiMode !== "VOICE") return;
    void startRecording();
  }, [isBusy, startRecording, uiMode]);

  const onMicPointerUp = useCallback(() => {
    if (phase === "recording") {
      void stopRecordingAndSend();
    }
  }, [phase, stopRecordingAndSend]);

  const onMicClick = useCallback(() => {
    if (suppressClickRef.current) return;
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

  /** «Выключенный» микрофон только после отпускания: отправка / ожидание (не во время удержания записи). */
  const micShowsBusyAsset = isBusy && phase !== "recording";

  const turnUserAnchorIdx = streamBusy
    ? null
    : getTurnUserAnchorIndex(messages);

  const turnAssistantIdx = streamBusy
    ? null
    : getTurnAssistantAnchorIndex(messages);

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col bg-neutral-50 dark:bg-neutral-950 ${className ?? ""}`}
    >
      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-y-contain"
      >
        <div className="mx-auto flex w-full min-w-0 max-w-lg flex-col pb-28 pt-2 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div
                key={m.id}
                ref={turnUserAnchorIdx === i ? turnAnchorRef : undefined}
              >
                <UserBubble
                  text={m.content}
                  isStreaming={false}
                />
              </div>
            ) : (
              <div
                key={m.id}
                ref={turnAssistantIdx === i ? turnTailRef : undefined}
              >
                <AssistantBubble
                  text={m.content}
                  isStreaming={false}
                />
              </div>
            ),
          )}

          {streamBusy && (
            <>
              <div key="pending-user" ref={turnAnchorRef}>
                <UserBubble
                  text={userBubbleText}
                  isStreaming={!parts.transcriptComplete}
                />
              </div>
              <div key="pending-assistant" ref={turnTailRef}>
                <AssistantBubble
                  text={parts.answer}
                  isStreaming={streamStatus === "streaming"}
                />
              </div>
            </>
          )}
        </div>

        <ScrollDownHint visible={showScrollDown} onClick={scrollToBottom} />
      </div>

      <div className="border-t border-neutral-200/80 bg-white/95 pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-2 dark:border-neutral-800 dark:bg-neutral-950/95">
        <div className="relative mx-auto flex w-full min-w-0 max-w-lg items-end gap-3">
          {uiMode === "VOICE" ? (
            <div className="flex min-h-[4.5rem] flex-1 flex-col items-center justify-end gap-1">
              {(streamStatus === "processing" || streamStatus === "streaming") && (
                <p className="text-center text-xs text-neutral-500 dark:text-neutral-400">
                  Расшифровка
                  <DecodingDots />
                </p>
              )}
              <button
                type="button"
                className="relative flex h-[4.5rem] w-[4.5rem] shrink-0 touch-none select-none items-center justify-center overflow-hidden rounded-full border-0 bg-transparent p-0 shadow-none outline-none ring-0 [-webkit-tap-highlight-color:transparent] focus:outline-none focus-visible:outline-none active:scale-[0.98]"
                onPointerDown={onMicPointerDown}
                onPointerUp={onMicPointerUp}
                onPointerLeave={onMicPointerUp}
                onClick={onMicClick}
                aria-label={
                  isBusy ? "Отменить запрос" : "Удерживайте для записи"
                }
              >
                <img
                  src={
                    micShowsBusyAsset
                      ? "/icons/mic_button_off.png"
                      : "/icons/mic_button_on.png"
                  }
                  alt=""
                  className="pointer-events-none h-14 w-14 object-contain"
                  draggable={false}
                />
                {phase === "recording" && (
                  <span
                    className="pointer-events-none absolute inset-0 rounded-full bg-black/35"
                    aria-hidden
                  />
                )}
              </button>
            </div>
          ) : (
            <div className="flex flex-1 items-end gap-2 rounded-2xl border border-neutral-200 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900">
              <textarea
                value={txtDraft}
                onChange={(e) => setTxtDraft(e.target.value)}
                placeholder="Сообщение…"
                rows={1}
                disabled={isBusy}
                className="max-h-32 min-h-[2.5rem] w-full resize-none bg-transparent text-[15px] text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendText();
                  }
                }}
              />
              <button
                type="button"
                disabled={isBusy || !txtDraft.trim()}
                onClick={() => void sendText()}
                className="mb-0.5 shrink-0 rounded-full bg-sky-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-sky-600"
              >
                Отпр.
              </button>
            </div>
          )}

          {canSwitchMode ? (
            <ModeToggle
              targetMode={uiMode === "VOICE" ? "TXT" : "VOICE"}
              onToggle={toggleMode}
              disabled={isBusy}
            />
          ) : (
            <div className="w-10 shrink-0" aria-hidden />
          )}
        </div>
      </div>
    </div>
  );
}
