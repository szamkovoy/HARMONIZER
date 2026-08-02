import type { NatureSoundBedId } from "@/modules/mandala-sound/core/soundBed";

/** Seamless AAC loops (4s baked crossfade) — see `scripts/build-ambient-loops.mjs`. */
export const AMBIENT_SOUND_ASSETS: Record<NatureSoundBedId, number> = {
  creek: require("../../../assets/audio/ambient/creek.m4a"),
  waves: require("../../../assets/audio/ambient/waves.m4a"),
  rain: require("../../../assets/audio/ambient/rain.m4a"),
  forest_birds: require("../../../assets/audio/ambient/forest_birds.m4a"),
  wind: require("../../../assets/audio/ambient/wind.m4a"),
  fireplace: require("../../../assets/audio/ambient/fireplace.m4a"),
  water_splash: require("../../../assets/audio/ambient/water_splash.m4a"),
  cat_purr: require("../../../assets/audio/ambient/cat_purr.m4a"),
};
