import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import type {
  ExtractOptions,
  ExtractedFrame,
  FrameMetadata,
  FfprobeStreamInfo,
  SceneChangeEvent,
} from "./types";
import { buildMetadata, mergeWithSceneChanges } from "./transcript-aligner";

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { maxBuffer: 50 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(`${cmd} failed: ${stderr || err.message}`));
        else resolve(stdout);
      },
    );
  });
}

export async function probeVideo(
  videoPath: string,
): Promise<FfprobeStreamInfo> {
  const raw = await run("ffprobe", [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_streams",
    "-select_streams",
    "v:0",
    videoPath,
  ]);

  const data = JSON.parse(raw);
  const stream = data.streams?.[0];
  if (!stream) throw new Error("No video stream found");

  const durationSec = parseFloat(stream.duration ?? "0");
  const fpsStr = stream.r_frame_rate ?? "30/1";
  const [num, den] = fpsStr.split("/").map(Number);

  return {
    width: stream.width ?? 0,
    height: stream.height ?? 0,
    duration_ms: Math.round(durationSec * 1000),
    fps: den > 0 ? num / den : 30,
    codec_name: stream.codec_name ?? "unknown",
  };
}

export async function detectSceneChanges(
  videoPath: string,
  threshold: number = 0.3,
): Promise<SceneChangeEvent[]> {
  const raw = await run("ffmpeg", [
    "-i",
    videoPath,
    "-filter:v",
    `select='gt(scene,${threshold})',showinfo`,
    "-f",
    "null",
    "-",
  ]);

  const events: SceneChangeEvent[] = [];
  const re = /pts_time:(\d+\.?\d*)/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(raw)) !== null) {
    events.push({
      timestamp_ms: Math.round(parseFloat(match[1]) * 1000),
      score: 0,
    });
  }

  return events;
}

export async function extractFramesAtTimestamps(
  videoPath: string,
  outputDir: string,
  timestampsMs: number[],
  format: "jpeg" | "png" = "jpeg",
  onProgress?: (current: number, total: number) => void,
): Promise<string[]> {
  if (timestampsMs.length === 0) return [];

  await fs.mkdir(outputDir, { recursive: true });

  const ext = format === "jpeg" ? "jpg" : "png";
  const outputPath = path.join(outputDir, `frame-%04d.${ext}`);
  const filterParts = timestampsMs.map((ms, i) => {
    const sec = ms / 1000;
    return `[0:v]select=eq(n\\,0)*lt(abs(t-${sec}),0.04)[s${i}]`;
  });

  const args = ["-nostdin", "-i", videoPath];

  for (let i = 0; i < timestampsMs.length; i++) {
    args.push("-filter_complex", filterParts.slice(0, i + 1).join(";"));
    args.push("-map", `[s${i}]`);
    args.push("-frames:v", "1");
    args.push("-q:v", "2");
    args.push(outputPath.replace("%04d", String(i + 1).padStart(4, "0")));
  }

  if (timestampsMs.length <= 1) {
    if (timestampsMs.length === 1) {
      const sec = timestampsMs[0] / 1000;
      const filePath = path.join(outputDir, `frame-0001.${ext}`);
      await run("ffmpeg", [
        "-nostdin",
        "-ss",
        String(sec),
        "-i",
        videoPath,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        filePath,
      ]);
    }
  } else {
    for (let i = 0; i < timestampsMs.length; i++) {
      const sec = timestampsMs[i] / 1000;
      const filePath = path.join(
        outputDir,
        `frame-${String(i + 1).padStart(4, "0")}.${ext}`,
      );
      await run("ffmpeg", [
        "-nostdin",
        "-ss",
        String(sec),
        "-i",
        videoPath,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        filePath,
      ]);
      onProgress?.(i + 1, timestampsMs.length);
    }
  }

  const files = await fs.readdir(outputDir);
  return files
    .filter((f) => f.endsWith(`.${ext}`))
    .sort()
    .map((f) => path.join(outputDir, f));
}

export async function extractKeyFrames(
  options: ExtractOptions,
): Promise<ExtractedFrame[]> {
  const {
    video_path,
    video_id,
    output_dir,
    fps,
    scene_threshold,
    transcript_segments,
    format,
    on_progress,
  } = options;

  on_progress?.({
    phase: "extracting",
    current: 0,
    total: 0,
    message: "Probing video…",
  });

  const probe = await probeVideo(video_path);
  const durationMs = probe.duration_ms;

  const intervalMs = Math.round(1000 / fps);
  const intervalTimestamps: number[] = [];
  for (let t = 0; t < durationMs; t += intervalMs) {
    intervalTimestamps.push(t);
  }

  on_progress?.({
    phase: "detecting",
    current: 0,
    total: 0,
    message: "Detecting scene changes…",
  });

  let sceneChangeTimestamps: number[] = [];
  try {
    const sceneEvents = await detectSceneChanges(video_path, scene_threshold);
    sceneChangeTimestamps = sceneEvents.map((e) => e.timestamp_ms);
  } catch (err) {
    console.warn("Scene detection failed, using interval-only mode:", err);
  }

  const mergedTimestamps = mergeWithSceneChanges(
    intervalTimestamps,
    sceneChangeTimestamps,
  );

  on_progress?.({
    phase: "tagging",
    current: 0,
    total: mergedTimestamps.length,
    message: `Extracting ${mergedTimestamps.length} frames…`,
  });

  const framePaths = await extractFramesAtTimestamps(
    video_path,
    output_dir,
    mergedTimestamps,
    format,
    (current, total) =>
      on_progress?.({
        phase: "tagging",
        current,
        total,
        message: `Extracting frame ${current}/${total}…`,
      }),
  );

  const frames: ExtractedFrame[] = framePaths.map((fp, i) => {
    const timestampMs = mergedTimestamps[i] ?? 0;
    const sceneChange = sceneChangeTimestamps.find(
      (sc) => Math.abs(sc - timestampMs) < 500,
    );
    const sceneScore = sceneChange !== undefined ? 1.0 : 0.0;
    const metadata: FrameMetadata = buildMetadata(
      video_id,
      timestampMs,
      transcript_segments,
      sceneScore,
      i,
    );

    const sidecarPath = fp.replace(/\.(jpg|jpeg|png)$/i, ".json");
    const sidecarData = {
      frame: fp,
      metadata,
      extracted_at: new Date().toISOString(),
      video_info: probe,
    };

    fs.writeFile(sidecarPath, JSON.stringify(sidecarData, null, 2)).catch(
      (err) => console.warn(`Failed to write sidecar ${sidecarPath}:`, err),
    );

    return { frame_path: fp, metadata };
  });

  on_progress?.({
    phase: "complete",
    current: frames.length,
    total: frames.length,
    message: "Done",
  });

  return frames;
}
