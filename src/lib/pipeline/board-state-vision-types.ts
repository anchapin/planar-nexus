import { z } from "zod";

export const BoardCardSchema = z.object({
  name: z.string(),
  is_tapped: z.boolean().default(false),
  power: z.coerce.number().optional(),
  toughness: z.coerce.number().optional(),
  counters: z.record(z.string(), z.coerce.number()).optional(),
  is_face_down: z.boolean().default(false),
  zone: z.string().default("battlefield"),
});

export type BoardCard = z.infer<typeof BoardCardSchema>;

export const RecognizedBoardStateSchema = z.object({
  player_life: z.coerce.number(),
  opponent_life: z.coerce.number(),
  battlefield_player: z.array(BoardCardSchema).default([]),
  battlefield_opponent: z.array(BoardCardSchema).default([]),
  hand_size: z.coerce.number().default(0),
  graveyard: z.array(z.string()).default([]),
  stack: z.array(z.string()).default([]),
  phase: z.string().default("main"),
  turn_number: z.coerce.number().default(0),
});

export type RecognizedBoardState = z.infer<typeof RecognizedBoardStateSchema>;

export interface VisionProcessingOptions {
  model?: string;
  temperature?: number;
  maxRetries?: number;
  includeCardArtContext?: boolean;
  confidenceThreshold?: number;
}

export interface VisionProcessingResult {
  success: boolean;
  boardState: RecognizedBoardState | null;
  rawResponse: string | null;
  validatedCards: { name: string; valid: boolean; suggestion?: string }[];
  error?: string;
  processingTimeMs: number;
  modelUsed: string;
  tokensUsed?: { input: number; output: number };
}

export interface BatchProcessingResult {
  results: VisionProcessingResult[];
  totalFrames: number;
  successfulFrames: number;
  failedFrames: number;
  averageCardAccuracy: number;
  totalProcessingTimeMs: number;
}
