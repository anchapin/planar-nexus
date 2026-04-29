import type {
  DecisionRecord,
  DecisionMomentType,
  DecisionExtractionOptions,
  DecisionExtractionProgress,
  DecisionExtractionResult,
} from "./types";
import { DecisionRecordSchema } from "./types";
import {
  alignTranscriptToFrame,
  buildTranscriptText,
  detectDecisionMoments,
} from "./alignment";
import {
  DECISION_EXTRACTION_SYSTEM_PROMPT,
  buildDecisionExtractionUserPrompt,
} from "./prompt";

interface LLMResponse {
  action: string;
  reason: string;
  alternatives_considered: string[];
  outcome: string;
}

function report(
  options: DecisionExtractionOptions,
  progress: DecisionExtractionProgress,
): void {
  options.on_progress?.(progress);
}

export async function extractDecisions(
  options: DecisionExtractionOptions,
): Promise<DecisionExtractionResult> {
  const start_time = Date.now();
  const {
    video_id,
    transcript_segments,
    frame_timestamps,
    min_confidence = 0.5,
    window_radius_ms = 15000,
  } = options;

  const raw_records: DecisionRecord[] = [];
  let filtered_count = 0;

  report(options, {
    phase: "aligning",
    current: 0,
    total: frame_timestamps.length,
    message: "Aligning transcript segments to frame timestamps",
  });

  for (let i = 0; i < frame_timestamps.length; i++) {
    const frame_ts = frame_timestamps[i];

    const alignment = alignTranscriptToFrame(
      frame_ts,
      transcript_segments,
      window_radius_ms,
    );

    if (alignment.transcript_segments.length === 0) continue;

    const transcript_text = buildTranscriptText(alignment);
    const moment_types = detectDecisionMoments(transcript_text);

    if (moment_types.length === 0) continue;

    report(options, {
      phase: "detecting",
      current: i + 1,
      total: frame_timestamps.length,
      message: `Detected ${moment_types.length} moment type(s) at ${frame_ts}ms`,
    });

    report(options, {
      phase: "parsing",
      current: i + 1,
      total: frame_timestamps.length,
      message: `Parsing decisions with LLM for frame ${i + 1}/${frame_timestamps.length}`,
    });

    const parsed = await parseWithLLM(transcript_text, moment_types, options);

    for (const parse of parsed) {
      const record = buildRecord(parse, {
        video_id,
        timestamp_ms: frame_ts,
        moment_types,
        transcript_text,
      });

      const result = DecisionRecordSchema.safeParse(record);
      if (!result.success) {
        filtered_count++;
        continue;
      }

      if (record.confidence < min_confidence) {
        filtered_count++;
        continue;
      }

      raw_records.push(result.data);
    }
  }

  report(options, {
    phase: "filtering",
    current: raw_records.length,
    total: raw_records.length + filtered_count,
    message: `Filtered ${filtered_count} low-confidence records`,
  });

  const deduped = deduplicateRecords(raw_records);

  report(options, {
    phase: "complete",
    current: deduped.length,
    total: deduped.length,
    message: `Extraction complete: ${deduped.length} decision records`,
  });

  return {
    records: deduped,
    total_frames_processed: frame_timestamps.length,
    decisions_found: raw_records.length,
    decisions_filtered: filtered_count,
    processing_time_ms: Date.now() - start_time,
  };
}

async function parseWithLLM(
  transcript_text: string,
  moment_types: DecisionMomentType[],
  _options: DecisionExtractionOptions,
): Promise<LLMResponse[]> {
  const user_prompt = buildDecisionExtractionUserPrompt(
    transcript_text,
    moment_types,
  );

  try {
    const { generateText } = await import("ai");
    const { getAIModel } = await import("@/ai/providers/factory");

    const provider = (_options.provider ?? "anthropic") as
      | "anthropic"
      | "google"
      | "openai";
    const model = getAIModel(provider, _options.model);

    const { text } = await generateText({
      model,
      system: DECISION_EXTRACTION_SYSTEM_PROMPT,
      prompt: user_prompt,
      temperature: 0.2,
      maxOutputTokens: 2048,
    });

    return parseJSONResponse(text);
  } catch {
    return [];
  }
}

function parseJSONResponse(raw: string): LLMResponse[] {
  try {
    const cleaned = raw
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (item: unknown): item is LLMResponse =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as LLMResponse).action === "string" &&
        typeof (item as LLMResponse).reason === "string" &&
        typeof (item as LLMResponse).outcome === "string",
    );
  } catch {
    return [];
  }
}

function buildRecord(
  parse: LLMResponse,
  ctx: {
    video_id: string;
    timestamp_ms: number;
    moment_types: DecisionMomentType[];
    transcript_text: string;
  },
): DecisionRecord & { confidence: number } {
  const has_alternatives =
    parse.alternatives_considered &&
    Array.isArray(parse.alternatives_considered) &&
    parse.alternatives_considered.length > 0;

  const completeness_score = [
    parse.action.length > 3 ? 0.25 : 0,
    parse.reason.length > 5 ? 0.25 : 0,
    parse.outcome.length > 3 ? 0.25 : 0,
    has_alternatives ? 0.25 : 0.1,
  ].reduce((sum, v) => sum + v, 0);

  return {
    id: `dec-${ctx.video_id}-${ctx.timestamp_ms}`,
    video_id: ctx.video_id,
    timestamp_ms: ctx.timestamp_ms,
    moment_type: ctx.moment_types[0] ?? "other",
    action: parse.action,
    reason: parse.reason,
    alternatives_considered: parse.alternatives_considered ?? [],
    outcome: parse.outcome,
    confidence: completeness_score,
    transcript_window: ctx.transcript_text.slice(0, 2000),
  };
}

function deduplicateRecords(records: DecisionRecord[]): DecisionRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    const key = `${record.timestamp_ms}-${record.action.slice(0, 50)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
