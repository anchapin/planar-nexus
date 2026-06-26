/**
 * AI Worker — synergy detection handler tests (#1079)
 *
 * Asserts the `detectSynergies` handler exposed by the AI Web Worker:
 *  - returns results IDENTICAL to the in-thread detector (parity / no behavior
 *    change) across tribal, multi-synergy, stress and empty decks;
 *  - honors `minScore` and `maxResults`;
 *  - returns an empty list (not an error) for decks with no detectable
 *    synergies.
 *
 * The handler object is imported directly (Comlink.expose is a no-op side
 * effect under jsdom), which is exactly the code that runs inside the worker.
 */
import { describe, test, expect } from "@jest/globals";

import { aiWorker } from "../ai-worker";
import { detectSynergies } from "../../synergy-detector";
import type { SynergyResult } from "../../synergy-detector";
import type { DeckCard } from "@/app/actions";

function makeCard(
  name: string,
  typeLine: string,
  count: number,
  oracle = "",
  cmc = 2,
): DeckCard {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    cmc,
    type_line: typeLine,
    colors: ["G"],
    color_identity: ["G"],
    legalities: {},
    count,
    oracle_text: oracle,
  };
}

/** A dense Elf-ramp deck that triggers tribal + ramp + card-draw synergies. */
function buildElfRampDeck(): DeckCard[] {
  return [
    makeCard("Llanowar Elves", "Creature — Elf Druid", 4, "Tap: Add G.", 1),
    makeCard("Elvish Mystic", "Creature — Elf Druid", 4, "Tap: Add G.", 1),
    makeCard(
      "Elvish Archdruid",
      "Creature — Elf Druid",
      3,
      "Other Elf creatures get +1/+1. Tap: Add G for each Elf you control.",
      3,
    ),
    makeCard("Heritage Druid", "Creature — Elf Druid", 3, "", 1),
    makeCard("Nettle Sentinel", "Creature — Elf Warrior", 4, "", 1),
    makeCard("Ezuri, Renegade Leader", "Legendary Creature — Elf", 2, "", 3),
    makeCard(
      "Craterhoof Behemoth",
      "Creature — Beast",
      2,
      "When this enters, creatures you control gain trample.",
      8,
    ),
    makeCard(
      "Cultivate",
      "Sorcery",
      3,
      "Search your library for up to two basic land cards. You may put one onto the battlefield tapped.",
      3,
    ),
    makeCard("Harmonize", "Sorcery", 2, "Draw three cards.", 4),
    makeCard("Forest", "Basic Land — Forest", 18, "", 0),
  ];
}

