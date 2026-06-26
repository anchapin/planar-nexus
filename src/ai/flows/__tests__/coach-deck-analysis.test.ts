import {
  buildStructuredDeckAnalysis,
  formatStructuredAnalysisForLLM,
  type StructuredDeckAnalysis,
} from "../coach-deck-analysis";
import type { DeckCard } from "@/app/actions";

/** Build an Elf-ramp deck that exercises archetype + synergy detection. */
function buildElfRampDeck(): DeckCard[] {
  const card = (
    name: string,
    typeLine: string,
    cmc: number,
    count: number,
    oracle = "",
  ): DeckCard => ({
    id: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    cmc,
    type_line: typeLine,
    colors: ["G"],
    color_identity: ["G"],
    legalities: {},
    count,
    oracle_text: oracle,
  });

  return [
    card("Llanowar Elves", "Creature — Elf Druid", 1, 4, "Tap: Add G."),
    card("Elvish Mystic", "Creature — Elf Druid", 1, 4, "Tap: Add G."),
    card(
      "Priest of Titania",
      "Creature — Elf Druid",
      2,
      3,
      "Tap: Add G for each Elf on the battlefield.",
    ),
    card(
      "Elvish Archdruid",
      "Creature — Elf Druid",
      3,
      3,
      "Other Elf creatures get +1/+1. Tap: Add G for each Elf you control.",
    ),
    card(
      "Ezuri, Renegade Leader",
      "Legendary Creature — Elf Warrior",
      3,
      2,
      "Tap: Regenerate target Elf.",
    ),
    card(
      "Heritage Druid",
      "Creature — Elf Druid",
      1,
      3,
      "Tap three untapped Elves you control: Add GGG.",
    ),
    card(
      "Craterhoof Behemoth",
      "Creature — Beast",
      8,
      2,
      "When this enters, creatures you control gain trample and get +X/+X.",
    ),
    card("Nettle Sentinel", "Creature — Elf Warrior", 1, 4),
    card("Forest", "Basic Land — Forest", 0, 18),
    card(
      "Cultivate",
      "Sorcery",
      3,
      3,
      "Search your library for up to two basic land cards and put one onto the battlefield tapped.",
    ),
    card("Beast Within", "Instant", 3, 3, "Destroy target permanent."),
    card("Harmonize", "Sorcery", 4, 2, "Draw three cards."),
  ];
}

describe("buildStructuredDeckAnalysis", () => {
  const deck = buildElfRampDeck();
  // Synergy detection now runs through the AI Web Worker bridge (#1079), which
  // makes the builder async. The shared analysis is awaited once per describe
  // block via beforeAll so the individual assertions stay synchronous.
  let analysis: StructuredDeckAnalysis;

  beforeAll(async () => {
    analysis = await buildStructuredDeckAnalysis(deck);
  });

  it("returns a structured object, not a raw card list", () => {
    expect(analysis).not.toBeNull();
    expect(typeof analysis).toBe("object");
    // Must NOT be an array of card names (the pre-#923 behaviour).
    expect(Array.isArray(analysis)).toBe(false);
  });

  it("computes total card count across copies", () => {
    const expected = deck.reduce((sum, c) => sum + c.count, 0);
    expect(analysis.totalCards).toBe(expected);
  });

  it("produces a fixed-length mana curve (8 buckets)", () => {
    expect(Array.isArray(analysis.manaCurve)).toBe(true);
    expect(analysis.manaCurve).toHaveLength(8);
    expect(analysis.manaCurve.every((v) => typeof v === "number")).toBe(true);
  });

  it("identifies a non-empty archetype (reuses the archetype detector)", () => {
    expect(typeof analysis.archetype).toBe("string");
    expect(analysis.archetype.length).toBeGreaterThan(0);
    expect(analysis.archetypeConfidence).toBeGreaterThanOrEqual(0);
    expect(analysis.archetypeConfidence).toBeLessThanOrEqual(1);
  });

  it("builds a complete role distribution", () => {
    const r = analysis.roleDistribution;
    for (const key of [
      "threats",
      "ramp",
      "removal",
      "cardDraw",
      "disruption",
      "lands",
      "other",
    ] as const) {
      expect(r).toHaveProperty(key);
      expect(typeof r[key]).toBe("number");
    }
    // 18 forests accounted for.
    expect(r.lands).toBe(18);
    // Ramp sources: the mana dorks + Cultivate.
    expect(r.ramp).toBeGreaterThan(0);
    // Removal (Beast Within) + card draw (Harmonize) present.
    expect(r.removal).toBeGreaterThan(0);
    expect(r.cardDraw).toBeGreaterThan(0);
  });

  it("surfaces synergy clusters as structured objects", () => {
    expect(Array.isArray(analysis.synergyClusters)).toBe(true);
    for (const cluster of analysis.synergyClusters) {
      expect(cluster).toHaveProperty("name");
      expect(cluster).toHaveProperty("score");
      expect(Array.isArray(cluster.cards)).toBe(true);
    }
  });

  it("derives strengths and gaps as human-readable strings", () => {
    expect(Array.isArray(analysis.strengths)).toBe(true);
    expect(Array.isArray(analysis.gaps)).toBe(true);
    // An Elf-ramp deck should register at least one strength (ramp/creatures).
    expect(analysis.strengths.length + analysis.gaps.length).toBeGreaterThan(0);
  });

  it("selects key cards with role + reason", () => {
    expect(Array.isArray(analysis.keyCards)).toBe(true);
    expect(analysis.keyCards.length).toBeLessThanOrEqual(8);
    for (const k of analysis.keyCards) {
      expect(k).toHaveProperty("name");
      expect(k).toHaveProperty("role");
      expect(k).toHaveProperty("reason");
    }
  });

  it("handles an empty deck without throwing", async () => {
    const empty = await buildStructuredDeckAnalysis([]);
    expect(empty.totalCards).toBe(0);
    expect(empty.archetype).toBe("Unknown");
    expect(empty.synergyClusters).toEqual([]);
  });
});

describe("formatStructuredAnalysisForLLM", () => {
  const deck = buildElfRampDeck();
  let analysis: StructuredDeckAnalysis;
  let formatted: string;

  beforeAll(async () => {
    analysis = await buildStructuredDeckAnalysis(deck);
    formatted = formatStructuredAnalysisForLLM(analysis);
  });

  it("emits the structured header and key sections", () => {
    expect(formatted).toContain("### Structured Deck Analysis");
    expect(formatted).toContain("**Archetype**");
    expect(formatted).toContain("**Mana Curve**");
    expect(formatted).toContain("**Role Mix**");
    expect(formatted).toContain("cmc:");
  });

  it("does not emit a raw card-by-card decklist", () => {
    // The pre-#923 output listed each card as "Nx Name (cost)". The structured
    // output must not reproduce that flat list.
    expect(formatted).not.toMatch(/^\d+x .+ \(/m);
  });

  it("returns empty string for a falsy input", () => {
    expect(
      formatStructuredAnalysisForLLM(null as unknown as StructuredDeckAnalysis),
    ).toBe("");
  });
});
