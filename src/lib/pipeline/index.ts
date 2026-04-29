export {
  extractKeyFrames,
  probeVideo,
  detectSceneChanges,
  extractFramesAtTimestamps,
} from "./ffmpeg-frame-extractor";
export {
  alignTranscript,
  buildMetadata,
  mergeWithSceneChanges,
} from "./transcript-aligner";
export { analyzeFrame, analyzeFramesBatch } from "./board-state-vision";
export { validateCardNames } from "./card-name-validator";
export {
  BOARD_STATE_SYSTEM_PROMPT,
  BOARD_STATE_VALIDATION_PROMPT,
} from "./board-state-prompt";
export type {
  FrameMetadata,
  TranscriptSegment,
  ExtractedFrame,
  ExtractOptions,
  ExtractProgress,
  SceneChangeEvent,
  FfprobeStreamInfo,
} from "./types";

export type {
  SentimentMatch,
  SentimentCategory,
  CardReference,
  ExpectedVsActual,
  CandidateMismatch,
  CrossReferenceResult,
  TriageItem,
  SentimentScanConfig,
  ChannelSource,
  ScanReport,
  TranscriptInput,
  SentimentTranscriptSegment,
} from "./sentiment-types";

export {
  getDefaultConfig,
  DEFAULT_CHANNELS,
  scanTranscriptForSentiment,
  extractCardReferences,
  extractExpectedVsActual,
  buildCandidates,
  crossReferenceWithEngine,
  buildTriageList,
} from "./sentiment-analyzer";

export type {
  RecognizedBoardState,
  BoardCard,
  VisionProcessingOptions,
  VisionProcessingResult,
  BatchProcessingResult,
} from "./board-state-vision-types";
