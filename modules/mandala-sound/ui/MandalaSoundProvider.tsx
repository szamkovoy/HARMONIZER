import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";

import { useBiofeedbackSubscribe } from "@/modules/biofeedback/bus/react";
import type { BeatEvent } from "@/modules/biofeedback/sensors/types";
import { ExpoMandalaSoundEngine } from "@/modules/mandala-sound/core/engine";
import { buildMandalaSoundFrame } from "@/modules/mandala-sound/core/sync";
import type {
  MandalaSoundBand,
  MandalaSoundSessionInput,
  MandalaSoundSyncFrame,
  MandalaSoundVisualSync,
} from "@/modules/mandala-sound/core/types";

const CONTROL_TICK_MS = 100;
const DEFAULT_DURATION_MS = 5 * 60_000;
const DEFAULT_FRAME: MandalaSoundSyncFrame = buildMandalaSoundFrame({
  startedAtMs: 0,
  nowMs: 0,
  durationMs: DEFAULT_DURATION_MS,
  previousBand: null,
});

type MandalaSoundContextValue = {
  frame: MandalaSoundSyncFrame;
  visualSync: MandalaSoundVisualSync;
  registerBeat: (beat: BeatEvent) => void;
};

const MandalaSoundContext = createContext<MandalaSoundContextValue>({
  frame: DEFAULT_FRAME,
  visualSync: {
    flickerHz: DEFAULT_FRAME.flickerHz,
    flickerIntensity: 0,
    breathPhase: DEFAULT_FRAME.breath.phase,
    pulsePhase: DEFAULT_FRAME.pulse.phase,
  },
  registerBeat: () => {},
});

function beatRrMs(previous: BeatEvent | null, next: BeatEvent): number | null {
  if (!previous) return null;
  const rrMs = next.timestampMs - previous.timestampMs;
  return rrMs > 280 && rrMs < 2_000 ? rrMs : null;
}

function MandalaSoundBioBridge({
  onBeat,
}: {
  onBeat: (beat: BeatEvent) => void;
}) {
  useBiofeedbackSubscribe("beat", (event) => onBeat(event.beat));
  return null;
}

export function MandalaSoundProvider({
  children,
  practiceKind,
  durationMs,
  chakra = 4,
  isActive,
  plannedCycle,
  cycleStartMs,
  biofeedbackEnabled = false,
}: PropsWithChildren<MandalaSoundSessionInput & { biofeedbackEnabled?: boolean }>) {
  const engineRef = useRef<ExpoMandalaSoundEngine | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const previousBandRef = useRef<MandalaSoundBand | null>(null);
  const lastBeatRef = useRef<BeatEvent | null>(null);
  const lastRrMsRef = useRef<number | null>(null);
  const [frame, setFrame] = useState<MandalaSoundSyncFrame>(DEFAULT_FRAME);

  const registerBeat = useCallback((beat: BeatEvent) => {
    const rrMs = beatRrMs(lastBeatRef.current, beat);
    lastBeatRef.current = beat;
    if (rrMs != null) {
      lastRrMsRef.current = rrMs;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!isActive) {
      startedAtRef.current = null;
      previousBandRef.current = null;
      lastBeatRef.current = null;
      lastRrMsRef.current = null;
      setFrame(DEFAULT_FRAME);
      void engineRef.current?.stop();
      return;
    }

    if (startedAtRef.current == null) {
      startedAtRef.current = Date.now();
    }

    if (engineRef.current == null) {
      engineRef.current = new ExpoMandalaSoundEngine();
    }

    void engineRef.current.start(chakra).catch(() => {
      // The visual sync still runs if the native audio backend refuses playback.
    });

    const tick = () => {
      if (cancelled || startedAtRef.current == null) return;
      const nextFrame = buildMandalaSoundFrame({
        startedAtMs: startedAtRef.current,
        nowMs: Date.now(),
        durationMs,
        plannedCycle,
        cycleStartMs,
        lastBeat: lastBeatRef.current,
        lastRrMs: lastRrMsRef.current,
        previousBand: previousBandRef.current,
        hueMain: 220 + (Math.max(1, Math.min(7, chakra)) - 4) * 18,
        zoomVelocity: practiceKind === "breath" ? 0.28 : 0.42,
      });
      previousBandRef.current = nextFrame.band;
      setFrame(nextFrame);
      void engineRef.current?.update(nextFrame);
    };

    tick();
    const id = setInterval(tick, CONTROL_TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [chakra, cycleStartMs, durationMs, isActive, plannedCycle, practiceKind]);

  useEffect(() => {
    return () => {
      void engineRef.current?.stop();
      engineRef.current = null;
    };
  }, []);

  const visualSync = useMemo<MandalaSoundVisualSync>(
    () => ({
      flickerHz: frame.flickerHz,
      flickerIntensity: frame.flickerIntensity,
      breathPhase: frame.breath.phase,
      pulsePhase: frame.pulse.phase,
    }),
    [frame.breath.phase, frame.flickerHz, frame.flickerIntensity, frame.pulse.phase],
  );

  const contextValue = useMemo(
    () => ({ frame, visualSync, registerBeat }),
    [frame, registerBeat, visualSync],
  );

  return (
    <MandalaSoundContext.Provider value={contextValue}>
      {biofeedbackEnabled ? <MandalaSoundBioBridge onBeat={registerBeat} /> : null}
      {children}
    </MandalaSoundContext.Provider>
  );
}

export function useMandalaSoundFrame(): MandalaSoundSyncFrame {
  return useContext(MandalaSoundContext).frame;
}

export function useMandalaSoundSync(): MandalaSoundVisualSync {
  return useContext(MandalaSoundContext).visualSync;
}
