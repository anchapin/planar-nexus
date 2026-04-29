import {
  scanTranscriptForSentiment,
  extractCardReferences,
  extractExpectedVsActual,
  buildCandidates,
  crossReferenceWithEngine,
  buildTriageList,
  getDefaultConfig,
} from "@/lib/pipeline/sentiment-analyzer";

import type { TranscriptInput } from "@/lib/pipeline/sentiment-types";

const SAMPLE_TRANSCRIPT: TranscriptInput = {
  videoId: "test-001",
  channelTitle: "Tolarian Community College",
  title: "Understanding Stack Interactions",
  publishedAt: "2024-01-15T10:00:00Z",
  segments: [
    { text: "Welcome to this gameplay analysis video.", start: 0, duration: 3 },
    {
      text: "Wait, that shouldn't work. The game let him cast that spell without paying the mana cost.",
      start: 10,
      duration: 5,
    },
    {
      text: "Actually that's wrong, the judge said you need to pay the mana cost even with Omniscience.",
      start: 18,
      duration: 4,
    },
    {
      text: "That's not how that works with ward. The ward cost should have been paid.",
      start: 25,
      duration: 4,
    },
    {
      text: "The interaction between Lightning Bolt and Ward is important.",
      start: 33,
      duration: 3,
    },
    {
      text: "Let's check the ruling on how deathtouch interacts with trample.",
      start: 40,
      duration: 3,
    },
    {
      text: "The stack should have allowed a response there.",
      start: 48,
      duration: 2,
    },
    {
      text: "That should have been destroyed by the state-based action.",
      start: 55,
      duration: 3,
    },
    {
      text: "Thanks for watching, subscribe for more content.",
      start: 65,
      duration: 3,
    },
  ],
};

const SAMPLE_TRANSCRIPT_NO_SIGNALS: TranscriptInput = {
  videoId: "test-002",
  channelTitle: "ChannelFireball",
  title: "Draft Strategy Guide",
  publishedAt: "2024-02-01T10:00:00Z",
  segments: [
    {
      text: "Today we're going to talk about draft strategy.",
      start: 0,
      duration: 3,
    },
    {
      text: "Pick order is really important in this format.",
      start: 5,
      duration: 3,
    },
    {
      text: "You want to focus on two colors ideally.",
      start: 10,
      duration: 3,
    },
    {
      text: "Removal is always good to pick early.",
      start: 15,
      duration: 3,
    },
  ],
};

const SAMPLE_TRANSCRIPT_MULTIPLE_ISSUES: TranscriptInput = {
  videoId: "test-003",
  channelTitle: "The Command Zone",
  title: "Stack Resolution Deep Dive",
  publishedAt: "2024-03-01T10:00:00Z",
  segments: [
    { text: "Let's look at this complex board state.", start: 0, duration: 3 },
    {
      text: "Wait, that shouldn't work - the lifelink should have triggered before the damage resolved.",
      start: 8,
      duration: 5,
    },
    {
      text: "The judge said the ruling is that lifelink is a static ability, not a trigger.",
      start: 16,
      duration: 4,
    },
    {
      text: "So the game got that interaction wrong - actually that's wrong.",
      start: 22,
      duration: 4,
    },
    {
      text: "The replacement effect should have applied first.",
      start: 28,
      duration: 3,
    },
    {
      text: "And the trigger should have gone on the stack before state-based actions checked.",
      start: 33,
      duration: 5,
    },
    {
      text: "This is a common source of confusion even for experienced players.",
      start: 40,
      duration: 4,
    },
  ],
};

