/**
 * @fileoverview Tests for the coach evidence ledger (issue #1419).
 *
 * Asserts that the ledger is:
 *  - **Deterministic** — same inputs ⇒ byte-identical ledger (including checksum).
 *  - **Bounded** — caps the number of entries per category.
 *  - **Stable-id'd** — every entry id matches the documented scheme so the
 *    guard and the prompt agree on the citation vocabulary.
 *  - **Schema-valid** — every ledger produced satisfies the zod schema.
 *  - **Gracefully degraded** — empty inputs yield an empty ledger with every
 *    category marked insufficient.
 */

import { describe, it, expect } from "@jest/globals";
import {
  buildEvidenceLedger,
  EvidenceLedgerSchema,
  parseEvidenceLedger,
  renderLedgerForPrompt,
  indexEvidenceIds,
  type AnalysisSource,
} from "../coach-evidence-ledger";

/** A representative structured-analysis fixture (small but complete). */
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
      {
        name: "Lightning Bolt",
        role: "removal",
        reason: "Flexible burn — creature or face.",
      },
      {
        name: "Goblin Guide",
        role: "threats",
        reason: "One-mana pressure.",
      },
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

describe("buildEvidenceLedger — determinism", () => {
  it("produces byte-identical ledgers (incl. checksum) for the same analysis", () => {
    const a = buildEvidenceLedger({ analysis: fixtureAnalysis() });
    const b = buildEvidenceLedger({ analysis: fixtureAnalysis() });
    expect(a).toEqual(b);
    expect(a.checksum).toBe(b.checksum);
  });

  it("produces the same ledger regardless of analysis field ordering", () => {
    // Mutate a copy in a way that doesn't change the analysis semantically —
    // the ledger keys off values, not insertion order.
    const reordered: AnalysisSource = {
      ...fixtureAnalysis(),
      roleDistribution: {
        lands: 20,
        threats: 12,
        ramp: 0,
        removal: 10,
        cardDraw: 4,
        disruption: 0,
        other: 4,
      },
    };
    const a = buildEvidenceLedger({ analysis: fixtureAnalysis() });
    const b = buildEvidenceLedger({ analysis: reordered });
    expect(a.checksum).toBe(b.checksum);
  });
});

describe("buildEvidenceLedger — stable ids + categories", () => {
  it("emits the documented curve / roleMix / winCondition / synergy / strength / gap ids", () => {
    const ledger = buildEvidenceLedger({ analysis: fixtureAnalysis() });
    const ids = indexEvidenceIds(ledger);

    // Core ids the guard relies on — must be stable across releases.
    expect(ids.has("curve-lands")).toBe(true);
    expect(ids.has("curve-avgcmc")).toBe(true);
    expect(ids.has("curve-buckets")).toBe(true);
    expect(ids.has("curve-total")).toBe(true);
    expect(ids.has("role-mix")).toBe(true);
    expect(ids.has("wincondition-derived")).toBe(true);
    expect(ids.has("synergy-1")).toBe(true);
    expect(ids.has("strengths-summary")).toBe(true);
    expect(ids.has("gaps-summary")).toBe(true);
  });

  it("exposes numeric facts for land count, avg CMC, role counts, and curve buckets", () => {
    const ledger = buildEvidenceLedger({ analysis: fixtureAnalysis() });

    const find = (id: string) => ledger.entries.find((e) => e.id === id);

    const lands = find("curve-lands");
    expect(lands?.numericFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "lands", value: 20, tolerance: 1 }),
        expect.objectContaining({
          key: "recommendedLands",
          value: 20,
        }),
      ]),
    );

    const avgCmc = find("curve-avgcmc");
    expect(avgCmc?.numericFacts).toContainEqual({
      key: "avgCmc",
      label: "average CMC",
      value: 1.85,
      tolerance: 0.2,
    });

    const roles = find("role-mix");
    expect(roles?.numericFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "threats", value: 12 }),
        expect.objectContaining({ key: "removal", value: 10 }),
        expect.objectContaining({ key: "ramp", value: 0 }),
        expect.objectContaining({ key: "cardDraw", value: 4 }),
      ]),
    );
  });

  it("marks matchup and meta as insufficient (no external meta snapshot)", () => {
    const ledger = buildEvidenceLedger({ analysis: fixtureAnalysis() });
    expect(ledger.insufficientCategories).toEqual(
      expect.arrayContaining(["matchup", "meta"]),
    );
  });
});

