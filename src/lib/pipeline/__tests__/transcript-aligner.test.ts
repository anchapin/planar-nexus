import {
  alignTranscript,
  buildMetadata,
  mergeWithSceneChanges,
} from "@/lib/pipeline/transcript-aligner";
import type { TranscriptSegment } from "@/lib/pipeline/types";

const makeSegment = (
  start: number,
  end: number,
  text: string,
): TranscriptSegment => ({
  start_ms: start,
  end_ms: end,
  text,
  confidence: 0.9,
});

describe("alignTranscript", () => {
  const segments: TranscriptSegment[] = [
    makeSegment(0, 3000, "Welcome to the game"),
    makeSegment(3000, 6000, "I cast Lightning Bolt"),
    makeSegment(6000, 9000, "It resolves"),
    makeSegment(10000, 13000, "Your turn"),
  ];

  it("returns overlapping segments within default window", () => {
    const result = alignTranscript(5000, segments);
    expect(result).toHaveLength(3);
    expect(result[0].text).toBe("Welcome to the game");
    expect(result[1].text).toBe("I cast Lightning Bolt");
    expect(result[2].text).toBe("It resolves");
  });

  it("returns empty for no overlapping segments", () => {
    const result = alignTranscript(20000, segments);
    expect(result).toHaveLength(0);
  });

  it("respects custom window radius", () => {
    const result = alignTranscript(5000, segments, 500);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("I cast Lightning Bolt");
  });

  it("returns empty for empty segments", () => {
    const result = alignTranscript(5000, []);
    expect(result).toHaveLength(0);
  });

  it("includes segments at exact boundary", () => {
    const result = alignTranscript(3000, segments, 2000);
    expect(result).toHaveLength(2);
  });
});

describe("buildMetadata", () => {
  const segments = [makeSegment(4000, 6000, "Attack with Tarmogoyf")];

  it("builds metadata with aligned transcript", () => {
    const meta = buildMetadata("vid-001", 5000, segments, 0.9, 2);
    expect(meta.video_id).toBe("vid-001");
    expect(meta.timestamp_ms).toBe(5000);
    expect(meta.transcript_window).toHaveLength(1);
    expect(meta.transcript_window[0].text).toBe("Attack with Tarmogoyf");
    expect(meta.scene_score).toBe(0.9);
    expect(meta.frame_index).toBe(2);
  });

  it("builds metadata with empty transcript", () => {
    const meta = buildMetadata("vid-002", 1000, [], 0.0, 0);
    expect(meta.transcript_window).toHaveLength(0);
  });
});

describe("mergeWithSceneChanges", () => {
  it("merges scene changes with interval timestamps", () => {
    const intervals = [0, 1000, 2000, 3000, 4000, 5000];
    const sceneChanges = [1500, 3500];
    const result = mergeWithSceneChanges(intervals, sceneChanges, 500);
    expect(result).toEqual([0, 1000, 1500, 2000, 3000, 3500, 4000, 5000]);
  });

  it("deduplicates scene changes near existing intervals", () => {
    const intervals = [0, 1000, 2000, 3000];
    const sceneChanges = [2050];
    const result = mergeWithSceneChanges(intervals, sceneChanges, 500);
    expect(result).toEqual([0, 1000, 2000, 3000]);
  });

  it("returns intervals when no scene changes", () => {
    const intervals = [0, 1000, 2000];
    const result = mergeWithSceneChanges(intervals, []);
    expect(result).toEqual([0, 1000, 2000]);
  });

  it("returns scene changes when no intervals", () => {
    const sceneChanges = [500, 1500];
    const result = mergeWithSceneChanges([], sceneChanges);
    expect(result).toEqual([500, 1500]);
  });

  it("returns empty for both empty", () => {
    const result = mergeWithSceneChanges([], []);
    expect(result).toEqual([]);
  });

  it("deduplicates scene changes within custom minGapMs", () => {
    const intervals = [0, 1000, 2000];
    const sceneChanges = [2100];
    const result = mergeWithSceneChanges(intervals, sceneChanges, 200);
    expect(result).toEqual([0, 1000, 2000]);
  });
});
