export interface FrameMetadata {
  video_id: string;
  timestamp_ms: number;
  transcript_window: TranscriptSegment[];
  scene_score: number;
  frame_index: number;
}

export interface TranscriptSegment {
  start_ms: number;
  end_ms: number;
  text: string;
  confidence: number;
}

export interface ExtractedFrame {
  frame_path: string;
  metadata: FrameMetadata;
}

export interface ExtractOptions {
  video_path: string;
  video_id: string;
  output_dir: string;
  fps: number;
  scene_threshold: number;
  transcript_segments: TranscriptSegment[];
  format: "jpeg" | "png";
  on_progress?: (progress: ExtractProgress) => void;
}

export interface ExtractProgress {
  phase: "extracting" | "detecting" | "tagging" | "complete";
  current: number;
  total: number;
  message: string;
}

export interface SceneChangeEvent {
  timestamp_ms: number;
  score: number;
}

export interface FfprobeStreamInfo {
  width: number;
  height: number;
  duration_ms: number;
  fps: number;
  codec_name: string;
}
