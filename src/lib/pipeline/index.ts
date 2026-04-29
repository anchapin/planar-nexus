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
