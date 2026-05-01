import { z } from "zod";

export const HEURISTIC_CATEGORIES = [
  "attack_lines",
  "block_assignments",
  "combat_trick_timing",
  "counterspell_decisions",
  "mana_sequencing",
  "sideboard_swap",
  "mulligan_threshold",
] as const;

export type HeuristicCategory = (typeof HEURISTIC_CATEGORIES)[number];

export const CATEGORY_DESCRIPTIONS: Record<HeuristicCategory, string> = {
  attack_lines: "Optimal attack patterns based on board state and life totals",
  block_assignments:
    "Block assignment strategies vs evasion and trample combinations",
  combat_trick_timing:
    "Windows for casting combat tricks before damage resolution",
  counterspell_decisions: "Hold vs use decision trees for countermagic",
  mana_sequencing: "Optimal land and mana usage ordering by archetype",
  sideboard_swap: "Sideboard transition patterns between games 2 and 3",
  mulligan_threshold: "Keep/ship thresholds by archetype and format",
};

export const HeuristicRecordSchema = z.object({
  id: z.string(),
  category: z.enum(HEURISTIC_CATEGORIES),
  title: z.string().min(1),
  description: z.string().min(1),
  game_state_signature: z.string().min(1),
  state_hash: z.string().min(1),
  action: z.string().min(1),
  reasoning: z.string().min(1),
  confidence: z.number().min(0).max(1),
  frequency: z.number().min(1).default(1),
  source_game_id: z.string().optional(),
  source_video_id: z.string().optional(),
  archetype: z.string().optional(),
  format: z.string().optional(),
  turn_range: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
  life_context: z
    .object({
      ai_life_min: z.number().optional(),
      ai_life_max: z.number().optional(),
      opponent_life_min: z.number().optional(),
      opponent_life_max: z.number().optional(),
    })
    .optional(),
  board_context: z
    .object({
      ai_creatures_min: z.number().optional(),
      ai_creatures_max: z.number().optional(),
      opponent_creatures_min: z.number().optional(),
      opponent_creatures_max: z.number().optional(),
      total_board_power_min: z.number().optional(),
      total_board_power_max: z.number().optional(),
    })
    .optional(),
  tags: z.array(z.string()).default([]),
  created_at: z.number().default(() => Date.now()),
  updated_at: z.number().default(() => Date.now()),
});

export type HeuristicRecord = z.infer<typeof HeuristicRecordSchema>;

export interface HeuristicDocument {
  id: string;
  category: string;
  title: string;
  description: string;
  action: string;
  reasoning: string;
  confidence: number;
  frequency: number;
  archetype: string;
  format: string;
  tags: string[];
  vector: number[];
}

export interface KnowledgeSearchResult {
  record: HeuristicRecord;
  score: number;
}

export interface KnowledgeSearchQuery {
  category?: HeuristicCategory;
  game_state_signature?: string;
  vector?: number[];
  term?: string;
  archetype?: string;
  format?: string;
  limit?: number;
  min_confidence?: number;
  min_frequency?: number;
  similarity?: number;
}

export interface PatternAggregationResult {
  category: HeuristicCategory;
  patterns: HeuristicRecord[];
  total_records: number;
  unique_signatures: number;
  avg_confidence: number;
}

export interface KnowledgeStats {
  total_records: number;
  by_category: Record<HeuristicCategory, number>;
  avg_confidence: number;
  records_with_embeddings: number;
  last_updated: number | null;
}
