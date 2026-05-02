import { Audio } from "expo-av";

/**
 * 16 kHz mono AAC — ориентир для Whisper и Hume EVI (latency); см. docs/hume_integration.md.
 * Стабильность `prepareToRecord` на iOS — в Communicator (DuckOthers, пауза после setAudioModeAsync, ретраи).
 */
export const WHISPER_OPTIMIZED_PRESET: Audio.RecordingOptions = {
  android: {
    extension: ".m4a",
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 64000,
  },
  ios: {
    extension: ".m4a",
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.MEDIUM,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 64000,
  },
  web: {
    mimeType: "audio/webm",
    bitsPerSecond: 64000,
  },
};

export function whisperRecordingOptions(options?: { isMeteringEnabled?: boolean }): Audio.RecordingOptions {
  return {
    ...WHISPER_OPTIMIZED_PRESET,
    isMeteringEnabled: options?.isMeteringEnabled,
  };
}
