export { Communicator } from "./ui/Communicator";
export type { CommunicatorProps } from "./ui/Communicator";

export type {
  CommunicatorHistoryMessage,
  CommunicatorInitialMode,
  CommunicatorModePolicy,
  CommunicatorSessionState,
  EmotionSegmentPayload,
} from "./core/types";

export { runCommunicatorStream } from "./ui/communicator-stream";
export type { CommunicatorStreamChunk } from "./ui/communicator-stream";
export { useCommunicatorStream } from "./ui/useCommunicatorStream";
export type { CommunicatorStreamStatus } from "./ui/useCommunicatorStream";
