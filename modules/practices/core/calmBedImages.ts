import type { SoundBedId } from "@/modules/mandala-sound/core/soundBed";

/** Explicit soundBed → still image for Calm practice (not computed at runtime). */
export const CALM_BED_IMAGES: Record<SoundBedId, number> = {
  "neuro-sync": require("../../../assets/icons/calm/neuro-sync.jpg"),
  creek: require("../../../assets/icons/calm/creek.jpg"),
  waves: require("../../../assets/icons/calm/waves.jpg"),
  rain: require("../../../assets/icons/calm/rain.jpg"),
  forest_birds: require("../../../assets/icons/calm/forest_birds.jpg"),
  wind: require("../../../assets/icons/calm/wind.jpg"),
  fireplace: require("../../../assets/icons/calm/fireplace.jpg"),
  water_splash: require("../../../assets/icons/calm/water_splash.jpg"),
  cat_purr: require("../../../assets/icons/calm/cat_purr.jpg"),
};
