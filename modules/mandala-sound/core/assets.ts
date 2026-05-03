import type { MandalaSoundAssetPreset } from "@/modules/mandala-sound/core/types";

export const MANDALA_SOUND_ASSETS: MandalaSoundAssetPreset = {
  drones: [
    require("../../../assets/audio/mandala-sound/drones/chakra-1.wav"),
    require("../../../assets/audio/mandala-sound/drones/chakra-2.wav"),
    require("../../../assets/audio/mandala-sound/drones/chakra-3.wav"),
    require("../../../assets/audio/mandala-sound/drones/chakra-4.wav"),
    require("../../../assets/audio/mandala-sound/drones/chakra-5.wav"),
    require("../../../assets/audio/mandala-sound/drones/chakra-6.wav"),
    require("../../../assets/audio/mandala-sound/drones/chakra-7.wav"),
  ],
  textures: [
    require("../../../assets/audio/mandala-sound/textures/texture-1.wav"),
    require("../../../assets/audio/mandala-sound/textures/texture-2.wav"),
    require("../../../assets/audio/mandala-sound/textures/texture-3.wav"),
  ],
  gongs: {
    alpha: require("../../../assets/audio/mandala-sound/gongs/alpha.wav"),
    theta: require("../../../assets/audio/mandala-sound/gongs/theta.wav"),
    delta: require("../../../assets/audio/mandala-sound/gongs/delta.wav"),
  },
  events: [
    require("../../../assets/audio/mandala-sound/events/event-1.wav"),
    require("../../../assets/audio/mandala-sound/events/event-2.wav"),
    require("../../../assets/audio/mandala-sound/events/event-3.wav"),
  ],
};