describe("AI Worker — detectSynergies handler (#1079)", () => {
  test("returns identical results to the in-thread detector (Elf-ramp deck)", async () => {
    const deck = buildElfRampDeck();

    const expected = detectSynergies(deck);
    const result = await aiWorker.detectSynergies({ deck });

    // Deep equality — the worker path must not alter scores or ordering.
    expect(result).toEqual(expected);
    expect(result.length).toBe(expected.length);
    // The Elf deck should surface at least one synergy on both paths.
    expect(result.length).toBeGreaterThan(0);
  });

  test("results stay sorted by score descending after the round-trip", async () => {
    const deck = buildElfRampDeck();

    const result = await aiWorker.detectSynergies({ deck });

    const scores = result.map((s) => s.score);
    const sorted = [...scores].sort((a, b) => b - a);
    expect(scores).toEqual(sorted);
  });

  test("honors minScore identically to the in-thread detector", async () => {
    const deck = buildElfRampDeck();

    for (const minScore of [0, 30, 60, 90]) {
      const expected = detectSynergies(deck, minScore);
      const result = await aiWorker.detectSynergies({ deck, minScore });
      expect(result).toEqual(expected);
      for (const s of result) expect(s.score).toBeGreaterThanOrEqual(minScore);
    }
  });

  test("honors maxResults identically to the in-thread detector", async () => {
    const deck = buildElfRampDeck();

    for (const maxResults of [1, 3, 50]) {
      const expected = detectSynergies(deck, undefined, maxResults);
      const result = await aiWorker.detectSynergies({
        deck,
        maxResults,
      });
      expect(result).toEqual(expected);
      expect(result.length).toBeLessThanOrEqual(maxResults);
    }
  });

  test("returns identical results for a multi-synergy board", async () => {
    // Mix tribal (goblins), removal, card draw and ramp signals so several
    // distinct synergies register simultaneously. A low minScore lets multiple
    // clusters surface (their raw scores get reduced by the minimumCards
    // penalty); parity must hold regardless of threshold.
    const deck: DeckCard[] = [
      makeCard("Goblin Guide", "Creature — Goblin Warrior", 4, "Haste", 1),
      makeCard(
        "Goblin Chieftain",
        "Creature — Goblin",
        3,
        "Other Goblins get +1/+1.",
        3,
      ),
      makeCard("Krenko, Mob Boss", "Legendary Creature — Goblin", 2, "", 4),
      makeCard(
        "Lightning Bolt",
        "Instant",
        4,
        "Lightning Bolt deals 3 damage to any target.",
        1,
      ),
      makeCard("Murder", "Instant", 3, "Destroy target creature.", 3),
      makeCard("Divination", "Sorcery", 3, "Draw two cards.", 3),
      makeCard(
        "Rampant Growth",
        "Sorcery",
        4,
        "Search your library for a basic land card.",
        2,
      ),
      makeCard("Mountain", "Basic Land — Mountain", 18, "", 0),
    ];

    const minScore = 0;
    const expected = detectSynergies(deck, minScore);
    const result = await aiWorker.detectSynergies({ deck, minScore });

    expect(result).toEqual(expected);
    expect(result.length).toBeGreaterThan(1);
  });

  test("returns an empty list (no error) for an empty deck", async () => {
    const expected = detectSynergies([]);
    const result = await aiWorker.detectSynergies({ deck: [] });

    expect(result).toEqual(expected);
    expect(result).toHaveLength(0);
  });

  test("returns an empty list (no error) for a deck with no detectable synergies", async () => {
    // Vanilla cards with no synergy-bearing keywords/types → nothing scores.
    const deck: DeckCard[] = [
      makeCard("Vanilla Bear", "Creature — Bear", 10, "", 2),
      makeCard("Forest", "Basic Land — Forest", 12, "", 0),
    ];

    const expected = detectSynergies(deck);
    const result = await aiWorker.detectSynergies({ deck });

    expect(result).toEqual(expected);
    expect(result).toHaveLength(0);
  });

  test("STRESS FIXTURE: 100-card deck stays identical between worker and main thread", async () => {
    // Documents the stress deck used to validate offloading (#1079 parity).
    // Real 60fps measurement requires a browser; this test guarantees the
    // worker returns byte-for-byte the same synergy set on a heavy deck so
    // offloading is behavior-preserving. See PR body for the perf rationale.
    const cardNames = [
      "Llanowar Elves",
      "Elvish Archdruid",
      "Goblin Chieftain",
      "Craterhoof Behemoth",
      "Harmonize",
      "Rampant Growth",
    ];
    const deck: DeckCard[] = Array.from({ length: 100 }, (_, i) =>
      makeCard(
        `${cardNames[i % cardNames.length]} ${i}`,
        "Creature",
        1,
        "draw a card",
      ),
    );

    const expected = detectSynergies(deck);
    const result = await aiWorker.detectSynergies({ deck });

    expect(result).toEqual(expected);
    expect(result.length).toBe(expected.length);
  });

  test("returned results are the SynergyResult shape (no shape drift)", async () => {
    const deck = buildElfRampDeck();
    const result = (await aiWorker.detectSynergies({
      deck,
    })) as SynergyResult[];

    for (const s of result) {
      expect(typeof s.name).toBe("string");
      expect(typeof s.score).toBe("number");
      expect(Array.isArray(s.cards)).toBe(true);
      expect(typeof s.description).toBe("string");
      expect(typeof s.category).toBe("string");
    }
  });
});
