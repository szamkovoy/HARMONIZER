import { useCallback, useMemo, useState } from "react";
import { useSharedValue } from "react-native-reanimated";

import {
  createSessionStateFromKeyframe,
  DEFAULT_KEYFRAME,
  DEFAULT_SCENARIO,
} from "@/modules/mandala/core/defaults";
import { sanitizeKeyframe, sanitizeScenario } from "@/modules/mandala/core/preset";
import type {
  MandalaSessionState,
  MeditationPresetKeyframe,
  MeditationPresetScenario,
} from "@/modules/mandala/core/types";

function cloneSessionState(state: MandalaSessionState): MandalaSessionState {
  return {
    ...state,
    geometry: { ...state.geometry },
    primitives: { ...state.primitives },
    complexity: { ...state.complexity },
    imperfection: { ...state.imperfection },
    appearance: { ...state.appearance },
    modulation: { ...state.modulation },
    kinetics: { ...state.kinetics },
    bioWeights: { ...state.bioWeights },
    artDirection: { ...state.artDirection },
  };
}

export function useMandalaSession(
  initialScenario: MeditationPresetScenario = DEFAULT_SCENARIO,
) {
  const safeScenario = useMemo(() => sanitizeScenario(initialScenario), [initialScenario]);
  const [scenario, setScenario] = useState<MeditationPresetScenario>(safeScenario);
  const [sessionState, setSessionState] = useState<MandalaSessionState>(() =>
    createSessionStateFromKeyframe(safeScenario),
  );

  const geometry = useSharedValue(sessionState.geometry);
  const primitives = useSharedValue(sessionState.primitives);
  const complexity = useSharedValue(sessionState.complexity);
  const imperfection = useSharedValue(sessionState.imperfection);
  const appearance = useSharedValue(sessionState.appearance);
  const modulation = useSharedValue(sessionState.modulation);
  const kinetics = useSharedValue(sessionState.kinetics);
  const bioWeights = useSharedValue(sessionState.bioWeights);
  const artDirection = useSharedValue(sessionState.artDirection);

  const syncSharedValues = useCallback((next: MandalaSessionState) => {
    geometry.value = next.geometry;
    primitives.value = next.primitives;
    complexity.value = next.complexity;
    imperfection.value = next.imperfection;
    appearance.value = next.appearance;
    modulation.value = next.modulation;
    kinetics.value = next.kinetics;
    bioWeights.value = next.bioWeights;
    artDirection.value = next.artDirection;
  }, []);

  const applyKeyframe = useCallback(
    (keyframe: MeditationPresetKeyframe) => {
      const safeKeyframe = sanitizeKeyframe(keyframe);
      const next: MandalaSessionState = {
        scenarioId: scenario.id,
        activeKeyframeId: safeKeyframe.id,
        geometry: { ...safeKeyframe.geometry },
        primitives: { ...safeKeyframe.primitives },
        complexity: { ...safeKeyframe.complexity },
        imperfection: { ...safeKeyframe.imperfection },
        appearance: { ...safeKeyframe.appearance },
        modulation: { ...safeKeyframe.modulation },
        kinetics: { ...safeKeyframe.kinetics },
        bioWeights: { ...safeKeyframe.bioWeights },
        artDirection: { ...safeKeyframe.artDirection },
      };
      syncSharedValues(next);
      setSessionState(next);
    },
    [scenario.id, syncSharedValues],
  );

  const replaceScenario = useCallback(
    (nextScenario: MeditationPresetScenario) => {
      const safe = sanitizeScenario(nextScenario);
      setScenario(safe);
      const first = safe.keyframes[0] ?? DEFAULT_KEYFRAME;
      const next = createSessionStateFromKeyframe(safe, first);
      syncSharedValues(next);
      setSessionState(next);
    },
    [syncSharedValues],
  );

  const patchSession = useCallback(
    (patch: Partial<MandalaSessionState>) => {
      setSessionState((current) => {
        const next = cloneSessionState({
          ...current,
          ...patch,
          geometry: patch.geometry ? { ...patch.geometry } : current.geometry,
          primitives: patch.primitives ? { ...patch.primitives } : current.primitives,
          complexity: patch.complexity ? { ...patch.complexity } : current.complexity,
          imperfection: patch.imperfection
            ? { ...patch.imperfection }
            : current.imperfection,
          appearance: patch.appearance ? { ...patch.appearance } : current.appearance,
          modulation: patch.modulation ? { ...patch.modulation } : current.modulation,
          kinetics: patch.kinetics ? { ...patch.kinetics } : current.kinetics,
          bioWeights: patch.bioWeights ? { ...patch.bioWeights } : current.bioWeights,
          artDirection: patch.artDirection ? { ...patch.artDirection } : current.artDirection,
        });
        syncSharedValues(next);
        return next;
      });
    },
    [syncSharedValues],
  );

  return {
    scenario,
    sessionState,
    sharedValues: {
      geometry,
      primitives,
      complexity,
      imperfection,
      appearance,
      modulation,
      kinetics,
      bioWeights,
      artDirection,
    },
    applyKeyframe,
    patchSession,
    replaceScenario,
  };
}
