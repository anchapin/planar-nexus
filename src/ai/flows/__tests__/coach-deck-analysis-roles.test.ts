/**
 * Edge-case tests for the structured deck-analysis assembly (issue #1078).
 *
 * `coach-deck-analysis.ts` already has a happy-path suite (gained in #952) that
 * drives `buildStructuredDeckAnalysis` end-to-end. This file targets the
 * PURE, internal helpers (`classifyRole`, `assessCurve`,
 * `deriveStrengthsAndGaps`, `buildKeyCards`) and the formatter's empty-state
 * branches by funnelling crafted decks through the exported
 * `assembleStructuredAnalysis` + `formatStructuredAnalysisForLLM`. That raises
 * branch coverage on the role/curve/strength/gap logic that the Lane 3
 * LLM-rewiring work will touch.
 */

import type { DeckCard } from "@/app/actions";
import type {
  ArchetypeResult,
  DeckStats,
} from "@/ai/archetype-signatures";
import type {
  SynergyResult,
  MissingSynergy,
} from "@/ai/synergy-detector";
import {
  assembleStructuredAnalysis,
  formatStructuredAnalysisForLLM,
} from "../coach-deck-analysis";

function card(
  name: string,
  typeLine: string,
  count: number,
  oracle = "",
  colors: string[] = ["W"],
): DeckCard {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    cmc: 0,
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
    colorDistribution: { W: 30 },
    cardTypes: {},
    keywordCounts: {},
    manaCurve: [0, 8, 8, 6, 4, 2, 1, 1],
    ...overrides,
  };
}

function archetypeOf(primary: string, confidence = 0.8): ArchetypeResult {
  return {
    primary,
    confidence,
    secondary: undefined,
    secondaryConfidence: undefined,
    allScores: [{ name: primary, score: confidence, category: "value" }],
  };
}

describe("assembleStructuredAnalysis — role classification (classifyRole)", () => {
  function roleOf(deck: DeckCard[]): {
    threats: number;
    ramp: number;
    removal: number;
    cardDraw: number;
    disruption: number;
    lands: number;
    other: number;
  } {
    return assembleStructuredAnalysis(deck, {
      archetype: archetypeOf("Midrange"),
      stats: makeStats(),
      synergies: [],
      missing: [],
    }).roleDistribution;
  }

  it("classifies counterspells as disruption", () => {
    const r = roleOf([card("Counterspell", "Instant", 2, "Counter target spell.")]);
    expect(r.disruption).toBe(2);
  });

  it("classifies hand-disruption (look at hand) as disruption", () => {
    const r = roleOf([card("Thoughtseize", "Instant", 2, "Look at target player's hand.")]);
    expect(r.disruption).toBe(2);
  });

  it("classifies destroy-creature effects as removal", () => {
    const r = roleOf([card("Doom Blade", "Instant", 2, "Destroy target creature.")]);
    expect(r.removal).toBe(2);
  });

  it("classifies ramp (search library for a land) as ramp", () => {
    // The ramp regex requires "search ... library for ... land" / "add ... mana".
    // "Tap: Add G" alone does NOT match, so only land-tutors count here.
    const r = roleOf([
      card("Cultivate", "Sorcery", 2, "Search your library for a basic land."),
      card("Kodama's Reach", "Sorcery", 2, "Search your library for a land."),
    ]);
    expect(r.ramp).toBe(4);
  });

  it("classifies card-draw spells as cardDraw", () => {
    const r = roleOf([card("Divination", "Sorcery", 2, "Draw two cards.")]);
    expect(r.cardDraw).toBe(2);
  });

  it("classifies creatures and planeswalkers as threats", () => {
    const r = roleOf([
      card("Grizzly Bears", "Creature", 2),
      card("Chandra", "Planeswalker", 1),
    ]);
    expect(r.threats).toBe(3);
  });

  it("falls back to 'other' for cards matching no role", () => {
    const r = roleOf([card("Mystery Stone", "Artifact", 3, "A curious relic.")]);
    expect(r.other).toBe(3);
  });
});