describe("scanTranscriptForSentiment", () => {
  it("detects surprise phrases in transcript", () => {
    const matches = scanTranscriptForSentiment(SAMPLE_TRANSCRIPT);
    const surpriseMatches = matches.filter((m) => m.category === "surprise");

    expect(surpriseMatches.length).toBeGreaterThan(0);
    expect(
      surpriseMatches.some((m) => m.matchedPhrase.includes("shouldn't work")),
    ).toBe(true);
  });

  it("detects correction phrases", () => {
    const matches = scanTranscriptForSentiment(SAMPLE_TRANSCRIPT);
    const correctionMatches = matches.filter(
      (m) => m.category === "correction",
    );

    expect(correctionMatches.length).toBeGreaterThan(0);
    expect(
      correctionMatches.some((m) => m.matchedPhrase.includes("judge said")),
    ).toBe(true);
  });

  it("detects ruling phrases", () => {
    const matches = scanTranscriptForSentiment(SAMPLE_TRANSCRIPT);
    const rulingMatches = matches.filter((m) => m.category === "ruling");

    expect(rulingMatches.length).toBeGreaterThan(0);
  });

  it("detects mechanics mismatch phrases", () => {
    const matches = scanTranscriptForSentiment(SAMPLE_TRANSCRIPT);
    const mismatchMatches = matches.filter(
      (m) => m.category === "mechanics_mismatch",
    );

    expect(mismatchMatches.length).toBeGreaterThan(0);
    expect(
      mismatchMatches.some((m) => m.matchedPhrase.includes("should have been")),
    ).toBe(true);
  });

  it("returns empty array for transcript with no signals", () => {
    const matches = scanTranscriptForSentiment(SAMPLE_TRANSCRIPT_NO_SIGNALS);
    expect(matches.length).toBe(0);
  });

  it("captures timestamp and segment index", () => {
    const matches = scanTranscriptForSentiment(SAMPLE_TRANSCRIPT);
    for (const match of matches) {
      expect(match.timestamp).toBeGreaterThanOrEqual(0);
      expect(match.segmentIndex).toBeGreaterThanOrEqual(0);
      expect(match.confidence).toBeGreaterThanOrEqual(0.3);
    }
  });

  it("detects multiple separate issues in same transcript", () => {
    const matches = scanTranscriptForSentiment(
      SAMPLE_TRANSCRIPT_MULTIPLE_ISSUES,
    );
    expect(matches.length).toBeGreaterThan(3);
  });
});

describe("extractCardReferences", () => {
  const cardDatabase = new Set([
    "lightning bolt",
    "omniscience",
    "wrath of god",
    "counterspell",
    "dark confidant",
  ]);

  it("finds card names mentioned in transcript", () => {
    const refs = extractCardReferences(SAMPLE_TRANSCRIPT, cardDatabase);
    const cardMentions = refs.filter((r) => r.source === "card_name_mention");

    expect(
      cardMentions.some((r) =>
        r.cardName.toLowerCase().includes("lightning bolt"),
      ),
    ).toBe(true);
  });

  it("finds ability keyword references", () => {
    const refs = extractCardReferences(SAMPLE_TRANSCRIPT, cardDatabase);
    const keywordRefs = refs.filter((r) => r.source === "ability_keyword");

    const foundKeywords = keywordRefs.map((r) => r.cardName.toLowerCase());
    expect(foundKeywords).toContain("ward");
    expect(foundKeywords).toContain("deathtouch");
    expect(foundKeywords).toContain("trample");
  });

  it("includes surrounding context", () => {
    const refs = extractCardReferences(SAMPLE_TRANSCRIPT, cardDatabase);
    for (const ref of refs) {
      expect(ref.surroundingText.length).toBeGreaterThan(0);
    }
  });

  it("returns empty for transcript with no known cards", () => {
    const emptyDb = new Set<string>();
    const refs = extractCardReferences(SAMPLE_TRANSCRIPT_NO_SIGNALS, emptyDb);
    const cardMentions = refs.filter((r) => r.source === "card_name_mention");
    expect(cardMentions.length).toBe(0);
  });
});

describe("extractExpectedVsActual", () => {
  it("extracts expected behavior from surprise matches", () => {
    const matches = scanTranscriptForSentiment(SAMPLE_TRANSCRIPT);
    const cardDb = new Set(["lightning bolt", "omniscience"]);
    const cardRefs = extractCardReferences(SAMPLE_TRANSCRIPT, cardDb);

    const eva = extractExpectedVsActual(matches, cardRefs);
    expect(eva.length).toBeGreaterThan(0);

    const hasExpected = eva.some((e) => e.expectedBehavior.length > 0);
    expect(hasExpected).toBe(true);
  });

  it("returns empty when no surprise or mismatch matches", () => {
    const matches = scanTranscriptForSentiment(SAMPLE_TRANSCRIPT_NO_SIGNALS);
    const eva = extractExpectedVsActual(matches, []);
    expect(eva.length).toBe(0);
  });
});

