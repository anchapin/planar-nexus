/**
 * @fileoverview Tests for the post-generation grounding guard (issue #1419).
 *
 * Covers the three heuristic families:
 *   1. Citation tag validity (`[E:<id>]` must exist in the ledger).
 *   2. Numeric contradiction (land count, avg CMC, role counts, curve buckets).
 *   3. Insufficient-category assertion (matchup / meta without data).
 *
 * Plus: tier-specific caveat wording, deterministic verdicts, and the
 * "fully grounded" happy path (no flags, empty caveat).
 */

import { describe, it, expect } from "@jest/globals";
import {
  runGroundingGuard,
  buildGroundingCaveat,
  type GroundingFailure,
} from "../coach-grounding-guard";
import {
  buildEvidenceLedger,
  type AnalysisSource,
} from "../coach-evidence-ledger";

function fixtureAnalysis(): AnalysisSource {
  return {
    archetype: "Mono-Red Burn",
    secondaryArchetype: "Aggro",
    totalCards: 60,
    averageCmc: 1.85,
    manaCurve: [0, 12, 12, 4, 0, 0, 0, 0],
    roleDistribution: {
      threats: 12,
      ramp: 0,
      removal: 10,
      cardDraw: 4,
      disruption: 0,
      lands: 20,
      other: 4,
    },
    synergyClusters: [
      {
        name: "Burn Package",
        category: "removal",
        score: 80,
        cards: ["Lightning Bolt", "Chain Lightning"],
        description: "Cheap burn to close games",
      },
    ],
    gaps: ["Light on card draw (only 4 sources)."],
    strengths: ["Strong removal density (10 answers)."],
    keyCards: [
      { name: "Goblin Guide", role: "threats", reason: "1-mana pressure" },
    ],
    curveRecommendation: {
      archetypeTarget: "Mono-Red Burn",
      recommendedLands: 20,
      minLands: 18,
      maxLands: 22,
      actualLands: 20,
      landDelta: 0,
    },
  };
}

const LEDGER = buildEvidenceLedger({ analysis: fixtureAnalysis() });

describe("runGroundingGuard — happy path", () => {
  it("passes a grounded message with no flags and no caveat", () => {
    const message =
      "Your land count is 20 [E:curve-lands] and average CMC is 1.85 [E:curve-avgcmc]. " +
      "With 10 removal spells [E:role-mix] you can control the early board.";
    const verdict = runGroundingGuard({ message, ledger: LEDGER });
    expect(verdict.grounded).toBe(true);
    expect(verdict.lowConfidence).toBe(false);
    expect(verdict.needsReview).toBe(false);
    expect(verdict.failures).toEqual([]);
    expect(verdict.caveat).toBe("");
  });

  it("passes a message with NO factual claims (purely qualitative advice)", () => {
    const message =
      "Consider mulliganing aggressively — your deck rewards a fast start.";
    const verdict = runGroundingGuard({ message, ledger: LEDGER });
    expect(verdict.grounded).toBe(true);
    expect(verdict.lowConfidence).toBe(false);
  });

  it("passes a message that cites the wincondition evidence", () => {
    const message =
      "Your deck's primary plan is to reduce life total with cheap burn [E:wincondition-derived].";
    const verdict = runGroundingGuard({ message, ledger: LEDGER });
    expect(verdict.grounded).toBe(true);
  });
});

describe("runGroundingGuard — missing evidence tags", () => {
  it("flags a citation tag referencing an id that is NOT in the ledger", () => {
    const message = "Your sideboard plan is solid [E:sideboard-plan]."; // No such evidence id.
    const verdict = runGroundingGuard({ message, ledger: LEDGER });
    expect(verdict.grounded).toBe(false);
    expect(verdict.lowConfidence).toBe(true);
    expect(verdict.failures).toContainEqual(
      expect.objectContaining({
        kind: "missing-evidence-tag",
        ref: "sideboard-plan",
      }),
    );
    expect(verdict.caveat).toContain("grounding");
  });

  it("flags multiple missing tags independently", () => {
    const message = "A [E:foo] claim and a [E:bar] claim.";
    const verdict = runGroundingGuard({ message, ledger: LEDGER });
    expect(verdict.failures.length).toBe(2);
  });
});

