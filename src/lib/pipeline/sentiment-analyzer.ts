import type {
  SentimentMatch,
  SentimentCategory,
  CardReference,
  ExpectedVsActual,
  CandidateMismatch,
  CrossReferenceResult,
  TriageItem,
  TranscriptInput,
  SentimentScanConfig,
} from "./sentiment-types.js";

export const DEFAULT_CHANNELS: Array<{ name: string; id: string }> = [
  { name: "Tolarian Community College", id: "UCvq8ZdDTzN4K_55UJ_g_eBg" },
  { name: "ChannelFireball", id: "UC0w0Y7ZdK5UDh2oOz_8X8vA" },
  { name: "The Command Zone", id: "UCxW-OBmG9Zk-6YqP1f-5qCg" },
  { name: "Game Knights", id: "UCn6ZqQ-Fc7y-7yZ8Z8Z8Z8g" },
  { name: "Strictly Better MTG", id: "UCBRrPEM5XUbJilKCFA7YoBQ" },
];

const SURPRISE_PHRASES: string[] = [
  "wait, that shouldn't work",
  "that shouldn't work",
  "that's not how that works",
  "that's not supposed to happen",
  "that's wrong",
  "that can't be right",
  "that doesn't seem right",
  "that's incorrect",
  "something's wrong here",
  "that's a bug",
  "that shouldn't be possible",
  "how did that work",
  "that shouldn't have worked",
  "that interaction is wrong",
  "that's not the right interaction",
  "wait, no",
  "hold on, that's wrong",
  "that's weird",
  "that doesn't make sense",
  "that can't target that",
  "that should have been countered",
  "that should have resolved",
];

const CORRECTION_PHRASES: string[] = [
  "actually that's wrong",
  "actually, that's not right",
  "the correct ruling is",
  "the judge said",
  "the judge ruled",
  "according to the rules",
  "the oracle text says",
  "the comprehensive rules say",
  "the CR says",
  "that should have been",
  "you're supposed to",
  "the errata says",
  "they changed the ruling",
  "the ruling is",
  "ruling change",
  "updated ruling",
  "i think the game got that wrong",
  "the game doesn't handle that correctly",
];

const RULING_PHRASES: string[] = [
  "ruling is",
  "the ruling would be",
  "what's the ruling on",
  "let's check the ruling",
  "the judge would rule",
  "the interaction is",
  "how does that interact with",
  "stack interaction",
  "priority response",
  "the stack would",
  "holding priority",
  "responding to",
  "in response to",
  "on the stack",
  "state-based action",
];

const MECHANICS_MISMATCH_PHRASES: string[] = [
  "it should have dealt",
  "it should have dealt damage",
  "the damage should have been",
  "that should have been destroyed",
  "it should have been exiled",
  "it should have been sacrificed",
  "should have drawn",
  "should have gained life",
  "should have tutored",
  "should have triggered",
  "the trigger should have",
  "the ability should have",
  "the replacement effect",
  "it should have gone to",
  "should have been shuffled",
  "should have scryed",
  "the emblem should have",
  "the ward cost should have",
];

export function getDefaultConfig(): SentimentScanConfig {
  return {
    channels: DEFAULT_CHANNELS,
    surprisePhrases: SURPRISE_PHRASES,
    correctionPhrases: CORRECTION_PHRASES,
    rulingPhrases: RULING_PHRASES,
    mechanicsMismatchPhrases: MECHANICS_MISMATCH_PHRASES,
    cardNamePatterns: [
      /\b[A-Z][a-z]+(?:\s+[a-z]+){0,3}\s+(?:of|the|from|to|in|for)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g,
      /\b\d+\/\d+\b/g,
    ],
    minConfidence: 0.3,
  };
}

