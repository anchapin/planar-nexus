/**
 * Tests for the actionable mana-curve + land-count recommendation block
 * introduced in issue #1239.
 *
 * The block is built by `buildCurveRecommendation` (re-exported via
 * `assembleStructuredAnalysis`) and consumes per-archetype `recommendedLands`
 * data from `src/lib/anti-meta.ts`, falling back to the strategy-based curve
 * profiles when no per-archetype match exists. These tests cover the four
 * behaviour guarantees the issue specifies:
 *
 *   1. Recommended land count vs actual with a delta.
 *   2. Over/under-weighted CMC buckets flagged vs the detected archetype.
 *   3. Recommendation text reaches the coach prompt via
 *      `formatStructuredAnalysisForLLM`.
 *   4. Edge cases (empty deck, unknown archetype) still produce a stable shape.
 */

import type { DeckCard } from "@/app/actions";
import type {
  ArchetypeResult,
  DeckStats,
} from "@/ai/archetype-signatures";
import {
  assembleStructuredAnalysis,
  buildStructuredDeckAnalysis,
  formatStructuredAnalysisForLLM,
  type CurveRecommendation,
  type StructuredDeckAnalysis,
} from "../coach-deck-analysis";

function card(
  name: string,
  typeLine: string,
  cmc: number,
  count: number,
  oracle = "",
  colors: string[] = ["R"],
): DeckCard {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    cmc,
    type_line: typeLine,
    colors,
    color_identity: colors,
    legalities: {},
    count,
    oracle_text: oracle,
  };
}

function makeStats(overrides: Partial<DeckStats> = {}): DeckStats {
  return {
    totalCards: 60,
    creatureCount: 20,
    landCount: 24,
    spellCount: 16,
    avgCmc: 2.5,
    creatureRatio: 0.5,
    landRatio: 0.4,
    spellRatio: 0.4,
    colorDistribution: { R: 30 },
    cardTypes: {},
    keywordCounts: {},
    manaCurve: [24, 8, 6, 4, 2, 1, 0, 0],
    ...overrides,
  };
}

function archetypeOf(primary: string, confidence = 0.8): ArchetypeResult {
  return {
    primary,
    confidence,
    secondary: undefined,
    secondaryConfidence: undefined,
    allScores: [{ name: primary, score: confidence, category: "aggro" }],
  };
}

describe("buildCurveRecommendation (issue #1239) — land count delta", () => {
  function rec(
    archetypeName: string,
    stats: Partial<DeckStats>,
  ): CurveRecommendation {
    return assembleStructuredAnalysis([], {
      archetype: archetypeOf(archetypeName),
      stats: makeStats(stats),
      synergies: [],
      missing: [],
    }).curveRecommendation;
  }

  it("reports the recommended land count for a recognised archetype", () => {
    // 'Burn' matches `manaBaseRecommendations.modern['mod-aggro-red']` (20 lands).
    const r = rec("Burn", {});
    expect(r.recommendedLands).toBe(20);
    expect(r.minLands).toBe(18);
    expect(r.maxLands).toBe(21);
    expect(r.source).toBe("archetype");
    expect(r.archetypeTarget).toBe("Burn");
  });

  it("flags under-loaded land count with a positive action verb", () => {
    // 16 lands in a Burn deck (target 20, range 18–21) → under by 4.
    const r = rec("Burn", { landCount: 16, manaCurve: [16, 10, 8, 6, 2, 1, 0, 0] });
    expect(r.actualLands).toBe(16);
    expect(r.landDelta).toBe(-4);
    expect(r.landAssessment.toLowerCase()).toContain("add 4 lands");
    expect(
      r.actions.some((a) => /add 4 lands/i.test(a)),
    ).toBe(true);
  });

  it("flags over-loaded land count with a 'cut' action", () => {
    // 24 lands in a Burn deck (target 20) → over by 4.
    const r = rec("Burn", { landCount: 24, manaCurve: [24, 8, 6, 4, 2, 1, 0, 0] });
    expect(r.landDelta).toBe(4);
    expect(r.landAssessment.toLowerCase()).toContain("cut 4 lands");
  });

  it("treats land counts inside the archetype range as 'on target'", () => {
    // 20 lands is exactly the recommended for Burn — well within [18, 21].
    const r = rec("Burn", { landCount: 20, manaCurve: [20, 10, 8, 6, 2, 0, 0, 0] });
    expect(r.landDelta).toBe(0);
    expect(r.landAssessment.toLowerCase()).toContain("within");
  });
});

