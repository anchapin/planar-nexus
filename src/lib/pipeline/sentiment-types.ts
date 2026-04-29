export interface SentimentTranscriptSegment {
  text: string;
  start: number;
  duration: number;
}

export interface TranscriptInput {
  videoId: string;
  channelTitle: string;
  title: string;
  publishedAt: string;
  segments: SentimentTranscriptSegment[];
}

export type SentimentCategory =
  | "surprise"
  | "correction"
  | "ruling"
  | "mechanics_mismatch";

export interface SentimentMatch {
  text: string;
  segmentIndex: number;
  timestamp: number;
  category: SentimentCategory;
  matchedPhrase: string;
  confidence: number;
}

export interface CardReference {
  cardName: string;
  surroundingText: string;
  timestamp: number;
  segmentIndex: number;
  source: "card_name_mention" | "ability_keyword";
}

export interface ExpectedVsActual {
  expectedBehavior: string;
  actualBehavior: string;
  sourceText: string;
  timestamp: number;
}

export interface CandidateMismatch {
  id: string;
  videoId: string;
  channelTitle: string;
  videoTitle: string;
  sentimentMatches: SentimentMatch[];
  cardReferences: CardReference[];
  expectedVsActual: ExpectedVsActual[];
  combinedConfidence: number;
  triagePriority: "critical" | "high" | "medium" | "low";
}

export interface CrossReferenceResult {
  candidateId: string;
  cardName: string;
  engineHasImplementation: boolean;
  engineHasTests: boolean;
  enforcementStatus: "full" | "partial" | "none";
  notes: string[];
}

export interface TriageItem {
  candidate: CandidateMismatch;
  crossReference?: CrossReferenceResult;
  finalPriority: "critical" | "high" | "medium" | "low";
  recommendation: string;
}

export interface SentimentScanConfig {
  channels: ChannelSource[];
  surprisePhrases: string[];
  correctionPhrases: string[];
  rulingPhrases: string[];
  mechanicsMismatchPhrases: string[];
  cardNamePatterns: RegExp[];
  minConfidence: number;
}

export interface ChannelSource {
  name: string;
  id: string;
}

export interface ScanReport {
  generatedAt: string;
  summary: {
    totalTranscripts: number;
    totalSentimentMatches: number;
    totalCardReferences: number;
    totalCandidates: number;
    candidatesByPriority: Record<string, number>;
    channelsScanned: string[];
  };
  triageList: TriageItem[];
}
