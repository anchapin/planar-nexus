import type {
  TranscriptSegment,
  KeywordSearchResult,
  ExtractedEdgeCase,
  PipelineStats,
  ExtractionConfidence,
  EdgeCaseCategory,
} from "./types";

const CARD_NAME_PATTERN =
  /\b([A-Z][a-z]+(?: [A-Z][a-z]+)*(?:, [A-Z][a-z]+(?: [A-Z][a-z]+)*)*)\b/g;
const CR_PATTERN = /CR\s+(\d{3}(?:\.\d{1,3}[a-z]?)+)/g;

function generateId(prefix: string, index: number): string {
  return `${prefix}-${String(index).padStart(3, "0")}`;
}

export function segmentTranscript(
  transcriptText: string,
  sourceTitle: string,
  segmentIdPrefix: string = "seg",
): TranscriptSegment[] {
  const lines = transcriptText.split("\n").filter((l) => l.trim().length > 0);
  const segments: TranscriptSegment[] = [];
  let segmentIndex = 0;

  let currentSpeaker = "unknown";
  let currentText = "";
  let currentTimestamp = "";

  for (const line of lines) {
    const speakerMatch = line.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)/);
    if (speakerMatch) {
      if (currentText.trim()) {
        segments.push({
          id: generateId(segmentIdPrefix, segmentIndex),
          timestamp: currentTimestamp,
          speaker: currentSpeaker,
          text: currentText.trim(),
          keywords_matched: [],
        });
        segmentIndex++;
      }
      currentTimestamp = speakerMatch[1];
      const rest = speakerMatch[2];
      const colonIdx = rest.indexOf(":");
      if (colonIdx > 0) {
        currentSpeaker = rest.slice(0, colonIdx).trim();
        currentText = rest.slice(colonIdx + 1).trim();
      } else {
        currentSpeaker = rest;
        currentText = "";
      }
    } else {
      currentText += " " + line.trim();
    }
  }

  if (currentText.trim()) {
    segments.push({
      id: generateId(segmentIdPrefix, segmentIndex),
      timestamp: currentTimestamp,
      speaker: currentSpeaker,
      text: currentText.trim(),
      keywords_matched: [],
    });
  }

  return segments;
}

