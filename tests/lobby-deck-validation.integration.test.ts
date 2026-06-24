/**
 * Integration test: lobby deck validation pipeline.
 *
 * Exercises the multi-layer flow used by the multiplayer lobby:
 *   parsed decklist text
 *     -> decklist-utils.parseDecklist
 *     -> build a SavedDeck (deck-builder layer)
 *     -> format-validator.validateDeckForLobby / canPlayerJoinWithDeck
 *        (lobby layer, which internally delegates to game-rules.validateDeckFormat)
 *
 * This crosses three layers: parsing, deck construction, and lobby readiness.
 * Resolves issue #931.
 */

import { describe, it, expect } from "@jest/globals";

import { parseDecklist } from "@/lib/decklist-utils";
import {
  validateDeckForLobby,
  canPlayerJoinWithDeck,
  validateDeckForReadyStatus,
  getFormatRulesSummary,
} from "@/lib/format-validator";
import type { SavedDeck, DeckCard } from "@/app/actions";
import { buildDeckFromLines, type CardSpec } from "./helpers/cards";

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

function cardLookup(name: string): CardSpec {
  switch (name) {
    case "Lightning Bolt":
      return { name, cmc: 1, colors: ["R"], type_line: "Instant" };
    case "Lava Spike":
      return { name, cmc: 1, colors: ["R"], type_line: "Sorcery" };
    case "Rift Bolt":
      return { name, cmc: 2, colors: ["R"], type_line: "Sorcery" };
    case "Skullcrack":
      return { name, cmc: 2, colors: ["R"], type_line: "Instant" };
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

function buildSavedDeck(format: SavedDeck["format"]): SavedDeck {
  const parsed = parseDecklist(DECKLIST_60);
  const byName = new Map(buildDeckFromLines(DECKLIST_60.split("\n"), cardLookup).map((c) => [c.name, c]));
  const cards: DeckCard[] = parsed.map((p) => {
    const base = byName.get(p.name)!;
    return { ...base, count: p.quantity };
  });
  const now = new Date("2026-06-24T00:00:00.000Z").toISOString();
  return {
    id: "deck-burn-001",
    name: "Mono-Red Burn",
    format,
    cards,
    createdAt: now,
    updatedAt: now,
  };
}

describe("lobby deck validation pipeline (parse -> SavedDeck -> lobby readiness)", () => {
  const deck = buildSavedDeck("constructed-core");

  it("accepts a legal, format-matching deck for the lobby", () => {
    const result = validateDeckForLobby(deck, "constructed-core");
    expect(result.isValid).toBe(true);
    expect(result.canPlay).toBe(true);

    expect(canPlayerJoinWithDeck(deck, "constructed-core").canJoin).toBe(true);

    const ready = validateDeckForReadyStatus(deck, "constructed-core");
    expect(ready.isReady).toBe(true);
  });

  it("blocks joining when the deck format mismatches the lobby format", () => {
    // constructed-legacy has the same 60-card floor, so the deck is still
    // *legal* — but canPlay must be false because the formats don't match.
    const result = validateDeckForLobby(deck, "constructed-legacy");
    expect(result.isValid).toBe(true);
    expect(result.canPlay).toBe(false);
    // The lobby layer renders the lobby format via its display name ("Constructed Legacy").
    expect(result.warnings.some((w) => /but lobby is/i.test(w))).toBe(true);

    const join = canPlayerJoinWithDeck(deck, "constructed-legacy");
    expect(join.canJoin).toBe(false);
    expect(join.reason).toBeTruthy();

    const ready = validateDeckForReadyStatus(deck, "constructed-legacy");
    expect(ready.isReady).toBe(false);
  });

  it("refuses ready status when no deck is selected", () => {
    const ready = validateDeckForReadyStatus(null, "constructed-core");
    expect(ready.isReady).toBe(false);
    expect(ready.errors).toContain("No deck selected");
  });

  it("exposes a human-readable format rules summary through the lobby layer", () => {
    const summary = getFormatRulesSummary("constructed-core");
    expect(summary.formatName).toBe("Constructed Core");
    expect(summary.rules.length).toBeGreaterThan(0);
  });
});