describe("buildEvidenceLedger — bounding + ordering", () => {
  it("caps synergy entries at 5 even when the analysis has more", () => {
    const manySynergies = fixtureAnalysis();
    manySynergies.synergyClusters = Array.from({ length: 12 }, (_, i) => ({
      name: `Cluster ${i + 1}`,
      category: "tribal",
      score: 50 + i,
      cards: [`Card ${i + 1}`],
      description: "synergy",
    }));
    const ledger = buildEvidenceLedger({ analysis: manySynergies });
    const synergies = ledger.entries.filter((e) => e.category === "synergy");
    expect(synergies.length).toBeLessThanOrEqual(5);
  });

  it("emits entries in stable category order (curve before roleMix before winCondition ...)", () => {
    const ledger = buildEvidenceLedger({ analysis: fixtureAnalysis() });
    const categories = ledger.entries.map((e) => e.category);

    // Curve first, roleMix second, winCondition third.
    expect(categories.indexOf("curve")).toBeLessThan(
      categories.indexOf("roleMix"),
    );
    expect(categories.indexOf("roleMix")).toBeLessThan(
      categories.indexOf("winCondition"),
    );
    expect(categories.indexOf("winCondition")).toBeLessThan(
      categories.indexOf("synergy"),
    );
  });
});

describe("buildEvidenceLedger — graceful degrade", () => {
  it("returns an empty ledger with every claim category insufficient when no sources are given", () => {
    const ledger = buildEvidenceLedger({});
    expect(ledger.entries).toEqual([]);
    // Matchup + meta are always insufficient; plus every other category
    // because there's no data.
    expect(ledger.insufficientCategories).toEqual(
      expect.arrayContaining([
        "curve",
        "roleMix",
        "winCondition",
        "synergy",
        "strength",
        "gap",
        "matchup",
        "meta",
      ]),
    );
  });

  it("builds a partial ledger from a digested context when no full analysis is present", () => {
    const ledger = buildEvidenceLedger({
      digestedContext: {
        deckSummary: {
          totalCards: 60,
          averageCmc: 2.4,
          manaCurve: [0, 8, 10, 8, 4, 0, 0, 0],
          keyCards: ["Sol Ring", "Lightning Bolt"],
        },
      },
    });
    const ids = indexEvidenceIds(ledger);
    expect(ids.has("curve-total")).toBe(true);
    expect(ids.has("curve-avgcmc")).toBe(true);
    expect(ids.has("curve-buckets")).toBe(true);
    expect(ids.has("wincondition-derived")).toBe(true);
  });
});

describe("buildEvidenceLedger — zod schema validation", () => {
  it("produces ledgers that satisfy EvidenceLedgerSchema", () => {
    const ledger = buildEvidenceLedger({ analysis: fixtureAnalysis() });
    const result = EvidenceLedgerSchema.safeParse(ledger);
    expect(result.success).toBe(true);
  });

  it("parseEvidenceLedger round-trips a built ledger", () => {
    const ledger = buildEvidenceLedger({ analysis: fixtureAnalysis() });
    const round = parseEvidenceLedger(JSON.parse(JSON.stringify(ledger)));
    expect(round).not.toBeNull();
    expect(round?.checksum).toBe(ledger.checksum);
  });

  it("parseEvidenceLedger rejects malformed shapes", () => {
    expect(parseEvidenceLedger(null)).toBeNull();
    expect(parseEvidenceLedger("nope")).toBeNull();
    expect(parseEvidenceLedger({ entries: "not-an-array" })).toBeNull();
    // Entry with a bad category should be rejected.
    expect(
      parseEvidenceLedger({
        entries: [{ id: "x", category: "not-a-category", summary: "x" }],
        checksum: "ev:00000000",
        insufficientCategories: [],
      }),
    ).toBeNull();
  });
});

describe("renderLedgerForPrompt", () => {
  it("emits a fenced grounding block with citation instructions", () => {
    const ledger = buildEvidenceLedger({ analysis: fixtureAnalysis() });
    const block = renderLedgerForPrompt(ledger);
    expect(block).toContain("<grounding_evidence>");
    expect(block).toContain("</grounding_evidence>");
    expect(block).toContain("[E:curve-lands]");
    expect(block).toContain("GROUNDING RULES");
    expect(block).toContain("[E:");
  });

  it("returns the empty string for an empty ledger", () => {
    const ledger = buildEvidenceLedger({});
    expect(renderLedgerForPrompt(ledger)).toBe("");
  });

  it("lists the insufficient categories so the model knows what NOT to assert", () => {
    const ledger = buildEvidenceLedger({ analysis: fixtureAnalysis() });
    const block = renderLedgerForPrompt(ledger);
    expect(block).toContain("Insufficient context");
    expect(block).toContain("matchup");
    expect(block).toContain("meta");
  });
});