describe("buildCurveRecommendation — per-bucket over/under analysis", () => {
  function rec(
    archetypeName: string,
    manaCurve: number[],
    landCount: number,
  ): CurveRecommendation {
    const totalCards = manaCurve.reduce((a, b) => a + b, 0);
    return assembleStructuredAnalysis([], {
      archetype: archetypeOf(archetypeName),
      stats: makeStats({ manaCurve, landCount, totalCards }),
      synergies: [],
      missing: [],
    }).curveRecommendation;
  }

  it("flags a heavily over-loaded 5-drop bucket for an aggro deck", () => {
    // Aggro target at CMC=5 is 0; deck has 5 → delta +5 → 'over'.
    const r = rec("Burn", [20, 10, 8, 6, 2, 5, 0, 0], 20);
    const bucket5 = r.bucketStatus.find((b) => b.cmc === 5);
    expect(bucket5).toBeDefined();
    expect(bucket5!.status).toBe("over");
    expect(bucket5!.advice).toMatch(/cut 5 5-drops/);
  });

  it("flags an under-loaded 1-drop bucket", () => {
    // Aggro wants 8 one-drops per 20 non-lands. With 18 lands, 20 non-lands
    // → scale 1.0 → target at CMC=1 = round(8 * 1.0) = 8. Deck has 2 →
    // delta -6 → 'under', advice "add 6 1-drops".
    const r = rec("Burn", [18, 2, 8, 6, 4, 0, 0, 0], 18);
    const bucket1 = r.bucketStatus.find((b) => b.cmc === 1);
    expect(bucket1).toBeDefined();
    expect(bucket1!.status).toBe("under");
    expect(bucket1!.advice).toMatch(/add 6 1-drops/);
  });

  it("marks well-balanced buckets as 'balanced'", () => {
    // Construct a deck whose distribution roughly matches the aggro profile
    // scaled to 36 non-lands (scale = 36/20 = 1.8): 0/14/11/5/2/0/0/0.
    // 24 lands keeps everything inside the [18, 21] range for Burn — but
    // 24 lands > 21 so the deck is over-loaded on lands.
    const r = rec("Burn", [24, 14, 11, 5, 2, 0, 0, 0], 24);
    const bucket2 = r.bucketStatus.find((b) => b.cmc === 2);
    expect(bucket2).toBeDefined();
    // 2cmc target = round(6 * 1.8) = 11; actual = 11 → balanced.
    expect(bucket2!.status).toBe("balanced");
  });

  it("marks the CMC=0 bucket as the 'lands' bucket (no add/cut advice)", () => {
    const r = rec("Burn", [20, 10, 8, 6, 2, 0, 0, 0], 20);
    const lands = r.bucketStatus.find((b) => b.cmc === 0);
    expect(lands).toBeDefined();
    expect(lands!.status).toBe("lands");
    expect(lands!.advice).toBeNull();
  });

  it("produces an actions list with at least one concrete suggestion", () => {
    const r = rec("Burn", [18, 2, 8, 6, 4, 5, 0, 0], 18);
    // 1-drop and 5-drop both off → expect at least 2 add/cut actions.
    expect(r.actions.length).toBeGreaterThanOrEqual(2);
    expect(r.actions.some((a) => /add/i.test(a))).toBe(true);
    expect(r.actions.some((a) => /cut/i.test(a))).toBe(true);
  });
});

describe("buildCurveRecommendation — unknown archetype fallback", () => {
  function rec(archetypeName: string, stats: Partial<DeckStats>) {
    return assembleStructuredAnalysis([], {
      archetype: archetypeOf(archetypeName),
      stats: makeStats(stats),
      synergies: [],
      missing: [],
    }).curveRecommendation;
  }

  it("falls back to the strategy profile for unknown archetypes", () => {
    const r = rec("Experimental Pile", { avgCmc: 2.2, landCount: 22 });
    expect(r.source).toBe("strategy");
    expect(r.archetypeTarget).toBe("Experimental Pile");
    // Generic formula for avg 2.2 → base = floor(60 * 0.23) = 13.
    // No strategy clamping for midrange (default). The final clamp ensures
    // recommendedLands >= 17 (the global floor), then min/max = ±2.
    expect(r.recommendedLands).toBe(17);
    expect(r.minLands).toBe(17);
    expect(r.maxLands).toBe(19);
  });

  it("treats 'Unknown' archetype as the fallback (not a real lookup)", () => {
    const r = rec("Unknown", { landCount: 24 });
    expect(r.source).toBe("strategy");
    // The 'Unknown' archetype should never trigger the anti-meta lookup.
    expect(r.archetypeTarget).toBe("Unknown");
  });

  it("applies the control strategy clamp to a control-shaped archetype", () => {
    // Draw-Go is detected as a control strategy (the lookup misses
    // anti-meta by name so we fall through to the strategy path).
    const r = rec("Draw-Go", { avgCmc: 4.5, landCount: 26 });
    expect(r.source).toBe("strategy");
    // Control clamp: max(24, base) → 24 at minimum. Final clamp keeps it
    // inside [17, 35].
    expect(r.recommendedLands).toBeGreaterThanOrEqual(24);
    expect(r.minLands).toBeGreaterThanOrEqual(17);
    expect(r.maxLands).toBeLessThanOrEqual(35);
  });
});

