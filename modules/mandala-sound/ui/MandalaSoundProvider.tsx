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
import { AmbientLoopEngine } from "@/modules/mandala-sound/core/ambientEngine";
import { ExpoMandalaSoundEngine, resolveLocalArtworkUri } from "@/modules/mandala-sound/core/engine";
import {
  isNatureSoundBedId,
  SOUND_BED_NEURO_SYNC,
  type SoundBedId,
} from "@/modules/mandala-sound/core/soundBed";
import { buildMandalaSoundFrame } from "@/modules/mandala-sound/core/sync";
import { logRuntimeEvent } from "@/services/runtimeDiagnostics";
import type {
  MandalaSoundSessionInput,
  MandalaSoundSyncFrame,
  MandalaSoundVisualSync,
} from "@/modules/mandala-sound/core/types";

const CONTROL_TICK_MS = 250;
const DEFAULT_DURATION_MS = 5 * 60_000;
const FADE_IN_MS = 600;
const FADE_OUT_MS = 800;
const DEFAULT_FRAME: MandalaSoundSyncFrame = buildMandalaSoundFrame({
  startedAtMs: 0,
  nowMs: 0,
  durationMs: DEFAULT_DURATION_MS,
  previousTargetHz: null,
});

type MandalaSoundContextValue = {
  frame: MandalaSoundSyncFrame;
  visualSync: MandalaSoundVisualSync;
  registerBeat: (beat: BeatEvent) => void;
  /** True while the OS has paused our audio (call, another app). Consumers can pause their timers. */
  interrupted: boolean;
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
  interrupted: false,
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
  soundBed = SOUND_BED_NEURO_SYNC,
  staysActiveInBackground = false,
  lockScreen,
}: PropsWithChildren<MandalaSoundSessionInput & { biofeedbackEnabled?: boolean }>) {
  const neuroEngineRef = useRef<ExpoMandalaSoundEngine | null>(null);
  const ambientEngineRef = useRef<AmbientLoopEngine | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const previousTargetHzRef = useRef<number | null>(null);
  const lastBeatRef = useRef<BeatEvent | null>(null);
  const lastRrMsRef = useRef<number | null>(null);
  const artworkUriRef = useRef<string | undefined>(undefined);
  const [frame, setFrame] = useState<MandalaSoundSyncFrame>(DEFAULT_FRAME);
  const [interrupted, setInterrupted] = useState(false);

  const registerBeat = useCallback((beat: BeatEvent) => {
    const rrMs = beatRrMs(lastBeatRef.current, beat);
    lastBeatRef.current = beat;
    if (rrMs != null) {
      lastRrMsRef.current = rrMs;
    }
  }, []);

  // Resolve the lock-screen cover art to a local URI once per artwork asset.
  useEffect(() => {
    if (!lockScreen?.artwork) {
      artworkUriRef.current = undefined;
      return;
    }
    let cancelled = false;
    void (async () => {
      const uri = await resolveLocalArtworkUri(lockScreen.artwork);
      if (!cancelled) artworkUriRef.current = uri;
    })();
    return () => {
      cancelled = true;
    };
  }, [lockScreen?.artwork]);

  // Visual sync tick — always runs while active (even for nature beds).
  useEffect(() => {
    let cancelled = false;

    if (!isActive) {
      startedAtRef.current = null;
      previousTargetHzRef.current = null;
      lastBeatRef.current = null;
      lastRrMsRef.current = null;
      setFrame(DEFAULT_FRAME);
      return;
    }

    if (startedAtRef.current == null) {
      startedAtRef.current = Date.now();
    }

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
        previousTargetHz: previousTargetHzRef.current,
        hueMain: 220 + (Math.max(1, Math.min(7, chakra)) - 4) * 18,
        zoomVelocity: practiceKind === "breath" ? 0.28 : 0.42,
      });
      previousTargetHzRef.current = nextFrame.targetHz;
      setFrame(nextFrame);
      void neuroEngineRef.current?.update(nextFrame);
    };

    tick();
    const id = setInterval(tick, CONTROL_TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [chakra, cycleStartMs, durationMs, isActive, plannedCycle, practiceKind]);

  // Audio bed lifecycle (neuro-sync vs nature) with fade in/out.
  useEffect(() => {
    let cancelled = false;
    const bed: SoundBedId = soundBed;

    const teardown = async (fadeOutMs: number) => {
      const neuro = neuroEngineRef.current;
      const ambient = ambientEngineRef.current;
      neuroEngineRef.current = null;
      ambientEngineRef.current = null;
      await Promise.all([neuro?.stop({ fadeOutMs }), ambient?.stop({ fadeOutMs })]);
    };

    if (!isActive) {
      logRuntimeEvent("mandala_sound_provider:inactive", { practiceKind, soundBed: bed }, "debug");
      void teardown(FADE_OUT_MS);
      setInterrupted(false);
      return () => {
        cancelled = true;
      };
    }

    logRuntimeEvent("mandala_sound_provider:active", {
      practiceKind,
      durationMs,
      chakra,
      soundBed: bed,
      controlTickMs: CONTROL_TICK_MS,
      lockScreen: Boolean(lockScreen),
    });

    void (async () => {
      await teardown(0);
      if (cancelled) return;

      const lockScreenMetadata = staysActiveInBackground && lockScreen
        ? {
            title: lockScreen.title,
            artist: "Harmonizer",
            artworkUrl: artworkUriRef.current,
          }
        : undefined;

      const onPlaybackStateChange = (playing: boolean) => {
        // While we never pause the bed ourselves, `playing=false` means the OS
        // interrupted us (call / another app took audio focus); `playing=true`
        // means focus returned and the system resumed us.
        setInterrupted(!playing);
      };

      if (isNatureSoundBedId(bed)) {
        const engine = new AmbientLoopEngine();
        ambientEngineRef.current = engine;
        try {
          await engine.start(bed, {
            fadeInMs: FADE_IN_MS,
            staysActiveInBackground,
            lockScreenMetadata,
            onPlaybackStateChange,
          });
        } catch {
          /* visual sync continues */
        }
        return;
      }

      const engine = new ExpoMandalaSoundEngine();
      neuroEngineRef.current = engine;
      try {
        await engine.start(chakra, {
          staysActiveInBackground,
          lockScreenMetadata,
          onPlaybackStateChange,
        });
      } catch {
        /* visual sync continues */
      }
    })();

    return () => {
      cancelled = true;
      void teardown(FADE_OUT_MS);
    };
  }, [chakra, durationMs, isActive, practiceKind, soundBed, staysActiveInBackground, lockScreen]);

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
    () => ({ frame, visualSync, registerBeat, interrupted }),
    [frame, registerBeat, visualSync, interrupted],
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

/** True while the OS has paused our audio (call, another app). Pause elapsed-time accounting accordingly. */
export function useMandalaSoundInterruption(): boolean {
  return useContext(MandalaSoundContext).interrupted;
}