describe("assembleStructuredAnalysis — curve assessment (assessCurve)", () => {
  // assessCurve derives nonLand from stats.totalCards - stats.landCount, so the
  // helper pins landCount to 0 and totalCards to the desired non-land count.
  function curveAssessment(manaCurve: number[], nonLand: number): string {
    return assembleStructuredAnalysis([], {
      archetype: archetypeOf("Aggro"),
      stats: makeStats({ manaCurve, totalCards: nonLand, landCount: 0 }),
      synergies: [],
      missing: [],
    }).curveAssessment;
  }

  it("reports no curve when there are no non-land cards", () => {
    expect(curveAssessment([0, 0, 0, 0, 0, 0, 0, 0], 0)).toContain(
      "No non-land cards",
    );
  });

  it("labels a very low curve as aggressive", () => {
    // weighted avg = (8*1 + 2*2)/10 = 1.2
    expect(curveAssessment([0, 8, 2, 0, 0, 0, 0, 0], 10)).toMatch(/aggressive/i);
  });

  it("labels a balanced midrange curve", () => {
    // weighted avg = (4*2 + 4*3 + 4*4)/12 = 3.0
    expect(curveAssessment([0, 0, 4, 4, 4, 0, 0, 0], 12)).toMatch(/Balanced midrange/);
  });

  it("labels a top-heavy curve", () => {
    // weighted avg = (2*3 + 6*4 + 2*5)/10 = 4.0
    expect(curveAssessment([0, 0, 0, 2, 6, 2, 0, 0], 10)).toMatch(/Top-heavy/);
  });

  it("labels a very high / slow curve", () => {
    // weighted avg = (2*4 + 2*5 + 2*6 + 4*7)/10 = 5.8
    expect(curveAssessment([0, 0, 0, 0, 2, 2, 2, 4], 10)).toMatch(/Very high|slow/);
  });
});

describe("assembleStructuredAnalysis — strengths & gaps inference", () => {
  function analyze(
    stats: Partial<DeckStats>,
    synergies: SynergyResult[],
    missing: MissingSynergy[],
  ) {
    return assembleStructuredAnalysis([], {
      archetype: archetypeOf("Midrange"),
      stats: makeStats(stats),
      synergies,
      missing,
    });
  }

  it("flags a gap when no synergy clusters are detected", () => {
    const { gaps } = analyze({}, [], []);
    expect(gaps.some((g) => /No strong synergy clusters/.test(g))).toBe(true);
  });

  it("credits a strong ramp package as a strength", () => {
    const deck = [card("Cultivate", "Sorcery", 8, "Search your library for a land.")];
    const { strengths } = assembleStructuredAnalysis(deck, {
      archetype: archetypeOf("Ramp"),
      stats: makeStats(),
      synergies: [],
      missing: [],
    });
    expect(strengths.some((s) => /Strong ramp package/.test(s))).toBe(true);
  });

  it("flags a ramp deficit for a high-CMC deck with little ramp", () => {
    const { gaps } = analyze({ avgCmc: 4.2, landCount: 24, totalCards: 60 }, [], []);
    expect(gaps.some((g) => /Little ramp/.test(g))).toBe(true);
  });

  it("flags light interaction as a gap", () => {
    const { gaps } = analyze({}, [], []);
    expect(gaps.some((g) => /Light on interaction/.test(g))).toBe(true);
  });

  it("flags thin card draw as a gap", () => {
    const { gaps } = analyze({}, [], []);
    expect(gaps.some((g) => /Thin card draw/.test(g))).toBe(true);
  });

  it("flags a low land ratio as a mana-screw risk", () => {
    const { gaps } = analyze({ landCount: 18, totalCards: 60 }, [], []);
    expect(gaps.some((g) => /Low land ratio/.test(g))).toBe(true);
  });

  it("credits a solid land base as a strength", () => {
    const { strengths } = analyze({ landCount: 28, totalCards: 60 }, [], []);
    expect(strengths.some((s) => /Solid land base/.test(s))).toBe(true);
  });

  it("flags a colour imbalance when one colour dominates", () => {
    const { gaps } = analyze(
      { colorDistribution: { W: 50, U: 5 }, totalCards: 60 },
      [],
      [],
    );
    expect(gaps.some((g) => /Colour imbalance/.test(g))).toBe(true);
  });

  it("surfaces high/medium missing-synergy suggestions as gaps", () => {
    const missing: MissingSynergy[] = [
      {
        synergy: "Removal Suite",
        missing: "Single-target removal",
        description: "d",
        suggestion: "Add a Doom Blade",
        impact: "high",
      },
      {
        synergy: "Card Draw",
        missing: "Draw engine",
        description: "d",
        suggestion: "Add Divination",
        impact: "low",
      },
    ];
    const { gaps } = analyze({}, [], missing);
    expect(gaps.some((g) => g.includes("Single-target removal"))).toBe(true);
    // Low-impact missing synergies are not surfaced.
    expect(gaps.some((g) => g.includes("Draw engine"))).toBe(false);
  });

  it("limits strengths and gaps to 6 entries each", () => {
    const deck = [
      card("Cultivate", "Sorcery", 8, "Search your library for a land."),
      card("Divination", "Sorcery", 6, "Draw two cards."),
    ];
    const manySynergies: SynergyResult[] = Array.from({ length: 8 }, (_, i) => ({
      name: `Cluster ${i}`,
      category: "value",
      score: 50,
      cards: ["Cultivate"],
      description: "d",
    }));
    const { strengths, gaps } = assembleStructuredAnalysis(deck, {
      archetype: archetypeOf("Ramp"),
      stats: makeStats({ landCount: 18, totalCards: 60, colorDistribution: { W: 55, U: 5 } }),
      synergies: manySynergies,
      missing: [],
    });
    expect(strengths.length).toBeLessThanOrEqual(6);
    expect(gaps.length).toBeLessThanOrEqual(6);
  });
});

