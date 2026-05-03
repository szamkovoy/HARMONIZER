import { memo } from "react";
import { StyleSheet, View } from "react-native";

import {
  DEFAULT_BINDU_SUCCESSION_VISUAL_PRESETS,
  type ChakraVisualPreset,
} from "@/modules/mandala/experiments/binduSuccessionVisualPresets";
import { BinduSuccessionLabCanvas } from "@/modules/mandala/experiments/BinduSuccessionLabCanvas";
import type { MandalaSoundVisualSync } from "@/modules/mandala-sound";

const CHAKRA3_PRESET = DEFAULT_BINDU_SUCCESSION_VISUAL_PRESETS[2]!;
const TUBE_FLOW_SPEED = 1;

type Props = {
  isActive: boolean;
  /** Индекс чакры 0..6; по умолчанию 2 = третья чакра. */
  chakraPresetIndex?: number;
  /**
   * Диагностика: вызывается на каждом коммите внутреннего Canvas.
   * Используется CoherenceBreathScreen для counter-based телеметрии
   * ре-рендеров мандалы. Пробрасывается во внутренний
   * `BinduSuccessionLabCanvas` без изменений.
   */
  onRenderCommitted?: () => void;
  /**
   * Целевая частота анимации мандалы (Гц). По умолчанию 15 (берётся из
   * `BinduSuccessionLabCanvas`). Родительский экран может опускать эту
   * частоту во время тяжёлых фаз (например, `realStart`/`realEnd`, когда
   * активно ppg-чтение) и поднимать в «свободной» середине — или
   * наоборот. Меняется на лету без пересоздания анимационного цикла.
   */
  targetFps?: number;
  /** Синхронизация облака с аудио-ритмом Mandala Sound. */
  externalSync?: MandalaSoundVisualSync;
};

/**
 * Мандала по пайплайну Bindu succession (тот же рендер, что в лаборатории).
 */
function BreathBinduMandalaInner({
  isActive,
  chakraPresetIndex = 2,
  onRenderCommitted,
  targetFps,
  externalSync,
}: Props) {
  const visualPreset: ChakraVisualPreset =
    DEFAULT_BINDU_SUCCESSION_VISUAL_PRESETS[chakraPresetIndex] ?? CHAKRA3_PRESET;

  return (
    <View style={styles.wrap}>
      <BinduSuccessionLabCanvas
        isActive={isActive}
        sceneOffset={0}
        densityBias={0.84}
        sessionSeed={1}
        flowSpeed={TUBE_FLOW_SPEED}
        debugGeometry={false}
        visualPreset={visualPreset}
        showMandala
        onRenderCommitted={onRenderCommitted}
        targetFps={targetFps}
        externalSync={externalSync}
      />
    </View>
  );
}

export const BreathBinduMandala = memo(BreathBinduMandalaInner);

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
  },
});