export function scanTranscriptForSentiment(
  transcript: TranscriptInput,
  config: SentimentScanConfig = getDefaultConfig(),
): SentimentMatch[] {
  const matches: SentimentMatch[] = [];

  for (let i = 0; i < transcript.segments.length; i++) {
    const segment = transcript.segments[i];
    const text = segment.text.toLowerCase();

    const allPhrases: Array<{
      phrase: string;
      category: SentimentCategory;
    }> = [
      ...config.surprisePhrases.map((p) => ({
        phrase: p,
        category: "surprise" as const,
      })),
      ...config.correctionPhrases.map((p) => ({
        phrase: p,
        category: "correction" as const,
      })),
      ...config.rulingPhrases.map((p) => ({
        phrase: p,
        category: "ruling" as const,
      })),
      ...config.mechanicsMismatchPhrases.map((p) => ({
        phrase: p,
        category: "mechanics_mismatch" as const,
      })),
    ];

    for (const { phrase, category } of allPhrases) {
      if (text.includes(phrase.toLowerCase())) {
        const confidence = computeConfidence(text, phrase, category);
        if (confidence >= config.minConfidence) {
          matches.push({
            text: segment.text,
            segmentIndex: i,
            timestamp: segment.start,
            category,
            matchedPhrase: phrase,
            confidence,
          });
        }
      }
    }
  }

  return matches;
}

function computeConfidence(
  fullText: string,
  _matchedPhrase: string,
  category: SentimentCategory,
): number {
  let confidence = 0.5;

  const surpriseBoosters = [
    "shouldn't",
    "not how",
    "wrong",
    "incorrect",
    "bug",
  ];
  const correctionBoosters = ["actually", "judge", "ruling", "errata", "CR"];
  const rulingBoosters = ["judge", "stack", "priority", "state-based"];
  const mismatchBoosters = [
    "should have",
    "would have",
    "the trigger",
    "the ability",
  ];

  let boosters: string[];
  switch (category) {
    case "surprise":
      boosters = surpriseBoosters;
      break;
    case "correction":
      boosters = correctionBoosters;
      break;
    case "ruling":
      boosters = rulingBoosters;
      break;
    case "mechanics_mismatch":
      boosters = mismatchBoosters;
      break;
  }

  for (const b of boosters) {
    if (fullText.includes(b)) {
      confidence += 0.15;
    }
  }

  return Math.min(confidence, 1.0);
}

export function extractCardReferences(
  transcript: TranscriptInput,
  cardDatabase: Set<string>,
): CardReference[] {
  const references: CardReference[] = [];

  for (let i = 0; i < transcript.segments.length; i++) {
    const segment = transcript.segments[i];
    const words = segment.text.split(/\s+/);

    for (let j = 0; j < words.length; j++) {
      for (let len = 1; len <= Math.min(5, words.length - j); len++) {
        const candidate = words.slice(j, j + len).join(" ");
        if (cardDatabase.has(candidate.toLowerCase())) {
          const startIdx = Math.max(0, j - 5);
          const endIdx = Math.min(words.length, j + len + 10);
          const surroundingText = words.slice(startIdx, endIdx).join(" ");

          references.push({
            cardName: candidate,
            surroundingText,
            timestamp: segment.start,
            segmentIndex: i,
            source: "card_name_mention",
          });
          break;
        }
      }
    }

    const abilityKeywords = [
      "lifelink",
      "deathtouch",
      "first strike",
      "double strike",
      "trample",
      "hexproof",
      "ward",
      "indestructible",
      "flying",
      "reach",
      "vigilance",
      "haste",
      "menace",
      "provoke",
      "flash",
      "Cascade",
      "storm",
      "convoke",
      "proliferate",
      "detain",
      "extort",
      "battalion",
      "evolve",
      "cipher",
      "bestow",
      "tribute",
      "monstrous",
      "devotion",
      "scry",
      "surveil",
      "jump-start",
      "undergrowth",
      "mobilize",
      "spectacle",
      "adapt",
      "companion",
      "escape",
      "constellation",
      "disturb",
      "coven",
      "decayed",
      "specialize",
      "forage",
      "craft",
      "collect evidence",
      "subplot",
      "start your engines",
      "arena",
      "backup",
      "dungeon",
      "venture",
      "radiance",
      "lieutenant",
      "enlist",
    ];

    for (const kw of abilityKeywords) {
      if (segment.text.toLowerCase().includes(kw.toLowerCase())) {
        references.push({
          cardName: kw,
          surroundingText: segment.text.substring(0, 200),
          timestamp: segment.start,
          segmentIndex: i,
          source: "ability_keyword",
        });
      }
    }
  }

  return references;
}

