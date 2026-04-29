export type EdgeCaseCategory =
  | "combat"
  | "stack"
  | "priority"
  | "state-based-action"
  | "replacement-effect"
  | "mana"
  | "layer-system"
  | "spell-casting"
  | "ability"
  | "zones"
  | "commander-damage"
  | "turn-phases"
  | "triggered-ability"
  | "activated-ability"
  | "protection"
  | "counters";

export type ExtractionConfidence = "high" | "medium" | "low";

export type SourceChannel =
  | "tolarian-community-college"
  | "mtg-goldfish"
  | "loadingreadyrun"
  | "judge-highlight-compilation"
  | "scg-tour"
  | "pro-tour-coverage"
  | "commander-vs"
  | "commander-at-home"
  | "generic-judge-content"
  | "synthetic";

export interface TranscriptSegment {
  id: string;
  timestamp: string;
  speaker: string;
  text: string;
  keywords_matched: string[];
}

export interface ExtractedEdgeCase {
  id: string;
  source: SourceChannel;
  sourceTitle: string;
  timestamp?: string;
  category: EdgeCaseCategory;
  cardNames: string[];
  gameStateDescription: string;
  ruleInQuestion: string;
  correctOutcome: string;
  commonMisconception?: string;
  crReferences: string[];
  confidence: ExtractionConfidence;
  verified: boolean;
  convertedToTest: boolean;
  engineModule: string;
  tags: string[];
}

export interface TranscriptPipelineConfig {
  channels: SourceChannel[];
  keywords: string[];
  minConfidence: ExtractionConfidence;
  maxSegments: number;
}

export interface KeywordSearchResult {
  segment: TranscriptSegment;
  score: number;
  matchedKeywords: string[];
}

export interface PipelineStats {
  totalTranscripts: number;
  totalSegments: number;
  keywordMatches: number;
  extractedEdgeCases: number;
  highConfidenceCount: number;
  convertedToTests: number;
}

export const DEFAULT_PIPELINE_CONFIG: TranscriptPipelineConfig = {
  channels: [
    "tolarian-community-college",
    "mtg-goldfish",
    "loadingreadyrun",
    "judge-highlight-compilation",
    "scg-tour",
    "pro-tour-coverage",
  ],
  keywords: [
    "actually",
    "the rule is",
    "correctly",
    "incorrectly",
    "in this case",
    "the correct interaction",
    "people get wrong",
    "common mistake",
    "the ruling is",
    "judges call",
    "a lot of people think",
    "what happens is",
    "this is how it works",
    "the correct answer",
    "the interaction is",
    "priority matters",
    "the stack works",
    "replacement effect",
    "state-based action",
    "the oracle text says",
  ],
  minConfidence: "medium",
  maxSegments: 1000,
};