describe("buildCurveRecommendation — empty / degenerate decks", () => {
  it("returns a stable shape for an empty deck (no non-land cards)", () => {
    const analysis = assembleStructuredAnalysis([], {
      archetype: archetypeOf("Burn"),
      stats: makeStats({ totalCards: 0, landCount: 0, manaCurve: [0, 0, 0, 0, 0, 0, 0, 0] }),
      synergies: [],
      missing: [],
    });
    const r = analysis.curveRecommendation;
    expect(r.archetypeTarget).toBe("Burn");
    expect(r.actualLands).toBe(0);
    expect(r.bucketStatus).toHaveLength(8);
    expect(r.summary.toLowerCase()).toContain("no non-land cards");
  });

  it("does not throw when the mana curve is shorter than 8 buckets", () => {
    const analysis = assembleStructuredAnalysis([], {
      archetype: archetypeOf("Burn"),
      stats: makeStats({ manaCurve: [10, 4] }),
      synergies: [],
      missing: [],
    });
    expect(analysis.curveRecommendation.bucketStatus).toHaveLength(8);
  });
});

describe("formatStructuredAnalysisForLLM — surfaces the recommendation", () => {
  it("includes the land-count delta line in the rendered prompt", () => {
    const analysis = assembleStructuredAnalysis([], {
      archetype: archetypeOf("Burn"),
      stats: makeStats({ landCount: 16, manaCurve: [16, 6, 8, 4, 2, 0, 0, 0] }),
      synergies: [],
      missing: [],
    });
    const formatted = formatStructuredAnalysisForLLM(analysis);
    expect(formatted).toContain("Mana-Curve Recommendation");
    expect(formatted).toContain("Curve Actions");
    // Should include the "add N lands" action in the markdown.
    expect(formatted.toLowerCase()).toContain("add 4 lands");
  });

  it("includes the bucket-level over/under breakdown when present", () => {
    const analysis = assembleStructuredAnalysis([], {
      archetype: archetypeOf("Burn"),
      stats: makeStats({ manaCurve: [20, 2, 8, 6, 2, 5, 0, 0] }),
      synergies: [],
      missing: [],
    });
    const formatted = formatStructuredAnalysisForLLM(analysis);
    expect(formatted).toContain("Over/Under CMC Buckets");
  });
});

describe("buildStructuredDeckAnalysis — end-to-end (issue #1239)", () => {
  // A small Burn-shaped deck: 20 lands, lots of 1-drops, a few 2-drops,
  // intentionally missing the 1-drop peak to exercise the bucket logic.
  function burnDeck(): DeckCard[] {
    return [
      card("Lightning Bolt", "Instant", 1, 4, "Deal 3 damage."),
      card("Lava Spike", "Sorcery", 1, 4, "Deal 3 damage to target player."),
      card("Mountain", "Basic Land — Mountain", 0, 20),
    ];
  }

  it("produces a curveRecommendation block end-to-end", async () => {
    const analysis = await buildStructuredDeckAnalysis(burnDeck());
    const cr = analysis.curveRecommendation;
    expect(cr).toBeDefined();
    expect(cr.archetypeTarget.length).toBeGreaterThan(0);
    expect(typeof cr.recommendedLands).toBe("number");
    expect(cr.bucketStatus).toHaveLength(8);
    // Burn archetype → recommendedLands should be 20 from anti-meta data.
    expect(cr.recommendedLands).toBe(20);
  });

  it("the rendered prompt exposes the recommendation text", async () => {
    const analysis = await buildStructuredDeckAnalysis(burnDeck());
    const formatted = formatStructuredAnalysisForLLM(analysis);
    expect(formatted).toContain("Mana-Curve Recommendation");
  });
});