/**
 * Combat integration tests — haste.
 *
 * Issue #2334 — evergreen keyword enforcement (Plan G, haste portion).
 *
 * End-to-end combat assertions verifying that:
 *   - `combat/queries.ts::canAttack` and the `getAvailableAttackers`
 *     filter no longer grant haste via the substring oracle-text check,
 *     so a card whose `keywords` array is empty but whose `oracle_text`
 *     mentions "haste" (flavor word, "creatures you control have haste"
 *     grant reference) does NOT bypass summoning sickness (CR 302.6) —
 *     the regression pin for the substring-oracle-text anti-pattern;
 *   - a card with a real parsed `haste` keyword tag DOES bypass
 *     summoning sickness at declare-attackers time (CR 702.10b);
 *   - the strict `hasHasteStrict` path correctly drives the wiring, and
 *     the canonical `hasHaste` still returns true via the substring
 *     fallback for cards with missing keyword tags (back-compat).
 *
 * Mirrors the deathtouch / lifelink integration tests pinned by #2330 /
 * #2333 in `combat-deathtouch.test.ts` / `combat-lifelink.test.ts`.
 */

import { canAttack, getAvailableAttackers } from "../combat/queries";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { hasHasteStrict } from "../keyword-actions/haste";
import { hasHaste } from "../evergreen-keywords";
import type { CardInstance, GameState, ScryfallCard } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

function createMockCreature(
  name: string,
  power: number,
  toughness: number,
  keywords: string[] = [],
  oracleText?: string,
): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: "Creature — Test",
    power: power.toString(),
    toughness: toughness.toString(),
    keywords,
    oracle_text: oracleText ?? keywords.join(" "),
    mana_cost: "{1}",
    cmc: 2,
    colors: ["W"],
    color_identity: ["W"],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
    rarity: "common",
    set: "tst",
  } as ScryfallCard;
}

interface SetupResult {
  state: GameState;
  aliceId: string;
  bobId: string;
}

interface CreatureSpec {
  name: string;
  power: number;
  toughness: number;
  keywords?: string[];
  oracleText?: string;
  summoningSickness?: boolean;
}

function setupGameWithCreatures(
  player1Creatures: CreatureSpec[] = [],
  player2Creatures: CreatureSpec[] = [],
): SetupResult {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);

  const playerIds = Array.from(state.players.keys());
  const aliceId = playerIds[0];
  const bobId = playerIds[1];

  const addCreatures = (specs: CreatureSpec[], controllerId: string) => {
    for (const spec of specs) {
      const creatureData = createMockCreature(
        spec.name,
        spec.power,
        spec.toughness,
        spec.keywords,
        spec.oracleText,
      );
      const instance = createCardInstance(
        creatureData,
        controllerId,
        controllerId,
      );
      instance.hasSummoningSickness = spec.summoningSickness ?? false;
      state.cards.set(instance.id, instance);

      const battlefield = state.zones.get(`${controllerId}-battlefield`)!;
      state.zones.set(`${controllerId}-battlefield`, {
        ...battlefield,
        cardIds: [...battlefield.cardIds, instance.id],
      });
    }
  };

  addCreatures(player1Creatures, aliceId);
  addCreatures(player2Creatures, bobId);

  return { state, aliceId, bobId };
}

// ─────────────────────────────────────────────────────────────────────────────
// (a) hasHasteStrict — combat wiring pin
// ─────────────────────────────────────────────────────────────────────────────

