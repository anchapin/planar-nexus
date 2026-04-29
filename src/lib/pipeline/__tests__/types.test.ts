import type {
  FrameMetadata,
  TranscriptSegment,
  ExtractedFrame,
  ExtractOptions,
  ExtractProgress,
  SceneChangeEvent,
  FfprobeStreamInfo,
} from "@/lib/pipeline/types";

describe("FrameMetadata", () => {
  it("accepts a valid FrameMetadata object", () => {
    const meta: FrameMetadata = {
      video_id: "vid-001",
      timestamp_ms: 5000,
      transcript_window: [],
      scene_score: 0.8,
      frame_index: 3,
    };
    expect(meta.video_id).toBe("vid-001");
    expect(meta.timestamp_ms).toBe(5000);
    expect(meta.transcript_window).toEqual([]);
    expect(meta.scene_score).toBe(0.8);
    expect(meta.frame_index).toBe(3);
  });

  it("accepts transcript_window entries", () => {
    const segment: TranscriptSegment = {
      start_ms: 4000,
      end_ms: 6000,
      text: "I cast Lightning Bolt",
      confidence: 0.95,
    };
    const meta: FrameMetadata = {
      video_id: "vid-001",
      timestamp_ms: 5000,
      transcript_window: [segment],
      scene_score: 1.0,
      frame_index: 0,
    };
    expect(meta.transcript_window).toHaveLength(1);
    expect(meta.transcript_window[0].text).toBe("I cast Lightning Bolt");
  });
});

describe("ExtractedFrame", () => {
  it("accepts a valid ExtractedFrame object", () => {
    const frame: ExtractedFrame = {
      frame_path: "/tmp/frames/frame-0001.jpg",
      metadata: {
        video_id: "vid-001",
        timestamp_ms: 1000,
        transcript_window: [],
        scene_score: 0.5,
        frame_index: 0,
      },
    };
    expect(frame.frame_path).toMatch(/frame-0001\.jpg$/);
    expect(frame.metadata.video_id).toBe("vid-001");
  });
});

describe("ExtractOptions", () => {
  it("accepts a valid ExtractOptions object", () => {
    const opts: ExtractOptions = {
      video_path: "/tmp/video.mp4",
      video_id: "vid-001",
      output_dir: "/tmp/frames",
      fps: 1,
      scene_threshold: 0.3,
      transcript_segments: [],
      format: "jpeg",
    };
    expect(opts.fps).toBe(1);
    expect(opts.format).toBe("jpeg");
  });

  it("accepts png format", () => {
    const opts: ExtractOptions = {
      video_path: "/tmp/video.mp4",
      video_id: "vid-001",
      output_dir: "/tmp/frames",
      fps: 2,
      scene_threshold: 0.4,
      transcript_segments: [],
      format: "png",
    };
    expect(opts.format).toBe("png");
  });
});

describe("SceneChangeEvent", () => {
  it("accepts a valid event", () => {
    const event: SceneChangeEvent = { timestamp_ms: 3200, score: 0.7 };
    expect(event.timestamp_ms).toBe(3200);
  });
});

describe("FfprobeStreamInfo", () => {
  it("accepts a valid stream info", () => {
    const info: FfprobeStreamInfo = {
      width: 1920,
      height: 1080,
      duration_ms: 60000,
      fps: 30,
      codec_name: "h264",
    };
    expect(info.width).toBe(1920);
    expect(info.duration_ms).toBe(60000);
  });
});
