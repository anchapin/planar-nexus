import type { FrameMetadata, TranscriptSegment } from "./types";

const DEFAULT_WINDOW_RADIUS_MS = 2_000;

export function alignTranscript(
  timestamp_ms: number,
  segments: TranscriptSegment[],
  windowRadiusMs: number = DEFAULT_WINDOW_RADIUS_MS,
): TranscriptSegment[] {
  if (segments.length === 0) return [];

  const windowStart = timestamp_ms - windowRadiusMs;
  const windowEnd = timestamp_ms + windowRadiusMs;

  return segments.filter((seg) => {
    if (seg.end_ms < windowStart) return false;
    if (seg.start_ms > windowEnd) return false;
    return true;
  });
}

export function buildMetadata(
  video_id: string,
  timestamp_ms: number,
  segments: TranscriptSegment[],
  scene_score: number,
  frame_index: number,
): FrameMetadata {
  return {
    video_id,
    timestamp_ms,
    transcript_window: alignTranscript(timestamp_ms, segments),
    scene_score,
    frame_index,
  };
}

export function mergeWithSceneChanges(
  intervalTimestampsMs: number[],
  sceneChangesMs: number[],
  minGapMs: number = 500,
): number[] {
  if (sceneChangesMs.length === 0) return intervalTimestampsMs;

  const merged = new Set(intervalTimestampsMs);

  for (const changeMs of sceneChangesMs) {
    let nearExisting = false;
    for (const existing of merged) {
      if (Math.abs(existing - changeMs) < minGapMs) {
        nearExisting = true;
        break;
      }
    }
    if (!nearExisting) {
      merged.add(changeMs);
    }
  }

  return Array.from(merged).sort((a, b) => a - b);
}