describe("buildCandidates", () => {
  it("groups nearby sentiment matches into candidates", () => {
    const matches = scanTranscriptForSentiment(SAMPLE_TRANSCRIPT);
    const cardDb = new Set(["lightning bolt", "omniscience"]);
    const cardRefs = extractCardReferences(SAMPLE_TRANSCRIPT, cardDb);
    const eva = extractExpectedVsActual(matches, cardRefs);

    const candidates = buildCandidates(
      SAMPLE_TRANSCRIPT,
      matches,
      cardRefs,
      eva,
    );
    expect(candidates.length).toBeGreaterThan(0);
  });

  it("assigns triage priority based on confidence", () => {
    const matches = scanTranscriptForSentiment(SAMPLE_TRANSCRIPT);
    const cardDb = new Set(["lightning bolt", "omniscience"]);
    const cardRefs = extractCardReferences(SAMPLE_TRANSCRIPT, cardDb);
    const eva = extractExpectedVsActual(matches, cardRefs);

    const candidates = buildCandidates(
      SAMPLE_TRANSCRIPT,
      matches,
      cardRefs,
      eva,
    );
    for (const candidate of candidates) {
      expect(["critical", "high", "medium", "low"]).toContain(
        candidate.triagePriority,
      );
    }
  });

  it("returns empty for no matches", () => {
    const matches = scanTranscriptForSentiment(SAMPLE_TRANSCRIPT_NO_SIGNALS);
    const candidates = buildCandidates(
      SAMPLE_TRANSCRIPT_NO_SIGNALS,
      matches,
      [],
      [],
    );
    expect(candidates.length).toBe(0);
  });

  it("sorts candidates by confidence descending", () => {
    const matches = scanTranscriptForSentiment(
      SAMPLE_TRANSCRIPT_MULTIPLE_ISSUES,
    );
    const cardDb = new Set(["lightning bolt"]);
    const cardRefs = extractCardReferences(
      SAMPLE_TRANSCRIPT_MULTIPLE_ISSUES,
      cardDb,
    );
    const eva = extractExpectedVsActual(matches, cardRefs);

    const candidates = buildCandidates(
      SAMPLE_TRANSCRIPT_MULTIPLE_ISSUES,
      matches,
      cardRefs,
      eva,
    );
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i - 1].combinedConfidence).toBeGreaterThanOrEqual(
        candidates[i].combinedConfidence,
      );
    }
  });

  it("includes video metadata in candidate", () => {
    const matches = scanTranscriptForSentiment(SAMPLE_TRANSCRIPT);
    const candidates = buildCandidates(SAMPLE_TRANSCRIPT, matches, [], []);

    for (const c of candidates) {
      expect(c.videoId).toBe("test-001");
      expect(c.channelTitle).toBe("Tolarian Community College");
      expect(c.videoTitle).toBe("Understanding Stack Interactions");
    }
  });
});

describe("crossReferenceWithEngine", () => {
  it("reports no enforcement for unknown cards", () => {
    const candidates = buildCandidates(
      SAMPLE_TRANSCRIPT,
      scanTranscriptForSentiment(SAMPLE_TRANSCRIPT),
      extractCardReferences(SAMPLE_TRANSCRIPT, new Set()),
      [],
    );
    if (candidates.length === 0) return;

    const result = crossReferenceWithEngine(
      candidates[0],
      new Set(),
      new Map(),
    );

    expect(result.engineHasImplementation).toBe(false);
    expect(result.engineHasTests).toBe(false);
    expect(result.enforcementStatus).toBe("none");
  });

  it("reports enforcement status from map", () => {
    const enforcementMap = new Map<
      string,
      { status: string; hasTests: boolean }
    >();
    enforcementMap.set("lifelink", { status: "partial", hasTests: true });

    const candidates = buildCandidates(
      SAMPLE_TRANSCRIPT_MULTIPLE_ISSUES,
      scanTranscriptForSentiment(SAMPLE_TRANSCRIPT_MULTIPLE_ISSUES),
      extractCardReferences(SAMPLE_TRANSCRIPT_MULTIPLE_ISSUES, new Set()),
      [],
    );
    if (candidates.length === 0) return;

    const result = crossReferenceWithEngine(
      candidates[0],
      new Set(),
      enforcementMap,
    );

    expect(result.enforcementStatus).toBe("partial");
    expect(result.engineHasTests).toBe(true);
  });

  it("includes notes about missing implementation", () => {
    const candidates = buildCandidates(
      SAMPLE_TRANSCRIPT,
      scanTranscriptForSentiment(SAMPLE_TRANSCRIPT),
      extractCardReferences(SAMPLE_TRANSCRIPT, new Set()),
      [],
    );
    if (candidates.length === 0) return;

    const result = crossReferenceWithEngine(
      candidates[0],
      new Set(),
      new Map(),
    );

    expect(result.notes.length).toBeGreaterThan(0);
  });
});