describe("assembleStructuredAnalysis — key cards", () => {
  it("ranks cards in a synergy above non-synergy cards", () => {
    const synergies: SynergyResult[] = [
      {
        name: "Elf Engine",
        category: "tribal",
        score: 80,
        cards: ["Heritage Druid"],
        description: "d",
      },
    ];
    const deck = [
      card("Heritage Druid", "Creature — Elf Druid", 2),
      card("Random Bear", "Creature", 4),
    ];
    const { keyCards } = assembleStructuredAnalysis(deck, {
      archetype: archetypeOf("Tribal"),
      stats: makeStats(),
      synergies,
      missing: [],
    });
    expect(keyCards[0].name).toBe("Heritage Druid");
    expect(keyCards[0].reason).toContain("Elf Engine");
  });

  it("excludes lands from key cards", () => {
    const deck = [
      card("Forest", "Basic Land — Forest", 20),
      card("Grizzly Bears", "Creature", 4),
    ];
    const { keyCards } = assembleStructuredAnalysis(deck, {
      archetype: archetypeOf("Aggro"),
      stats: makeStats(),
      synergies: [],
      missing: [],
    });
    expect(keyCards.every((k) => !/land/i.test(k.name))).toBe(true);
  });
});

describe("formatStructuredAnalysisForLLM — empty-state branches", () => {
  it("renders the 'none detected' line when there are no synergy clusters", () => {
    const analysis = assembleStructuredAnalysis([], {
      archetype: archetypeOf("Unknown", 0),
      stats: makeStats(),
      synergies: [],
      missing: [],
    });
    const formatted = formatStructuredAnalysisForLLM(analysis);
    expect(formatted).toContain("**Synergy Clusters**: none detected above threshold.");
  });

  it("renders a Gaps section when gaps are present", () => {
    const analysis = assembleStructuredAnalysis([], {
      archetype: archetypeOf("Midrange"),
      stats: makeStats({ landCount: 18, totalCards: 60 }),
      synergies: [],
      missing: [],
    });
    const formatted = formatStructuredAnalysisForLLM(analysis);
    expect(formatted).toContain("**Gaps / Improvement Targets**:");
  });

  it("omits the Gaps section when there are no gaps", () => {
    // A well-rounded deck: 2 synergy clusters, dense ramp/removal/draw, solid
    // land base, single colour (no imbalance) and no missing synergies.
    const deck = [
      card("Cultivate", "Sorcery", 8, "Search your library for a land."),
      card("Doom Blade", "Instant", 6, "Destroy target creature."),
      card("Divination", "Sorcery", 5, "Draw two cards."),
      card("Grizzly Bears", "Creature", 13),
    ];
    const analysis = assembleStructuredAnalysis(deck, {
      archetype: archetypeOf("Midrange"),
      stats: makeStats({
        totalCards: 60,
        landCount: 28,
        creatureCount: 20,
        colorDistribution: { W: 32 },
      }),
      synergies: [
        { name: "Value", category: "value", score: 60, cards: ["Cultivate"], description: "d" },
        { name: "Engine", category: "value", score: 50, cards: ["Divination"], description: "d" },
      ],
      missing: [],
    });
    const formatted = formatStructuredAnalysisForLLM(analysis);
    expect(formatted).not.toContain("**Gaps / Improvement Targets**:");
  });
});
