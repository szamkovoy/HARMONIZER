"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  readTextStream,
  streamCommunicatorChat,
} from "../api/communicator-client";
import { blobToBase64, pickAudioMimeType } from "../core/blob-helpers";
import { buildSystemInstruction, sliceHistoryForWindow } from "../core/session-helpers";
import type {
  CommunicatorHistoryMessage,
  CommunicatorInitialMode,
  CommunicatorModePolicy,
  CommunicatorSessionState,
  EmotionSegmentPayload,
} from "../core/types";
import { parseTranscriptStream } from "../core/transcript-parser";
import { AssistantBubble } from "./AssistantBubble";
import { DecodingDots } from "./DecodingDots";
import { ModeToggle } from "./ModeToggle";
import { ScrollDownHint } from "./ScrollDownHint";
import { UserBubble } from "./UserBubble";

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

type Phase = "idle" | "recording" | "processing" | "streaming" | "error";

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
  const [streamRaw, setStreamRaw] = useState("");
  const [localUserLine, setLocalUserLine] = useState("");
  const [txtDraft, setTxtDraft] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recordMimeRef = useRef("");
  const recordStartRef = useRef(0);
  const suppressClickRef = useRef(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const transcriptAnchorRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const prevTranscriptLenRef = useRef(0);
  const [showScrollDown, setShowScrollDown] = useState(false);

  const sessionState: CommunicatorSessionState = useMemo(() => {
    let p: CommunicatorSessionState["phase"] = "idle";
    if (phase === "recording") p = "recording";
    else if (phase === "processing") p = "processing";
    else if (phase === "streaming") p = "streaming";
    else if (phase === "error") p = "error";
    return { phase: p, uiMode, canSwitchMode };
  }, [phase, uiMode, canSwitchMode]);

  useEffect(() => {
    onStateChange?.(sessionState);
  }, [sessionState, onStateChange]);

  const parts = useMemo(() => parseTranscriptStream(streamRaw), [streamRaw]);

  const userBubbleText =
    parts.transcript.length > 0
      ? parts.transcript
      : uiMode === "TXT" && localUserLine
        ? localUserLine
        : "";

  const isBusy = phase === "processing" || phase === "streaming";

  const updateScrollDownFlag = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = gap < 72;
    stickToBottomRef.current = atBottom;
    setShowScrollDown(!atBottom && gap > 96);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateScrollDownFlag, { passive: true });
    return () => el.removeEventListener("scroll", updateScrollDownFlag);
  }, [updateScrollDownFlag]);

  useEffect(() => {
    if (!isBusy) {
      prevTranscriptLenRef.current = 0;
      return;
    }
    const el = scrollRef.current;
    if (!el) return;

    if (parts.transcript.length > 0 && prevTranscriptLenRef.current === 0) {
      transcriptAnchorRef.current?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }
    prevTranscriptLenRef.current = parts.transcript.length;

    requestAnimationFrame(() => {
      if (stickToBottomRef.current) {
        el.scrollTop = el.scrollHeight;
      }
      updateScrollDownFlag();
    });
  }, [streamRaw, parts.transcript, parts.answer, isBusy, updateScrollDownFlag]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stickToBottomRef.current = true;
    setShowScrollDown(false);
  }, []);

  const historyPayload = useCallback(() => {
    const base = sliceHistoryForWindow(messages, memoryWindow);
    return base.map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }, [messages, memoryWindow]);

  const finalizeStream = useCallback(
    (raw: string) => {
      const p = parseTranscriptStream(raw);
      const u: CommunicatorHistoryMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: p.transcript || localUserLine,
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
      const ac = new AbortController();
      abortRef.current = ac;
      setPhase("processing");
      setStreamRaw("");
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

        setPhase("streaming");

        const stream = await streamCommunicatorChat({
          systemInstruction,
          history: historyPayload(),
          input: bodyInput,
          signal: ac.signal,
        });

        let acc = "";
        await readTextStream(
          stream,
          (chunk) => {
            acc += chunk;
            setStreamRaw(acc);
          },
          ac.signal,
        );

        if (ac.signal.aborted) {
          setPhase("idle");
          setStreamRaw("");
          setLocalUserLine("");
          return;
        }

        finalizeStream(acc);
        setStreamRaw("");
        setLocalUserLine("");
        setPhase("idle");
      } catch (e: unknown) {
        const aborted =
          ac.signal.aborted ||
          (e instanceof Error && e.name === "AbortError") ||
          (typeof e === "object" &&
            e !== null &&
            "name" in e &&
            (e as { name: string }).name === "AbortError");
        if (aborted) {
          setPhase("idle");
          setStreamRaw("");
          setLocalUserLine("");
          return;
        }
        const err = e instanceof Error ? e : new Error(String(e));
        onError?.(err);
        setPhase("error");
        setStreamRaw("");
        setLocalUserLine("");
        setTimeout(() => setPhase("idle"), 400);
      } finally {
        abortRef.current = null;
      }
    },
    [finalizeStream, historyPayload, onError, systemPrompt],
  );

  const abortRequest = useCallback(() => {
    abortRef.current?.abort();
    setStreamRaw("");
    setLocalUserLine("");
    setPhase("idle");
    onAbort?.();
  }, [onAbort]);

  const startRecording = useCallback(async () => {
    if (phase !== "idle" || uiMode !== "VOICE") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickAudioMimeType();
      recordMimeRef.current = mime;
      chunksRef.current = [];
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mediaRecorderRef.current = rec;
      recordStartRef.current = performance.now();
      rec.ondataavailable = (ev) => {
        if (ev.data.size) chunksRef.current.push(ev.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
      };
      rec.start();
      setPhase("recording");
    } catch (e) {
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

    if (blob.size < 16) {
      setPhase("idle");
      return;
    }

    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 450);

    const durationMs = performance.now() - recordStartRef.current;
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

  const micVisual =
    phase === "recording" ? "recording" : isBusy ? "busy" : "idle";

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col bg-neutral-50 dark:bg-neutral-950 ${className ?? ""}`}
    >
      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-y-contain"
      >
        <div className="mx-auto flex w-full max-w-lg flex-col pb-40 pt-2">
          {messages.map((m) =>
            m.role === "user" ? (
              <UserBubble
                key={m.id}
                text={m.content}
                isStreaming={false}
              />
            ) : (
              <AssistantBubble
                key={m.id}
                text={m.content}
                isStreaming={false}
              />
            ),
          )}

          {isBusy && (
            <>
              <div key="pending-user" ref={transcriptAnchorRef}>
                <UserBubble
                  text={userBubbleText}
                  isStreaming={!parts.transcriptComplete}
                />
              </div>
              <AssistantBubble
                key="pending-assistant"
                text={parts.answer}
                isStreaming={phase === "streaming"}
              />
            </>
          )}
        </div>

        <ScrollDownHint visible={showScrollDown} onClick={scrollToBottom} />
      </div>

      <div className="border-t border-neutral-200/80 bg-white/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 dark:border-neutral-800 dark:bg-neutral-950/95">
        <div className="relative mx-auto flex w-full max-w-lg items-end gap-2">
          {uiMode === "VOICE" ? (
            <div className="flex min-h-[4.5rem] flex-1 flex-col items-center justify-end gap-1">
              {(phase === "processing" || phase === "streaming") && (
                <p className="text-center text-xs text-neutral-500 dark:text-neutral-400">
                  Расшифровка
                  <DecodingDots />
                </p>
              )}
              <button
                type="button"
                className="relative flex h-[4.5rem] w-[4.5rem] shrink-0 touch-none select-none items-center justify-center rounded-full bg-sky-500 shadow-md active:scale-[0.98] dark:bg-sky-600"
                style={{
                  opacity: micVisual === "recording" ? 0.72 : 1,
                }}
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
                    isBusy
                      ? "/icons/mic_button_off.png"
                      : "/icons/mic_button_on.png"
                  }
                  alt=""
                  className="pointer-events-none h-14 w-14 object-contain"
                  draggable={false}
                />
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