describe("runGroundingGuard — numeric contradictions", () => {
  it("flags a wrong land count", () => {
    // Ledger says 20 lands (±1). 24 is far outside tolerance.
    const message = "You have 24 lands, which is plenty for your curve.";
    const verdict = runGroundingGuard({ message, ledger: LEDGER });
    expect(verdict.grounded).toBe(false);
    expect(verdict.failures).toContainEqual(
      expect.objectContaining({
        kind: "numeric-contradiction",
        ref: "lands",
      }),
    );
  });

  it("accepts a land count within tolerance", () => {
    // 20 ± 1 ⇒ 21 still grounded.
    const message = "You have 21 lands in this deck.";
    const verdict = runGroundingGuard({ message, ledger: LEDGER });
    expect(verdict.grounded).toBe(true);
  });

  it("flags a wrong average CMC", () => {
    // Ledger says 1.85 ± 0.2. Claiming 3.5 is far outside.
    const message = "Your average CMC is 3.5 — quite high.";
    const verdict = runGroundingGuard({ message, ledger: LEDGER });
    expect(verdict.grounded).toBe(false);
    expect(verdict.failures).toContainEqual(
      expect.objectContaining({
        kind: "numeric-contradiction",
        ref: "avgCmc",
      }),
    );
  });

  it("flags a wrong removal count", () => {
    // Ledger says 10 removal (±1). Claiming 30 is wrong.
    const message = "You run 30 removal spells, which is excessive.";
    const verdict = runGroundingGuard({ message, ledger: LEDGER });
    expect(verdict.grounded).toBe(false);
    expect(verdict.failures).toContainEqual(
      expect.objectContaining({
        kind: "numeric-contradiction",
        ref: "removal",
      }),
    );
  });

  it("flags a wrong threats count", () => {
    const message = "You only have 3 threats, which is too few.";
    const verdict = runGroundingGuard({ message, ledger: LEDGER });
    expect(verdict.grounded).toBe(false);
    expect(verdict.failures).toContainEqual(
      expect.objectContaining({ ref: "threats" }),
    );
  });

  it("flags a wrong total card count", () => {
    const message = "Your deck has 75 cards.";
    const verdict = runGroundingGuard({ message, ledger: LEDGER });
    expect(verdict.grounded).toBe(false);
    expect(verdict.failures).toContainEqual(
      expect.objectContaining({ ref: "totalCards" }),
    );
  });

  it("accepts a correct avg CMC stated in different wordings", () => {
    const messages = [
      "Your average CMC is 1.85.",
      "Avg CMC of 1.85.",
      "Mean mana value is 1.9.",
    ];
    for (const m of messages) {
      const verdict = runGroundingGuard({ message: m, ledger: LEDGER });
      expect(verdict.grounded).toBe(true);
    }
  });
});

describe("runGroundingGuard — insufficient-category assertions", () => {
  it("flags a matchup assertion when matchup data is insufficient", () => {
    const message =
      "Your win rate against control is around 65%. You fold to combo decks.";
    const verdict = runGroundingGuard({ message, ledger: LEDGER });
    expect(verdict.grounded).toBe(false);
    expect(verdict.failures).toContainEqual(
      expect.objectContaining({
        kind: "insufficient-category",
        ref: "matchup",
      }),
    );
  });

  it("flags a meta assertion when meta data is insufficient", () => {
    const message = "In the current meta, this is a tier-1 deck.";
    const verdict = runGroundingGuard({ message, ledger: LEDGER });
    expect(verdict.grounded).toBe(false);
    expect(verdict.failures).toContainEqual(
      expect.objectContaining({
        kind: "insufficient-category",
        ref: "meta",
      }),
    );
  });

  it("does not flag generic matchup discussion that makes no concrete assertion", () => {
    const message =
      "Think about your matchup positioning when you sideboard. Consider what you're trying to beat.";
    const verdict = runGroundingGuard({ message, ledger: LEDGER });
    expect(verdict.grounded).toBe(true);
  });
});

