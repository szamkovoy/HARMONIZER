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
  binaural: [
    { beatHz: 12, asset: require("../../../assets/audio/mandala-sound/binaural/beat-12.wav") },
    { beatHz: 11, asset: require("../../../assets/audio/mandala-sound/binaural/beat-11.wav") },
    { beatHz: 10, asset: require("../../../assets/audio/mandala-sound/binaural/beat-10.wav") },
    { beatHz: 9, asset: require("../../../assets/audio/mandala-sound/binaural/beat-9.wav") },
    { beatHz: 8, asset: require("../../../assets/audio/mandala-sound/binaural/beat-8.wav") },
    { beatHz: 7, asset: require("../../../assets/audio/mandala-sound/binaural/beat-7.wav") },
    { beatHz: 6, asset: require("../../../assets/audio/mandala-sound/binaural/beat-6.wav") },
    { beatHz: 5, asset: require("../../../assets/audio/mandala-sound/binaural/beat-5.wav") },
    { beatHz: 4, asset: require("../../../assets/audio/mandala-sound/binaural/beat-4.wav") },
    { beatHz: 3, asset: require("../../../assets/audio/mandala-sound/binaural/beat-3.wav") },
    { beatHz: 2.5, asset: require("../../../assets/audio/mandala-sound/binaural/beat-2p5.wav") },
    { beatHz: 2, asset: require("../../../assets/audio/mandala-sound/binaural/beat-2.wav") },
  ],
  gongs: {
    alpha: require("../../../assets/audio/mandala-sound/gongs/alpha.wav"),
    theta: require("../../../assets/audio/mandala-sound/gongs/theta.wav"),
    delta: require("../../../assets/audio/mandala-sound/gongs/delta.wav"),
  },
};