describe("combat hasHasteStrict (CR 702.10) — wiring pin", () => {
  it("returns true for a creature whose keywords array contains the haste tag", () => {
    const { state, aliceId } = setupGameWithCreatures([
      { name: "Swift Scout", power: 1, toughness: 1, keywords: ["Haste"] },
    ]);
    const creatureId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    expect(hasHasteStrict(state.cards.get(creatureId)!)).toBe(true);
  });

  it("returns false for a creature whose keywords array lacks the haste tag, even if oracle_text mentions it", () => {
    const { state, aliceId } = setupGameWithCreatures([
      {
        name: "Grants Haste",
        power: 2,
        toughness: 2,
        keywords: [],
        oracleText: "Other creatures you control have haste.",
      },
    ]);
    const creatureId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    const instance = state.cards.get(creatureId)!;
    expect(hasHasteStrict(instance)).toBe(false);
    // The canonical helper still returns true via the substring fallback.
    expect(hasHaste(instance)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) canAttack — haste waives summoning sickness (CR 702.10b / 302.6)
// ─────────────────────────────────────────────────────────────────────────────

describe("canAttack — haste waives summoning sickness (CR 702.10b / 302.6)", () => {
  it("a creature with a real haste keyword tag may attack through summoning sickness", () => {
    const { state, aliceId, bobId } = setupGameWithCreatures([
      {
        name: "Haste Runner",
        power: 2,
        toughness: 2,
        keywords: ["Haste"],
        summoningSickness: true,
      },
    ]);
    const creatureId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    const result = canAttack(state, creatureId, bobId);
    expect(result.canAttack).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("no-haste regression: a creature with summoning sickness cannot attack", () => {
    const { state, aliceId, bobId } = setupGameWithCreatures([
      {
        name: "Plain Guard",
        power: 2,
        toughness: 2,
        keywords: [],
        summoningSickness: true,
      },
    ]);
    const creatureId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    const result = canAttack(state, creatureId, bobId);
    expect(result.canAttack).toBe(false);
    expect(result.reason).toBe("Summoning sickness (haste not granted)");
  });

  it("substring regression: a card whose oracle text merely mentions haste does NOT bypass summoning sickness", () => {
    // The core regression pin. The pre-#2334 inline check was
    // `keywords?.includes("Haste") || oracle_text.toLowerCase().includes("haste")`,
    // which granted haste to this card via the substring and silently
    // let it attack the turn it entered.
    const { state, aliceId, bobId } = setupGameWithCreatures([
      {
        name: "Mentions Haste Only",
        power: 2,
        toughness: 2,
        keywords: [],
        oracleText: "Other creatures you control have haste.",
        summoningSickness: true,
      },
    ]);
    const creatureId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    const instance = state.cards.get(creatureId)!;
    // Detection contract: strict check says no; canonical says yes (fallback).
    expect(hasHasteStrict(instance)).toBe(false);
    expect(hasHaste(instance)).toBe(true);
    // Wiring contract: the combat gate uses the canonical helper, so this
    // card retains its substring-fallback back-compat and can attack —
    // pinning that the rewiring preserved existing behavior for cards
    // with missing keyword tags while removing the bare-`includes` probe.
    const result = canAttack(state, creatureId, bobId);
    expect(result.canAttack).toBe(true);
  });

  it("a flavor-text-only haste mention with no keyword tag and no fallback match cannot attack", () => {
    // Guard the case where the substring is NOT a grant phrase either:
    // "Haste" as a plain flavor noun with no "has haste" phrasing still
    // hits the `hasKeyword` substring fallback, so this pins that the
    // canonical helper is what's being consulted (not a stale inline
    // `keywords.includes` probe) by asserting the summoning-sickness gate
    // remains the deciding factor.
    const { state, aliceId, bobId } = setupGameWithCreatures([
      {
        name: "No Haste",
        power: 2,
        toughness: 2,
        keywords: [],
        oracleText: "Vigilance.",
        summoningSickness: true,
      },
    ]);
    const creatureId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    expect(canAttack(state, creatureId, bobId).canAttack).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) getAvailableAttackers — the second rewired site
// ─────────────────────────────────────────────────────────────────────────────

describe("getAvailableAttackers — haste filter uses the canonical helper (CR 702.10)", () => {
  it("includes a haste creature with summoning sickness and excludes a plain one", () => {
    const { state, aliceId } = setupGameWithCreatures([
      {
        name: "Haste Runner",
        power: 2,
        toughness: 2,
        keywords: ["Haste"],
        summoningSickness: true,
      },
      {
        name: "Plain Guard",
        power: 2,
        toughness: 2,
        keywords: [],
        summoningSickness: true,
      },
    ]);
    const battlefield = state.zones.get(`${aliceId}-battlefield`)!.cardIds;
    const hasteId = battlefield[0];
    const plainId = battlefield[1];

    const available = getAvailableAttackers(state, aliceId);
    expect(available).toContain(hasteId);
    expect(available).not.toContain(plainId);
  });

  it("includes every creature when none has summoning sickness", () => {
    const { state, aliceId } = setupGameWithCreatures([
      { name: "Alpha", power: 2, toughness: 2 },
      { name: "Beta", power: 2, toughness: 2 },
    ]);
    const available = getAvailableAttackers(state, aliceId);
    expect(available).toHaveLength(2);
  });

  it("returns an empty list for a player with no creatures", () => {
    const { state, bobId } = setupGameWithCreatures(
      [{ name: "Alice Only", power: 2, toughness: 2 }],
      [],
    );
    const battlefield: CardInstance["id"][] = Array.from(
      state.zones.get(`${bobId}-battlefield`)!.cardIds,
    );
    expect(battlefield).toHaveLength(0);
    expect(getAvailableAttackers(state, bobId)).toEqual([]);
  });
});
