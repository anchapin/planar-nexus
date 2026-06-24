/**
 * Integration test: deck construction pipeline.
 *
 * Exercises the real cross-module flow a user triggers when building a deck:
 *   decklist text
 *     -> decklist-utils.parseDecklist (parsing + format detection)
 *     -> game-rules.validateDeckFormat (constructed format legality)
 *     -> deck-analyzer.analyzeDeck (heuristic mana-curve / color / type analysis)
 *
 * Nothing is mocked — the three modules are wired together the same way the
 * deck-builder UI wires them. Resolves issue #931.
 */

import { describe, it, expect } from "@jest/globals";

import { parseDecklist, detectDecklistFormat } from "@/lib/decklist-utils";
import { validateDeckFormat, type Format } from "@/lib/game-rules";
import { analyzeDeck } from "@/lib/deck-analyzer";
import type { DeckCard } from "@/app/actions";
import { makeCard, buildDeckFromLines, type CardSpec } from "./helpers/cards";

// A legal 60-card mono-red constructed decklist (9 playsets + 24 Mountains).
const DECKLIST_60 = [
  "4 Lightning Bolt",
  "4 Lava Spike",
  "4 Rift Bolt",
  "4 Skullcrack",
  "4 Monastery Swiftspear",
  "4 Goblin Guide",
  "4 Eidolon of the Great Revel",
  "4 Boggart Ram-Gang",
  "4 Kird Ape",
  "24 Mountain",
].join("\n");

/** Name -> card spec lookup so parsed quantities attach to rich card data. */
function cardLookup(name: string): CardSpec {
  switch (name) {
    case "Lightning Bolt":
      return {
        name,
        cmc: 1,
        colors: ["R"],
        type_line: "Instant",
        oracle_text: "Lightning Bolt deals 3 damage to any target.",
      };
    case "Lava Spike":
      return { name, cmc: 1, colors: ["R"], type_line: "Sorcery", oracle_text: "Lava Spike deals 3 damage to target player or planeswalker." };
    case "Rift Bolt":
      return { name, cmc: 2, colors: ["R"], type_line: "Sorcery", oracle_text: "Rift Bolt deals 3 damage to any target." };
    case "Skullcrack":
      return { name, cmc: 2, colors: ["R"], type_line: "Instant", oracle_text: "Damage can't be prevented this turn." };
    case "Monastery Swiftspear":
      return { name, cmc: 1, colors: ["R"], type_line: "Creature — Human Monk" };
    case "Goblin Guide":
      return { name, cmc: 1, colors: ["R"], type_line: "Creature — Goblin Scout" };
    case "Eidolon of the Great Revel":
      return { name, cmc: 2, colors: ["R"], type_line: "Creature — Spirit" };
    case "Boggart Ram-Gang":
      return { name, cmc: 3, colors: ["R", "G"], type_line: "Creature — Goblin Warrior" };
    case "Kird Ape":
      return { name, cmc: 1, colors: ["R"], type_line: "Creature — Ape" };
    case "Mountain":
      return { name, cmc: 0, colors: [], type_line: "Basic Land — Mountain" };
    default:
      return { name, cmc: 2, colors: ["R"], type_line: "Creature" };
  }
}

const CONSTRUCTED: Format = "constructed-core";

describe("deck construction pipeline (parse -> validate -> analyze)", () => {
  it("parses the decklist into the expected card set and detects MTGO-style format", () => {
    const parsed = parseDecklist(DECKLIST_60);
    expect(parsed).toHaveLength(10);
    const total = parsed.reduce((sum, c) => sum + c.quantity, 0);
    expect(total).toBe(60);
    expect(parsed.find((c) => c.name === "Mountain")?.quantity).toBe(24);

    // detectDecklistFormat sees leading "<count> <Name>" lines as MTGO format.
    expect(detectDecklistFormat(DECKLIST_60)).toBe("mtgo");
  });

  it("validates a legal 60-card deck as legal for constructed-core", () => {
    const cards = buildDeckFromLines(DECKLIST_60.split("\n"), cardLookup);
    const result = validateDeckFormat(
      cards.map((c) => ({
        name: c.name,
        count: c.count,
        color_identity: c.color_identity,
        type_line: c.type_line,
      })),
      CONSTRUCTED,
    );

    expect(result.isValid).toBe(true);
    expect(result.format).toBe(CONSTRUCTED);
    expect(result.deckSize).toBe(60);
    expect(result.requiredSize).toBe(60);
    expect(result.errors).toEqual([]);
  });

  it("rejects an undersized deck with a descriptive minimum-card error", () => {
    const undersized: DeckCard[] = [makeCard({ ...cardLookup("Mountain"), count: 24 })];
    const result = validateDeckFormat(
      undersized.map((c) => ({
        name: c.name,
        count: c.count,
        color_identity: c.color_identity,
        type_line: c.type_line,
      })),
      CONSTRUCTED,
    );

    expect(result.isValid).toBe(false);
    expect(result.deckSize).toBe(24);
    expect(result.errors.some((e) => /at least 60/i.test(e))).toBe(true);
  });

  it("analyzes the legal deck and reports a coherent mana curve, color, and type breakdown", () => {
    const cards = buildDeckFromLines(DECKLIST_60.split("\n"), cardLookup);
    const analysis = analyzeDeck(cards, CONSTRUCTED);

    // Overall rating is always clamped to 1..10.
    expect(analysis.overallRating).toBeGreaterThanOrEqual(1);
    expect(analysis.overallRating).toBeLessThanOrEqual(10);

    // 36 non-land cards with a total CMC of 56 -> average ~= 1.555...
    const totalNonLandCmc =
      1 * 4 + // Lightning Bolt
      1 * 4 + // Lava Spike
      2 * 4 + // Rift Bolt
      2 * 4 + // Skullcrack
      1 * 4 + // Monastery Swiftspear
      1 * 4 + // Goblin Guide
      2 * 4 + // Eidolon
      3 * 4 + // Boggart Ram-Gang
      1 * 4; //  Kird Ape
    expect(analysis.manaCurve.averageCMC).toBeCloseTo(totalNonLandCmc / 36, 5);

    // Type counts flow straight from type_line classification.
    expect(analysis.cardTypeDistribution.lands).toBe(24);
    expect(analysis.cardTypeDistribution.spells).toBe(16); // 4 instants + 12 sorceries
    expect(analysis.cardTypeDistribution.creatures).toBe(20);

    // Red everywhere, plus green pip from Boggart Ram-Gang -> two colors.
    expect(analysis.colorDistribution.colorCount).toBe(2);
    expect(analysis.colorDistribution.colors.R).toBeGreaterThan(0);
    expect(analysis.colorDistribution.colors.G).toBeGreaterThan(0);

    // The analyzer always emits at least an empty suggestions array of the right shape.
    expect(Array.isArray(analysis.suggestions)).toBe(true);
    for (const s of analysis.suggestions) {
      expect(["high", "medium", "low"]).toContain(s.priority);
    }
  });
});
