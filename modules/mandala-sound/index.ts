/**
 * Public barrel for practice screens that mount sound.
 * Tab UI (PracticeCard) must import IDs from `core/soundBed` only —
 * this barrel pulls expo-av engines + ~24MB ambient/mandala audio assets.
 */
export {
  isNatureSoundBedId,
  isSoundBedId,
  NATURE_SOUND_BED_IDS,
  parseSoundBedId,
  SOUND_BED_IDS,
  SOUND_BED_NEURO_SYNC,
  type NatureSoundBedId,
  type SoundBedId,
} from "@/modules/mandala-sound/core/soundBed";
export {
  buildMandalaSoundFrame,
  computeBreathSync,
  computePulseSync,
  detectGongCrossing,
  SCHUMANN_RESONANCE_HZ,
} from "@/modules/mandala-sound/core/sync";
export {
  getMandalaSoundBand,
  getMandalaSoundEndHz,
  getMandalaSoundTargetHz,
  MANDALA_SOUND_MAX_TARGET_HZ,
  MANDALA_SOUND_MIN_TARGET_HZ,
  MANDALA_SOUND_START_HZ,
} from "@/modules/mandala-sound/core/timeline";
export type {
  MandalaSoundAssetPreset,
  MandalaSoundBand,
  MandalaSoundBreathSync,
  MandalaSoundEngineControls,
  MandalaSoundPracticeKind,
  MandalaSoundPulseSync,
  MandalaSoundSessionInput,
  MandalaSoundSyncFrame,
  MandalaSoundVisualSync,
} from "@/modules/mandala-sound/core/types";
export {
  MandalaSoundProvider,
  useMandalaSoundFrame,
  useMandalaSoundSync,
} from "@/modules/mandala-sound/ui/MandalaSoundProvider";
