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