describe("runGroundingGuard — determinism", () => {
  it("returns identical verdicts for identical inputs", () => {
    const message = "You have 24 lands and your win rate vs control is 70%.";
    const a = runGroundingGuard({ message, ledger: LEDGER });
    const b = runGroundingGuard({ message, ledger: LEDGER });
    expect(a).toEqual(b);
  });
});

describe("runGroundingGuard — empty ledger (everything insufficient)", () => {
  it("does NOT flag pure numeric claims when the ledger has no facts (nothing to contradict)", () => {
    const empty = buildEvidenceLedger({});
    const verdict = runGroundingGuard({
      message: "You have 24 lands and average CMC is 3.0.",
      ledger: empty,
    });
    // No facts ⇒ no numeric-contradiction is possible. The guard is
    // conservative: it does not strip claims it cannot verify, it only
    // flags contradictions. Matchup / meta assertions still flag because
    // those categories are ALWAYS insufficient.
    expect(verdict.failures).toEqual([]);
    expect(verdict.grounded).toBe(true);
  });

  it("flags matchup assertions even with an empty ledger", () => {
    const empty = buildEvidenceLedger({});
    const verdict = runGroundingGuard({
      message: "You beat control 70% of the time.",
      ledger: empty,
    });
    expect(verdict.grounded).toBe(false);
    expect(verdict.failures.some((f) => f.ref === "matchup")).toBe(true);
  });
});

describe("buildGroundingCaveat — tier wording", () => {
  const failures: GroundingFailure[] = [
    {
      kind: "numeric-contradiction",
      ref: "lands",
      detail: "Claimed land count 24; ledger says 20 (±1).",
    },
  ];

  it("easy tier uses friendly, beginner wording", () => {
    const caveat = buildGroundingCaveat("easy", failures);
    expect(caveat).toContain("Heads up");
    expect(caveat).toContain("double-check");
    expect(caveat).toContain("land count 24");
  });

  it("medium tier uses 'partial grounding failure' wording", () => {
    const caveat = buildGroundingCaveat("medium", failures);
    expect(caveat).toContain("partial grounding failure");
    expect(caveat).toContain("coach opinion");
  });

  it("hard tier exposes the failure kind", () => {
    const caveat = buildGroundingCaveat("hard", failures);
    expect(caveat).toContain("[numeric-contradiction]");
  });

  it("expert tier is concise and references the source of truth", () => {
    const caveat = buildGroundingCaveat("expert", failures);
    expect(caveat).toContain("structured deck analysis");
  });

  it("all tiers mention review / verify semantics (issue #1419: all tiers block unsupported factual certainty)", () => {
    const easy = buildGroundingCaveat("easy", failures).toLowerCase();
    const medium = buildGroundingCaveat("medium", failures).toLowerCase();
    const hard = buildGroundingCaveat("hard", failures).toLowerCase();
    const expert = buildGroundingCaveat("expert", failures).toLowerCase();
    // Every tier surfaces the low-confidence intent in some form. The regex
    // matches "review", "double-check", "verified"/"verify", "rely",
    // "confirm", or "not established".
    const reviewWords =
      /(review|double-check|verif|rely|confirm|not (?:as )?established|coach opinion)/;
    expect(reviewWords.test(easy)).toBe(true);
    expect(reviewWords.test(medium)).toBe(true);
    expect(reviewWords.test(hard)).toBe(true);
    expect(reviewWords.test(expert)).toBe(true);
  });
});

describe("runGroundingGuard — defaults", () => {
  it("defaults to medium tier when difficulty is omitted", () => {
    // Use a phrasing the matchup-assertion heuristic reliably catches
    // ("folds to" — concrete assertion against a specific opponent class).
    const message = "This deck folds to fast combo decks.";
    const verdict = runGroundingGuard({ message, ledger: LEDGER });
    expect(verdict.caveat).toContain("partial grounding failure");
  });
});