describe("buildTriageList", () => {
  it("produces complete triage items with recommendations", () => {
    const triage = buildTriageList(
      buildCandidates(
        SAMPLE_TRANSCRIPT,
        scanTranscriptForSentiment(SAMPLE_TRANSCRIPT),
        extractCardReferences(SAMPLE_TRANSCRIPT, new Set(["lightning bolt"])),
        [],
      ),
      new Set(["lightning bolt"]),
      new Map(),
    );

    expect(triage.length).toBeGreaterThan(0);

    for (const item of triage) {
      expect(item.finalPriority).toBeDefined();
      expect(item.recommendation.length).toBeGreaterThan(0);
      expect(item.crossReference).toBeDefined();
    }
  });

  it("upgrades priority when correction matches missing enforcement", () => {
    const enforcementMap = new Map<
      string,
      { status: string; hasTests: boolean }
    >();
    enforcementMap.set("ward", { status: "none", hasTests: false });

    const matches = scanTranscriptForSentiment(SAMPLE_TRANSCRIPT);
    const cardRefs = extractCardReferences(SAMPLE_TRANSCRIPT, new Set());
    const eva = extractExpectedVsActual(matches, cardRefs);
    const candidates = buildCandidates(
      SAMPLE_TRANSCRIPT,
      matches,
      cardRefs,
      eva,
    );

    const triage = buildTriageList(candidates, new Set(), enforcementMap);

    const criticalItems = triage.filter((i) => i.finalPriority === "critical");
    expect(criticalItems.length).toBeGreaterThan(0);
  });

  it("sorts by priority", () => {
    const triage = buildTriageList(
      buildCandidates(
        SAMPLE_TRANSCRIPT,
        scanTranscriptForSentiment(SAMPLE_TRANSCRIPT),
        extractCardReferences(SAMPLE_TRANSCRIPT, new Set()),
        [],
      ),
      new Set(),
      new Map(),
    );

    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    for (let i = 1; i < triage.length; i++) {
      const prev = priorityOrder[triage[i - 1].finalPriority] ?? 4;
      const curr = priorityOrder[triage[i].finalPriority] ?? 4;
      expect(prev).toBeLessThanOrEqual(curr);
    }
  });
});

describe("getDefaultConfig", () => {
  it("includes at least 5 educational channels", () => {
    const config = getDefaultConfig();
    expect(config.channels.length).toBeGreaterThanOrEqual(5);
  });

  it("has surprise, correction, ruling, and mechanics mismatch phrases", () => {
    const config = getDefaultConfig();
    expect(config.surprisePhrases.length).toBeGreaterThan(10);
    expect(config.correctionPhrases.length).toBeGreaterThan(5);
    expect(config.rulingPhrases.length).toBeGreaterThan(5);
    expect(config.mechanicsMismatchPhrases.length).toBeGreaterThan(5);
  });

  it("includes required phrases from the issue", () => {
    const config = getDefaultConfig();
    const allPhrases = [
      ...config.surprisePhrases,
      ...config.correctionPhrases,
      ...config.rulingPhrases,
      ...config.mechanicsMismatchPhrases,
    ].map((p) => p.toLowerCase());

    expect(allPhrases).toContain("wait, that shouldn't work");
    expect(allPhrases.some((p) => p.includes("actually that's wrong"))).toBe(
      true,
    );
    expect(
      allPhrases.some((p) => p.includes("that's not how that works")),
    ).toBe(true);
    expect(allPhrases.some((p) => p.includes("the judge said"))).toBe(true);
    expect(allPhrases.some((p) => p.includes("ruling is"))).toBe(true);
  });
});

