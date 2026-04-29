import { z } from "zod";

export type DecisionMomentType =
  | "attack_declaration"
  | "block_declaration"
  | "spell_cast"
  | "ability_activation"
  | "priority_pass"
  | "mulligan"
  | "other";

export const DECISION_MOMENT_TYPES: DecisionMomentType[] = [
  "attack_declaration",
  "block_declaration",
  "spell_cast",
  "ability_activation",
  "priority_pass",
  "mulligan",
  "other",
];

export const DecisionRecordSchema = z.object({
  id: z.string(),
  video_id: z.string(),
  timestamp_ms: z.number(),
  moment_type: z.enum([
    "attack_declaration",
    "block_declaration",
    "spell_cast",
    "ability_activation",
    "priority_pass",
    "mulligan",
    "other",
  ]),
  action: z.string().min(1),
  reason: z.string().min(1),
  alternatives_considered: z.array(z.string()),
  outcome: z.string().min(1),
  confidence: z.number().min(0).max(1),
  transcript_window: z.string(),
  board_state_before: z.string().optional(),
  board_state_after: z.string().optional(),
  player: z.string().optional(),
  turn_number: z.number().optional(),
});

export type DecisionRecord = z.infer<typeof DecisionRecordSchema>;

export interface TranscriptAlignment {
  frame_timestamp_ms: number;
  transcript_segments: Array<{
    start_ms: number;
    end_ms: number;
    text: string;
    confidence: number;
  }>;
  window_start_ms: number;
  window_end_ms: number;
}

export interface DecisionExtractionOptions {
  video_id: string;
  transcript_segments: Array<{
    start_ms: number;
    end_ms: number;
    text: string;
    confidence: number;
  }>;
  frame_timestamps: number[];
  min_confidence: number;
  window_radius_ms: number;
  provider?: string;
  model?: string;
  on_progress?: (progress: DecisionExtractionProgress) => void;
}

export interface DecisionExtractionProgress {
  phase: "aligning" | "detecting" | "parsing" | "filtering" | "complete";
  current: number;
  total: number;
  message: string;
}

export interface DecisionExtractionResult {
  records: DecisionRecord[];
  total_frames_processed: number;
  decisions_found: number;
  decisions_filtered: number;
  processing_time_ms: number;
}