export function searchKeywords(
  segments: TranscriptSegment[],
  keywords: string[],
): KeywordSearchResult[] {
  const results: KeywordSearchResult[] = [];

  for (const segment of segments) {
    const lowerText = segment.text.toLowerCase();
    const matchedKeywords: string[] = [];

    for (const keyword of keywords) {
      if (lowerText.includes(keyword.toLowerCase())) {
        matchedKeywords.push(keyword);
      }
    }

    if (matchedKeywords.length > 0) {
      const score = matchedKeywords.length;
      results.push({
        segment: { ...segment, keywords_matched: matchedKeywords },
        score,
        matchedKeywords,
      });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

function extractCardNames(text: string): string[] {
  const commonPrepositions = new Set([
    "the",
    "a",
    "an",
    "is",
    "to",
    "of",
    "and",
    "in",
    "for",
    "on",
    "at",
    "this",
    "that",
    "it",
    "with",
    "so",
    "if",
    "but",
    "not",
    "can",
    "you",
    "your",
    "they",
    "their",
    "there",
    "then",
    "when",
    "what",
    "how",
    "why",
    "does",
    "has",
    "have",
    "will",
    "would",
    "could",
    "should",
    "may",
    "from",
    "by",
    "or",
    "be",
    "do",
    "we",
    "he",
    "she",
    "my",
    "me",
    "Which",
    "That",
    "This",
    "There",
    "They",
    "What",
    "When",
    "How",
    "Because",
    "Since",
    "While",
    "After",
    "Before",
    "During",
    "Unless",
    "Once",
    "Any",
    "Each",
    "Every",
    "All",
    "Both",
    "Neither",
    "Either",
  ]);

  const matches = text.match(CARD_NAME_PATTERN) || [];
  return matches.filter((m) => {
    const words = m.split(/\s+/);
    if (words.length < 2 || words.length > 5) return false;
    return !words.every((w) => commonPrepositions.has(w));
  });
}

function extractCrReferences(text: string): string[] {
  const matches = text.match(CR_PATTERN) || [];
  return [...new Set(matches)];
}

function estimateConfidence(
  segment: TranscriptSegment,
  result: KeywordSearchResult,
): ExtractionConfidence {
  if (result.score >= 3 && segment.text.length > 100) return "high";
  if (result.score >= 2) return "medium";
  return "low";
}

function classifyCategory(text: string): EdgeCaseCategory {
  const lower = text.toLowerCase();
  if (
    lower.includes("combat") ||
    lower.includes("block") ||
    lower.includes("attack") ||
    lower.includes("damage") ||
    lower.includes("deathtouch") ||
    lower.includes("trample") ||
    lower.includes("first strike") ||
    lower.includes("double strike") ||
    lower.includes("lifelink")
  )
    return "combat";
  if (
    lower.includes("stack") ||
    lower.includes("respond") ||
    lower.includes("counter") ||
    lower.includes("resolve") ||
    lower.includes("priority")
  )
    return "stack";
  if (
    lower.includes("sba") ||
    lower.includes("state-based") ||
    lower.includes("toughness") ||
    lower.includes("indestructible")
  )
    return "state-based-action";
  if (
    lower.includes("replacement") ||
    lower.includes("instead") ||
    lower.includes("prevent")
  )
    return "replacement-effect";
  if (
    lower.includes("mana") ||
    lower.includes("tap") ||
    lower.includes("mana ability") ||
    lower.includes("mana cost") ||
    lower.includes("floating")
  )
    return "mana";
  if (
    lower.includes("layer") ||
    lower.includes("copy") ||
    lower.includes("clone") ||
    lower.includes("power") ||
    lower.includes("toughness setting")
  )
    return "layer-system";
  if (
    lower.includes("commander") ||
    lower.includes("21 damage") ||
    lower.includes("commander damage")
  )
    return "commander-damage";
  if (
    lower.includes("trigger") ||
    lower.includes("when") ||
    lower.includes("whenever") ||
    lower.includes("at the beginning")
  )
    return "triggered-ability";
  if (
    lower.includes("activate") ||
    lower.includes("activated ability") ||
    lower.includes("cost") ||
    lower.includes(": ")
  )
    return "activated-ability";
  if (
    lower.includes("protection") ||
    lower.includes("hexproof") ||
    lower.includes("shroud")
  )
    return "protection";
  if (
    lower.includes("counter") ||
    lower.includes("+1") ||
    lower.includes("-1") ||
    lower.includes("charge counter") ||
    lower.includes("loyalty")
  )
    return "counters";
  if (
    lower.includes("zone") ||
    lower.includes("graveyard") ||
    lower.includes("exile") ||
    lower.includes("library") ||
    lower.includes("battlefield") ||
    lower.includes("hand")
  )
    return "zones";
  if (
    lower.includes("phase") ||
    lower.includes("end step") ||
    lower.includes("upkeep") ||
    lower.includes("draw step") ||
    lower.includes("main phase")
  )
    return "turn-phases";
  if (
    lower.includes("cast") ||
    lower.includes("spell") ||
    lower.includes("sorcery") ||
    lower.includes("instant")
  )
    return "spell-casting";
  if (lower.includes("ability") || lower.includes("effect")) return "ability";
  return "stack";
}

export function extractEdgeCases(
  keywordResults: KeywordSearchResult[],
  sourceTitle: string,
  sourceType: ExtractedEdgeCase["source"] = "generic-judge-content",
): ExtractedEdgeCase[] {
  const edgeCases: ExtractedEdgeCase[] = [];

  for (let i = 0; i < keywordResults.length; i++) {
    const { segment, matchedKeywords } = keywordResults[i];
    if (segment.text.length < 50) continue;

    const confidence = estimateConfidence(segment, keywordResults[i]);
    const category = classifyCategory(segment.text);
    const cardNames = extractCardNames(segment.text);
    const crReferences = extractCrReferences(segment.text);

    const moduleMap: Record<string, string> = {
      combat: "combat.ts",
      stack: "stack-interaction.ts",
      "state-based-action": "state-based-actions.ts",
      "replacement-effect": "replacement-effects.ts",
      mana: "mana-system.ts",
      "layer-system": "layer-system.ts",
      "commander-damage": "commander-damage.ts",
      "triggered-ability": "abilities.ts",
      "activated-ability": "abilities.ts",
      protection: "protection.ts",
      counters: "counter-system.ts",
      zones: "zone-handling.ts",
      "turn-phases": "phase-handler.ts",
      "spell-casting": "spell-casting.ts",
      ability: "abilities.ts",
      priority: "priority.ts",
    };

    edgeCases.push({
      id: generateId("nlp", i),
      source: sourceType,
      sourceTitle,
      timestamp: segment.timestamp,
      category,
      cardNames,
      gameStateDescription: segment.text,
      ruleInQuestion: matchedKeywords.join(", "),
      correctOutcome: "",
      commonMisconception: "",
      crReferences,
      confidence,
      verified: false,
      convertedToTest: false,
      engineModule: moduleMap[category] || "rules-engine.ts",
      tags: matchedKeywords,
    });
  }

  return edgeCases;
}

export function computePipelineStats(
  totalTranscripts: number,
  totalSegments: number,
  keywordResults: KeywordSearchResult[],
  extractedEdgeCases: ExtractedEdgeCase[],
): PipelineStats {
  return {
    totalTranscripts,
    totalSegments,
    keywordMatches: keywordResults.length,
    extractedEdgeCases: extractedEdgeCases.length,
    highConfidenceCount: extractedEdgeCases.filter(
      (ec) => ec.confidence === "high",
    ).length,
    convertedToTests: extractedEdgeCases.filter((ec) => ec.convertedToTest)
      .length,
  };
}