describe("end-to-end: produce at least 10 candidates", () => {
  it("generates sufficient candidates from sample transcripts", () => {
    const transcripts = [
      SAMPLE_TRANSCRIPT,
      SAMPLE_TRANSCRIPT_MULTIPLE_ISSUES,
      ...Array.from({ length: 4 }, (_, i) => ({
        videoId: `synth-${i}`,
        channelTitle: [
          "ChannelFireball",
          "The Command Zone",
          "Game Knights",
          "Strictly Better MTG",
        ][i],
        title: `Rules Analysis Part ${i + 1}`,
        publishedAt: "2024-04-01T10:00:00Z",
        segments: [
          { text: "Let's analyze this board state.", start: 0, duration: 3 },
          {
            text: "Wait, that shouldn't work - the ability should have resolved differently.",
            start: 5,
            duration: 4,
          },
          {
            text: "Actually that's wrong. The judge said the ruling is that it works differently.",
            start: 12,
            duration: 5,
          },
          {
            text: "That's not how that works with hexproof.",
            start: 20,
            duration: 3,
          },
          {
            text: "The damage should have been prevented by the ward.",
            start: 25,
            duration: 3,
          },
          {
            text: "It should have triggered when the creature entered.",
            start: 30,
            duration: 3,
          },
          {
            text: "That can't be right - the stack should have let us respond.",
            start: 36,
            duration: 4,
          },
          {
            text: "The trigger should have gone on the stack before state-based actions checked.",
            start: 42,
            duration: 5,
          },
          {
            text: "According to the rules, the replacement effect should apply first.",
            start: 50,
            duration: 4,
          },
          {
            text: "The game got that interaction wrong.",
            start: 56,
            duration: 3,
          },
          { text: "Now let's look at another play.", start: 62, duration: 3 },
          {
            text: "Wait, that shouldn't have worked with the sacrifice outlet.",
            start: 70,
            duration: 4,
          },
          {
            text: "The judge ruled that you can't sacrifice in response to your own spell.",
            start: 80,
            duration: 5,
          },
          {
            text: "That's incorrect - the game let the player keep the tokens.",
            start: 90,
            duration: 4,
          },
          {
            text: "The scry trigger should have resolved before draw.",
            start: 100,
            duration: 3,
          },
          {
            text: "It should have been exiled instead of going to the graveyard.",
            start: 110,
            duration: 4,
          },
          {
            text: "Hold on, that's wrong - the player had hexproof.",
            start: 120,
            duration: 3,
          },
          {
            text: "That shouldn't be possible with indestructible.",
            start: 130,
            duration: 3,
          },
          {
            text: "The replacement effect should have modified the event.",
            start: 140,
            duration: 4,
          },
          {
            text: "This is clearly a bug in how the game handles persist.",
            start: 150,
            duration: 4,
          },
        ],
      })),
    ];

    const cardDb = new Set(["lightning bolt", "omniscience"]);
    const enforcementMap = new Map<
      string,
      { status: string; hasTests: boolean }
    >();
    enforcementMap.set("lifelink", { status: "partial", hasTests: false });
    enforcementMap.set("deathtouch", { status: "full", hasTests: true });
    enforcementMap.set("trample", { status: "none", hasTests: false });
    enforcementMap.set("ward", { status: "none", hasTests: false });
    enforcementMap.set("hexproof", { status: "partial", hasTests: true });
    enforcementMap.set("flash", { status: "full", hasTests: true });

    const allTriage: Array<{
      candidate: { id: string };
      finalPriority: string;
      recommendation: string;
    }> = [];
    for (const t of transcripts) {
      const matches = scanTranscriptForSentiment(t);
      const cardRefs = extractCardReferences(t, cardDb);
      const eva = extractExpectedVsActual(matches, cardRefs);
      const candidates = buildCandidates(t, matches, cardRefs, eva);
      const triage = buildTriageList(candidates, cardDb, enforcementMap);
      allTriage.push(...triage);
    }

    const uniqueCandidates = new Set(allTriage.map((i) => i.candidate.id));
    expect(uniqueCandidates.size).toBeGreaterThanOrEqual(10);
  });
});
