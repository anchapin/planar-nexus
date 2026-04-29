import type { ExecFileException } from "child_process";
import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import {
  extractKeyFrames,
  probeVideo,
  detectSceneChanges,
  extractFramesAtTimestamps,
} from "@/lib/pipeline/ffmpeg-frame-extractor";

const fakeProcess = { on: jest.fn(), kill: jest.fn() } as unknown as ReturnType<
  typeof execFile
>;

jest.mock("child_process", () => ({
  execFile: jest.fn(),
}));

jest.mock("fs", () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    readdir: jest
      .fn()
      .mockResolvedValue([
        "frame-0001.jpg",
        "frame-0002.jpg",
        "frame-0003.jpg",
      ]),
    writeFile: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockedExecFile = execFile as unknown as jest.MockedFunction<
  typeof execFile
>;

type ExecCallback = (
  error: ExecFileException | null,
  stdout: string,
  stderr: string,
) => void;

function mockExecSuccess(stdout: string) {
  mockedExecFile.mockImplementation(
    (
      _cmd: string,
      _args: readonly string[] | null | undefined,
      _opts: any,
      _cb: any,
    ) => {
      const cb = typeof _opts === "function" ? _opts : _cb;
      cb?.(null, stdout, "");
      return fakeProcess;
    },
  );
}

describe("probeVideo", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("parses ffprobe json output", async () => {
    mockExecSuccess(
      JSON.stringify({
        streams: [
          {
            width: 1920,
            height: 1080,
            duration: "120.5",
            r_frame_rate: "30/1",
            codec_name: "h264",
          },
        ],
      }),
    );

    const result = await probeVideo("/tmp/video.mp4");
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    expect(result.duration_ms).toBe(120500);
    expect(result.fps).toBe(30);
    expect(result.codec_name).toBe("h264");
  });

  it("throws when no video stream found", async () => {
    mockExecSuccess(JSON.stringify({ streams: [] }));

    await expect(probeVideo("/tmp/bad.mp4")).rejects.toThrow(
      "No video stream found",
    );
  });

  it("handles fractional fps", async () => {
    mockExecSuccess(
      JSON.stringify({
        streams: [
          {
            width: 1280,
            height: 720,
            duration: "60",
            r_frame_rate: "24000/1001",
            codec_name: "h265",
          },
        ],
      }),
    );

    const result = await probeVideo("/tmp/video.mp4");
    expect(result.fps).toBeCloseTo(23.976, 2);
  });
});

describe("detectSceneChanges", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("parses scene change events from ffmpeg stderr", async () => {
    mockExecSuccess("pts_time:1.500\npts_time:3.200\npts_time:7.800");

    const events = await detectSceneChanges("/tmp/video.mp4", 0.3);
    expect(events).toHaveLength(3);
    expect(events[0].timestamp_ms).toBe(1500);
    expect(events[1].timestamp_ms).toBe(3200);
    expect(events[2].timestamp_ms).toBe(7800);
  });

  it("returns empty array when no scene changes", async () => {
    mockExecSuccess("");

    const events = await detectSceneChanges("/tmp/video.mp4", 0.5);
    expect(events).toHaveLength(0);
  });
});

describe("extractFramesAtTimestamps", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecSuccess("");
  });

  it("extracts frames for each timestamp", async () => {
    const outputDir = "/tmp/frames";
    const timestamps = [1000, 2000, 3000];

    const result = await extractFramesAtTimestamps(
      "/tmp/video.mp4",
      outputDir,
      timestamps,
      "jpeg",
    );

    expect(fs.mkdir).toHaveBeenCalledWith(outputDir, { recursive: true });
    expect(result).toHaveLength(3);
    expect(result[0]).toContain("frame-0001.jpg");
  });

  it("returns empty for empty timestamps", async () => {
    const result = await extractFramesAtTimestamps(
      "/tmp/video.mp4",
      "/tmp/frames",
      [],
      "png",
    );

    expect(result).toHaveLength(0);
    expect(mockedExecFile).not.toHaveBeenCalled();
  });
});

describe("extractKeyFrames", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("extracts key frames with scene changes and transcript", async () => {
    const probeOutput = JSON.stringify({
      streams: [
        {
          width: 1920,
          height: 1080,
          duration: "10",
          r_frame_rate: "30/1",
          codec_name: "h264",
        },
      ],
    });

    let callCount = 0;
    mockedExecFile.mockImplementation(
      (
        _cmd: string,
        _args: readonly string[] | null | undefined,
        _opts: any,
        _cb: any,
      ) => {
        const cb = typeof _opts === "function" ? _opts : _cb;
        callCount++;
        if (callCount === 1) {
          cb?.(null, probeOutput, "");
        } else if (callCount === 2) {
          cb?.(null, "pts_time:2.500\npts_time:5.500", "");
        } else {
          cb?.(null, "", "");
        }
        return fakeProcess;
      },
    );

    const progressCalls: Array<{
      phase: string;
      current: number;
      total: number;
    }> = [];

    const result = await extractKeyFrames({
      video_path: "/tmp/video.mp4",
      video_id: "vid-test-001",
      output_dir: "/tmp/frames",
      fps: 1,
      scene_threshold: 0.3,
      transcript_segments: [
        { start_ms: 0, end_ms: 3000, text: "Main phase", confidence: 0.95 },
      ],
      format: "jpeg",
      on_progress: (p) => progressCalls.push(p),
    });

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].metadata.video_id).toBe("vid-test-001");
    expect(result[0].metadata.timestamp_ms).toBeGreaterThanOrEqual(0);
    expect(progressCalls.length).toBeGreaterThan(0);

    const lastProgress = progressCalls[progressCalls.length - 1];
    expect(lastProgress.phase).toBe("complete");

    const sidecarWritten = (fs.writeFile as jest.Mock).mock.calls.length;
    expect(sidecarWritten).toBeGreaterThan(0);

    const sidecarData = JSON.parse(
      (fs.writeFile as jest.Mock).mock.calls[0][1] as string,
    );
    expect(sidecarData.metadata.video_id).toBe("vid-test-001");
    expect(sidecarData.metadata.transcript_window).toBeDefined();
    expect(sidecarData.video_info).toBeDefined();
  });

  it("handles scene detection failure gracefully", async () => {
    const probeOutput = JSON.stringify({
      streams: [
        {
          width: 1920,
          height: 1080,
          duration: "5",
          r_frame_rate: "30/1",
          codec_name: "h264",
        },
      ],
    });

    let callCount = 0;
    mockedExecFile.mockImplementation(
      (
        _cmd: string,
        _args: readonly string[] | null | undefined,
        _opts: any,
        _cb: any,
      ) => {
        const cb = typeof _opts === "function" ? _opts : _cb;
        callCount++;
        if (callCount === 1) {
          cb?.(null, probeOutput, "");
        } else if (callCount === 2) {
          cb?.(
            new Error("scene detection failed") as ExecFileException,
            "",
            "error",
          );
        } else {
          cb?.(null, "", "");
        }
        return fakeProcess;
      },
    );

    const result = await extractKeyFrames({
      video_path: "/tmp/video.mp4",
      video_id: "vid-fallback",
      output_dir: "/tmp/frames",
      fps: 1,
      scene_threshold: 0.3,
      transcript_segments: [],
      format: "jpeg",
    });

    expect(result.length).toBeGreaterThan(0);
  });
});
