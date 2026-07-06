/**
 * AI Worker — `prepareCoachContext` handler tests (issue #1236).
 *
 * Issue #1236: the digest used to ship only deck stats + key cards. For
 * large/Commander decks (the default format in the coach hook) the route had
 * no archetype / synergy / role / curve data to feed the model, so the
 * 100-card path received strictly weaker grounding than a 20-card sketch —
 * defeating #923 for exactly the decks that need it most.
 *
 * These tests assert the worker's digest now pre-computes the full structured
 * analysis (`archetype` + `synergy clusters` + `role mix` + `gaps`) and ships
 * it as `structuredAnalysisText` on the digest — the same markdown block the
 * route would otherwise rebuild from raw cards.
 *
 * The handler object is imported directly (Comlink.expose is a no-op side
 * effect under jsdom), which is exactly the code that runs inside the worker.
 */
import { describe, test, expect } from "@jest/globals";

import { aiWorker } from "../ai-worker";
import type { DeckCard } from "@/app/actions";

function makeCard(
  name: string,
  typeLine: string,
  count: number,
  oracle = "",
  cmc = 2,
  colors: string[] = ["G"],
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
    makeCard(
      "Heritage Druid",
      "Creature — Elf Druid",
      4,
      "Tap three untapped Elves you control: Add GGG.",
      2,
    ),
    makeCard(
      "Ezuri, Renegade Leader",
      "Creature — Elf Warrior",
      2,
      "Other Elf creatures get +X/+X where X is the number of Elves you control.",
      3,
    ),
    makeCard(
      "Craterhoof Behemoth",
      "Creature — Elk Beast",
      1,
      "Haste. Other creatures you control get +X/+X and trample until end of turn.",
      8,
    ),
    makeCard(
      "Shaman of the Pack",
      "Creature — Elf Shaman",
      2,
      "When Shaman of the Pack enters, target opponent loses life equal to the number of Elves you control.",
      3,
    ),
    makeCard(
      "Forest",
      "Basic Land — Forest",
      20,
      "",
      0,
      [],
    ),
  ];
}

describe("aiWorker.prepareCoachContext — structured analysis in digest (#1236)", () => {
  test("populates structuredAnalysisText alongside the deck summary", async () => {
    const digest = await aiWorker.prepareCoachContext({
      deck: buildElfRampDeck(),
    });

    // The lightweight stats + key cards path still works.
    expect(digest.deckSummary).toBeDefined();
    expect(digest.deckSummary?.totalCards).toBeGreaterThan(0);
    expect(digest.structuredAnalysisText).toBeDefined();
    expect(typeof digest.structuredAnalysisText).toBe("string");

    // Same shape as `formatStructuredAnalysisForLLM` output (#923/#928):
    // the model relies on these headings to ground its advice.
    const text = digest.structuredAnalysisText as string;
    expect(text).toContain("Structured Deck Analysis");
    expect(text).toContain("Archetype");
    expect(text).toContain("Mana Curve");
    expect(text).toContain("Role Mix");
    // The Elf-ramp deck must surface its key synergy clusters so the coach
    // can advise on tribal strategies — not just "deck stats".
    expect(text).toContain("Synergy Clusters");
  });

  test("structuredAnalysisText is absent for empty digests", async () => {
    const digest = await aiWorker.prepareCoachContext({ deck: [] });
    expect(digest.deckSummary).toBeUndefined();
    expect(digest.structuredAnalysisText).toBeUndefined();
    expect(typeof digest.timestamp).toBe("number");
  });

  test("preserves gameSummary alongside structuredAnalysisText", async () => {
    const gameState = {
      players: {
        "p1": {
          id: "p1",
          life: 20,
          hand: [],
          battlefield: [],
          graveyard: [],
          library: [],
          manaPool: {},
          commanderDamage: {},
        },
      },
      turnInfo: {
        activePlayerId: "p1",
        currentTurn: 1,
        currentPlayer: "p1",
        phase: "main",
        step: "main",
      },
      stack: [],
    };

    const digest = await aiWorker.prepareCoachContext({
      deck: buildElfRampDeck(),
      gameState: gameState as never,
      playerId: "p1",
    });

    expect(digest.gameSummary).toBeDefined();
    expect(digest.gameSummary?.players[0].id).toBe("p1");
    expect(digest.structuredAnalysisText).toBeDefined();
    expect(digest.structuredAnalysisText).toContain("Structured Deck Analysis");
  });
});