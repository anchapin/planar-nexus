import type {
  DecisionRecord,
  DecisionMomentType,
} from "../decision-extraction/types";
import type {
  HeuristicCategory,
  HeuristicRecord,
  PatternAggregationResult,
} from "./types";
import { HEURISTIC_CATEGORIES } from "./types";

const MOMENT_TYPE_TO_CATEGORY: Partial<
  Record<DecisionMomentType, HeuristicCategory>
> = {
  attack_declaration: "attack_lines",
  block_declaration: "block_assignments",
  spell_cast: "combat_trick_timing",
  ability_activation: "combat_trick_timing",
  mulligan: "mulligan_threshold",
};

function detectCategory(record: DecisionRecord): HeuristicCategory {
  const explicit = MOMENT_TYPE_TO_CATEGORY[record.moment_type];
  if (explicit) return explicit;

  const text =
    `${record.action} ${record.reason} ${(record.alternatives_considered || []).join(" ")}`.toLowerCase();

  if (
    text.includes("counterspell") ||
    text.includes("counter") ||
    (text.includes("hold") && text.includes("instant"))
  ) {
    return "counterspell_decisions";
  }

  if (
    text.includes("sideboard") ||
    text.includes("board in") ||
    text.includes("board out") ||
    text.includes("swap")
  ) {
    return "sideboard_swap";
  }

  if (
    text.includes("mulligan") ||
    text.includes("keep") ||
    text.includes("ship") ||
    (text.includes("hand") && text.includes("keep"))
  ) {
    return "mulligan_threshold";
  }

  if (
    text.includes("land") ||
    text.includes("mana") ||
    text.includes("tap") ||
    text.includes("mana dork")
  ) {
    return "mana_sequencing";
  }

  if (
    text.includes("block") ||
    text.includes("assign") ||
    text.includes("evasion") ||
    text.includes("fly")
  ) {
    return "block_assignments";
  }

  if (
    text.includes("attack") ||
    text.includes("race") ||
    text.includes("aggress")
  ) {
    return "attack_lines";
  }

  if (
    text.includes("trick") ||
    text.includes("combat") ||
    text.includes("damage") ||
    text.includes("remove")
  ) {
    return "combat_trick_timing";
  }

  return "attack_lines";
}

function buildSignature(record: DecisionRecord): string {
  const parts: string[] = [];

  if (record.board_state_before) {
    parts.push(record.board_state_before);
  }
  if (record.board_state_after) {
    parts.push(record.board_state_after);
  }

  parts.push(record.action);
  parts.push(record.reason);
  parts.push(record.moment_type);
  parts.push(record.outcome);

  if (record.player) parts.push(record.player);
  if (record.turn_number) parts.push(`turn:${record.turn_number}`);

  return parts.join(" | ");
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return `sig_${Math.abs(hash).toString(36)}`;
}

function deduplicateRecords(records: HeuristicRecord[]): HeuristicRecord[] {
  const seen = new Map<string, HeuristicRecord>();

  for (const record of records) {
    const existing = seen.get(record.state_hash);
    if (existing) {
      existing.frequency += record.frequency;
      existing.confidence = Math.max(existing.confidence, record.confidence);
      existing.updated_at = Date.now();
    } else {
      seen.set(record.state_hash, { ...record });
    }
  }

  return Array.from(seen.values());
}

export class KnowledgeExtractor {
  extractFromDecisionRecords(records: DecisionRecord[]): HeuristicRecord[] {
    const heuristics: HeuristicRecord[] = [];

    for (const record of records) {
      const category = detectCategory(record);
      const signature = buildSignature(record);

      heuristics.push({
        id: `dr_${record.id}`,
        category,
        title: record.action,
        description: record.reason,
        game_state_signature: signature,
        state_hash: simpleHash(signature),
        action: record.action,
        reasoning: record.reason,
        confidence: record.confidence,
        frequency: 1,
        source_game_id: undefined,
        source_video_id: record.video_id,
        tags: [record.moment_type],
        turn_range: record.turn_number
          ? { min: record.turn_number, max: record.turn_number }
          : undefined,
        created_at: Date.now(),
        updated_at: Date.now(),
      });
    }

    return deduplicateRecords(heuristics);
  }

  aggregateByCategory(records: HeuristicRecord[]): PatternAggregationResult[] {
    const grouped = new Map<HeuristicCategory, HeuristicRecord[]>();

    for (const cat of HEURISTIC_CATEGORIES) {
      grouped.set(cat, []);
    }

    for (const record of records) {
      const group = grouped.get(record.category);
      if (group) {
        group.push(record);
      }
    }

    return HEURISTIC_CATEGORIES.map((category) => {
      const patterns = grouped.get(category) || [];
      const uniqueSigs = new Set(patterns.map((p) => p.state_hash)).size;
      const avgConf =
        patterns.length > 0
          ? patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length
          : 0;

      return {
        category,
        patterns,
        total_records: patterns.length,
        unique_signatures: uniqueSigs,
        avg_confidence: avgConf,
      };
    });
  }

  mergeWithExisting(
    incoming: HeuristicRecord[],
    existing: HeuristicRecord[],
  ): HeuristicRecord[] {
    return deduplicateRecords([...existing, ...incoming]);
  }
}