export function extractExpectedVsActual(
  sentimentMatches: SentimentMatch[],
  cardReferences: CardReference[],
): ExpectedVsActual[] {
  const results: ExpectedVsActual[] = [];

  for (const match of sentimentMatches) {
    if (
      match.category === "surprise" ||
      match.category === "mechanics_mismatch"
    ) {
      const nearbyCards = cardReferences.filter(
        (ref) =>
          Math.abs(ref.timestamp - match.timestamp) < 60 &&
          Math.abs(ref.segmentIndex - match.segmentIndex) <= 3,
      );

      const shouldHavePattern =
        /should (?:have|be|deal|draw|gain|trigger|target|resolve|counter|destroy|exile|sacrifice)/i;
      const shouldMatch = match.text.match(shouldHavePattern);
      const expectedBehavior = shouldMatch ? shouldMatch[0] : "";

      const actualPattern =
        /(instead|but it|however|actually|in the game|on arena|in game)\s+(.{0,50})/i;
      const actualMatch = match.text.match(actualPattern);
      const actualBehavior = actualMatch
        ? actualMatch[0].trim()
        : "behavior did not match expectation";

      if (expectedBehavior || nearbyCards.length > 0) {
        results.push({
          expectedBehavior: expectedBehavior || "standard rules behavior",
          actualBehavior,
          sourceText: match.text,
          timestamp: match.timestamp,
        });
      }
    }
  }

  return results;
}

export function buildCandidates(
  transcript: TranscriptInput,
  sentimentMatches: SentimentMatch[],
  cardReferences: CardReference[],
  expectedVsActual: ExpectedVsActual[],
): CandidateMismatch[] {
  if (sentimentMatches.length === 0) return [];

  const segmentsWindow = 10;
  const groups = new Map<string, SentimentMatch[]>();

  for (const match of sentimentMatches) {
    const key = `${Math.floor(match.segmentIndex / segmentsWindow)}`;
    const existing = groups.get(key) || [];
    existing.push(match);
    groups.set(key, existing);
  }

  const candidates: CandidateMismatch[] = [];
  let candidateIdx = 0;

  for (const [key, groupMatches] of groups) {
    const baseIndex = parseInt(key) * segmentsWindow;
    const nearbyCards = cardReferences.filter(
      (ref) => Math.abs(ref.segmentIndex - baseIndex) <= segmentsWindow,
    );
    const nearbyEva = expectedVsActual.filter(
      (eva) => Math.abs(eva.timestamp - groupMatches[0].timestamp) < 120,
    );

    const avgConfidence =
      groupMatches.reduce((sum, m) => sum + m.confidence, 0) /
      groupMatches.length;

    const hasCorrection = groupMatches.some((m) => m.category === "correction");
    const hasSurprise = groupMatches.some((m) => m.category === "surprise");
    const hasMismatch = groupMatches.some(
      (m) => m.category === "mechanics_mismatch",
    );

    let combinedConfidence = avgConfidence;
    if (hasCorrection) combinedConfidence += 0.2;
    if (hasSurprise && hasCorrection) combinedConfidence += 0.15;
    if (hasMismatch) combinedConfidence += 0.1;
    if (nearbyCards.length > 0) combinedConfidence += 0.1;
    if (nearbyEva.length > 0) combinedConfidence += 0.15;
    combinedConfidence = Math.min(combinedConfidence, 1.0);

    let triagePriority: CandidateMismatch["triagePriority"];
    if (combinedConfidence >= 0.8 && hasCorrection) {
      triagePriority = "critical";
    } else if (combinedConfidence >= 0.6) {
      triagePriority = "high";
    } else if (combinedConfidence >= 0.4) {
      triagePriority = "medium";
    } else {
      triagePriority = "low";
    }

    candidates.push({
      id: `${transcript.videoId}-candidate-${candidateIdx++}`,
      videoId: transcript.videoId,
      channelTitle: transcript.channelTitle,
      videoTitle: transcript.title,
      sentimentMatches: groupMatches,
      cardReferences: nearbyCards,
      expectedVsActual: nearbyEva,
      combinedConfidence,
      triagePriority,
    });
  }

  candidates.sort((a, b) => b.combinedConfidence - a.combinedConfidence);
  return candidates;
}

export function crossReferenceWithEngine(
  candidate: CandidateMismatch,
  cardDatabase: Set<string>,
  enforcementMap: Map<string, { status: string; hasTests: boolean }>,
): CrossReferenceResult {
  const cardRefs = candidate.cardReferences.filter(
    (ref) => ref.source === "card_name_mention",
  );
  const keywordRefs = candidate.cardReferences.filter(
    (ref) => ref.source === "ability_keyword",
  );

  const allNames = [
    ...cardRefs.map((r) => r.cardName.toLowerCase()),
    ...keywordRefs.map((r) => r.cardName.toLowerCase()),
  ];

  const notes: string[] = [];
  let engineHasImplementation = false;
  let engineHasTests = false;
  let enforcementStatus: "full" | "partial" | "none" = "none";
  let primaryCard = "unknown";

  for (const name of allNames) {
    if (enforcementMap.has(name)) {
      const info = enforcementMap.get(name)!;
      engineHasImplementation = info.status !== "none";
      engineHasTests = info.hasTests;
      enforcementStatus = info.status as "full" | "partial" | "none";
      primaryCard = name;

      if (info.status === "none") {
        notes.push(`"${name}" has no engine enforcement`);
      } else if (info.status === "partial") {
        notes.push(`"${name}" has partial enforcement`);
      }
      if (!info.hasTests) {
        notes.push(`"${name}" lacks unit tests`);
      }
    } else if (cardDatabase.has(name)) {
      primaryCard = name;
      notes.push(
        `"${name}" exists in card database but no enforcement function found`,
      );
    }
  }

  if (allNames.length === 0) {
    notes.push("No specific card or keyword identified");
  }

  if (candidate.sentimentMatches.some((m) => m.category === "correction")) {
    notes.push(
      "Commentator provided a correction — likely a confirmed rules interaction issue",
    );
  }

  return {
    candidateId: candidate.id,
    cardName: primaryCard,
    engineHasImplementation,
    engineHasTests,
    enforcementStatus,
    notes,
  };
}

export function buildTriageList(
  candidates: CandidateMismatch[],
  cardDatabase: Set<string>,
  enforcementMap: Map<string, { status: string; hasTests: boolean }>,
): TriageItem[] {
  return candidates.map((candidate) => {
    const crossRef = crossReferenceWithEngine(
      candidate,
      cardDatabase,
      enforcementMap,
    );

    let finalPriority = candidate.triagePriority;

    if (
      crossRef.enforcementStatus === "none" &&
      candidate.sentimentMatches.some((m) => m.category === "correction")
    ) {
      finalPriority = "critical";
    } else if (
      crossRef.enforcementStatus === "partial" &&
      !crossRef.engineHasTests
    ) {
      if (finalPriority === "low") finalPriority = "medium";
    } else if (crossRef.engineHasImplementation && crossRef.engineHasTests) {
      if (finalPriority === "critical") finalPriority = "high";
    }

    const recommendation = buildRecommendation(candidate, crossRef);

    return {
      candidate,
      crossReference: crossRef,
      finalPriority,
      recommendation,
    };
  });
}

function buildRecommendation(
  candidate: CandidateMismatch,
  crossRef: CrossReferenceResult,
): string {
  const parts: string[] = [];

  if (crossRef.enforcementStatus === "none") {
    parts.push(`Implement "${crossRef.cardName}" in the rules engine`);
  } else if (crossRef.enforcementStatus === "partial") {
    parts.push(`Review partial enforcement for "${crossRef.cardName}"`);
  }

  if (!crossRef.engineHasTests) {
    parts.push("Write unit tests for this ability");
  }

  if (candidate.expectedVsActual.length > 0) {
    parts.push(
      `Investigate expected vs actual behavior: "${candidate.expectedVsActual[0].expectedBehavior}"`,
    );
  }

  if (candidate.sentimentMatches.some((m) => m.category === "correction")) {
    parts.push(
      "Commentator confirmed incorrect behavior — high priority review",
    );
  }

  if (parts.length === 0) {
    parts.push("Monitor for additional corroborating reports");
  }

  return parts.join(". ") + ".";
}
