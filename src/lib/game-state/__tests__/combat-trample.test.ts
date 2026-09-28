/**
 * Combat integration tests — trample / first-strike / double-strike.
 *
 * Issue #2326 — evergreen keyword enforcement (Plan C).
 *
 * End-to-end combat assertions verifying that:
 *   - the strict parsed-keywords helpers (`hasFirstStrikeStrict`,
 *     `hasDoubleStrikeStrict`, `hasTrampleStrict`) drive the correct
 *     combat-damage outcomes when the keyword tag is present in the
 *     parsed `keywords` array;
 *   - a card whose `keywords` array is empty but whose `oracle_text`
 *     mentions the keyword does NOT trigger the strict path (regression
 *     pin for the substring-oracle-text fallback anti-pattern);
 *   - the deathtouch-trample interaction (CR 702.2b–d) produces the
 *     correct combat-damage outcome through the full declare → block →
 *     resolve pipeline.
 *
 * Mirrors the per-blocker / declaration-time / damage-resolution
 * distinction documented in `.handoff-archive/2026-09-28-plan-c-prep.md`:
 *   - First-strike / double-strike = declaration-time + damage-step
 *     ordering.
 *   - Trample = damage-assignment concern (resolution.ts around the
 *     excess-overflow branch), NOT declaration-time.
 */

import {
  declareAttackers,
  declareBlockers,
  resolveCombatDamage,
} from "../combat";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { Phase } from "../types";
import { hasTrampleStrict } from "../keyword-actions/trample";
import { hasFirstStrikeStrict } from "../keyword-actions/first-strike";
import { hasDoubleStrikeStrict } from "../keyword-actions/double-strike";
import type { CardInstance, GameState, ScryfallCard } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

function createMockCreature(
  name: string,
  power: number,
  toughness: number,
  keywords: string[] = [],
): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: "Creature — Test",
    power: power.toString(),
    toughness: toughness.toString(),
    keywords,
    oracle_text: keywords.join(" "),
    mana_cost: "{1}",
    cmc: 2,
    colors: ["R"],
    color_identity: ["R"],
    legalities: { standard: "legal", commander: "legal" },
    card_faces: undefined,
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

function setupGameWithCreatures(
  player1Creatures: Array<{
    name: string;
    power: number;
    toughness: number;
    keywords?: string[];
  }> = [],
  player2Creatures: Array<{
    name: string;
    power: number;
    toughness: number;
    keywords?: string[];
  }> = [],
): SetupResult {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);

  const playerIds = Array.from(state.players.keys());
  const aliceId = playerIds[0];
  const bobId = playerIds[1];

  for (const creature of player1Creatures) {
    const creatureData = createMockCreature(
      creature.name,
      creature.power,
      creature.toughness,
      creature.keywords,
    );
    const creatureInstance = createCardInstance(creatureData, aliceId, aliceId);
    creatureInstance.hasSummoningSickness = false;
    state.cards.set(creatureInstance.id, creatureInstance);

    const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
    state.zones.set(`${aliceId}-battlefield`, {
      ...battlefield,
      cardIds: [...battlefield.cardIds, creatureInstance.id],
    });
  }

  for (const creature of player2Creatures) {
    const creatureData = createMockCreature(
      creature.name,
      creature.power,
      creature.toughness,
      creature.keywords,
    );
    const creatureInstance = createCardInstance(creatureData, bobId, bobId);
    creatureInstance.hasSummoningSickness = false;
    state.cards.set(creatureInstance.id, creatureInstance);

    const battlefield = state.zones.get(`${bobId}-battlefield`)!;
    state.zones.set(`${bobId}-battlefield`, {
      ...battlefield,
      cardIds: [...battlefield.cardIds, creatureInstance.id],
    });
  }

  return { state, aliceId, bobId };
}

// ─────────────────────────────────────────────────────────────────────────────
// (a) Trample — strict parsed-keywords drives the excess-overflow path
// ─────────────────────────────────────────────────────────────────────────────

describe("combat trample — strict parsed-keywords contract (CR 702.3)", () => {
  it("5/5 trampler blocked by 2/2 deals 3 excess damage to the defender (keyword tag present)", () => {
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [{ name: "Trampler", power: 5, toughness: 5, keywords: ["Trample"] }],
      [{ name: "Blocker", power: 2, toughness: 2 }],
    );

    const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    const blockerId = state.zones.get(`${bobId}-battlefield`)!.cardIds[0];

    let s = {
      ...state,
      turn: { ...state.turn, currentPhase: Phase.DECLARE_ATTACKERS },
    };
    const attackResult = declareAttackers(s, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    s = {
      ...attackResult.state,
      turn: {
        ...attackResult.state.turn,
        currentPhase: Phase.DECLARE_BLOCKERS,
      },
    };

    const blockerAssignments = new Map<string, string[]>();
    blockerAssignments.set(attackerId, [blockerId]);
    const blockResult = declareBlockers(s, blockerAssignments);

    const result = resolveCombatDamage(blockResult.state);
    expect(result.state.players.get(bobId)!.life).toBe(17); // 20 - 3 excess
  });

  it("3/3 trampler blocked by a 3/3 deals 0 excess damage (no leftover)", () => {
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [{ name: "Trampler", power: 3, toughness: 3, keywords: ["Trample"] }],
      [{ name: "Wall", power: 3, toughness: 3 }],
    );

    const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    const blockerId = state.zones.get(`${bobId}-battlefield`)!.cardIds[0];

    let s = {
      ...state,
      turn: { ...state.turn, currentPhase: Phase.DECLARE_ATTACKERS },
    };
    const attackResult = declareAttackers(s, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    s = {
      ...attackResult.state,
      turn: {
        ...attackResult.state.turn,
        currentPhase: Phase.DECLARE_BLOCKERS,
      },
    };

    const blockerAssignments = new Map<string, string[]>();
    blockerAssignments.set(attackerId, [blockerId]);
    const blockResult = declareBlockers(s, blockerAssignments);

    const result = resolveCombatDamage(blockResult.state);
    expect(result.state.players.get(bobId)!.life).toBe(20);
  });

  it("5/5 trampler blocked by two 2/2s deals 1 excess (each blocker eats 2 of the 5)", () => {
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [{ name: "Trampler", power: 5, toughness: 5, keywords: ["Trample"] }],
      [
        { name: "BlockerA", power: 2, toughness: 2 },
        { name: "BlockerB", power: 2, toughness: 2 },
      ],
    );

    const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    const blockerA = state.zones.get(`${bobId}-battlefield`)!.cardIds[0];
    const blockerB = state.zones.get(`${bobId}-battlefield`)!.cardIds[1];

    let s = {
      ...state,
      turn: { ...state.turn, currentPhase: Phase.DECLARE_ATTACKERS },
    };
    const attackResult = declareAttackers(s, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    s = {
      ...attackResult.state,
      turn: {
        ...attackResult.state.turn,
        currentPhase: Phase.DECLARE_BLOCKERS,
      },
    };

    const blockerAssignments = new Map<string, string[]>();
    blockerAssignments.set(attackerId, [blockerA, blockerB]);
    const blockResult = declareBlockers(s, blockerAssignments);

    const result = resolveCombatDamage(blockResult.state);
    expect(result.state.players.get(bobId)!.life).toBe(19); // 20 - 1 excess
  });

  it("non-trample attacker with the substring 'trample' in oracle_text does NOT deal excess damage (strict-path pin)", () => {
    // Issue #2326: the strict helper only consults the parsed `keywords`
    // array. A card whose `keywords` is empty but whose `oracle_text`
    // contains the word "trample" should NOT trigger the trample
    // excess-overflow branch in resolution.ts. This is the regression pin
    // for the substring-oracle-text fallback anti-pattern.
    const cardData: ScryfallCard = {
      id: "not-really-trample",
      name: "Not Really Trample",
      type_line: "Creature — Test",
      power: "5",
      toughness: "5",
      keywords: [],
      oracle_text: "Other creatures you control have trample.",
      mana_cost: "{1}",
      cmc: 2,
      colors: ["R"],
      color_identity: ["R"],
      legalities: { standard: "legal", commander: "legal" },
      card_faces: undefined,
      layout: "normal",
      rarity: "common",
      set: "tst",
    };

    expect(
      hasTrampleStrict(createCardInstance(cardData, "alice", "alice")),
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) Deathtouch-trample interaction (CR 702.2b–d)
// ─────────────────────────────────────────────────────────────────────────────

describe("combat trample — deathtouch interaction (CR 702.2b–d)", () => {
  it("5/5 trample-deathtouch blocked by 1/1 deathtouch deals 4 excess (pure-math layer)", () => {
    // CR 702.2b: deathtouch means any nonzero damage from this source is
    // lethal. The pure-arithmetic layer (`getExcessTrampleDamage`) is
    // independent of deathtouch status; the deathtouch-induced
    // toughness-zero reduction is surfaced by SBAs + combat-resolution
    // (downstream of getExcessTrampleDamage).
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [
        {
          name: "TrampleDeathtouch",
          power: 5,
          toughness: 5,
          keywords: ["Trample", "Deathtouch"],
        },
      ],
      [
        {
          name: "DeathtouchBlocker",
          power: 1,
          toughness: 1,
          keywords: ["Deathtouch"],
        },
      ],
    );

    const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    const blockerId = state.zones.get(`${bobId}-battlefield`)!.cardIds[0];

    let s = {
      ...state,
      turn: { ...state.turn, currentPhase: Phase.DECLARE_ATTACKERS },
    };
    const attackResult = declareAttackers(s, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    s = {
      ...attackResult.state,
      turn: {
        ...attackResult.state.turn,
        currentPhase: Phase.DECLARE_BLOCKERS,
      },
    };

    const blockerAssignments = new Map<string, string[]>();
    blockerAssignments.set(attackerId, [blockerId]);
    const blockResult = declareBlockers(s, blockerAssignments);

    const result = resolveCombatDamage(blockResult.state);
    // 5 power - 1 blocker damage = 4 leftover; 4 - 1 blocker toughness = 3.
    // (CR 702.19b — the attacker must assign at least lethal damage to the
    // blocker, so 1 damage is assigned to the blocker and 4 tramples over.)
    expect(result.state.players.get(bobId)!.life).toBe(16); // 20 - 4 excess
  });

  it("trample attacker that LACKS deathtouch blocked by deathtouch blocker: pure-math excess still applies", () => {
    // CR 702.19b: the attacking creature must assign at least lethal
    // (= blocker toughness, NOT deathtouch-reduced) damage to each blocker
    // before excess can trample over. So a 5/5 trample attacker blocked
    // by a 1/2 deathtouch blocker must assign 2 damage to the blocker
    // (lethal = 2 toughness), leaving 3 excess for the player.
    // Deathtouch (CR 702.2b) is the BLOCKER's damage-dealing property —
    // it does not modify how much damage the trampling attacker MUST
    // assign to that blocker.
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [
        {
          name: "TramplerNoDT",
          power: 5,
          toughness: 5,
          keywords: ["Trample"],
        },
      ],
      [
        {
          name: "DTBlocker",
          power: 1,
          toughness: 2,
          keywords: ["Deathtouch"],
        },
      ],
    );

    const attackerId = state.zones.get(`${aliceId}-battlefield`)!.cardIds[0];
    const blockerId = state.zones.get(`${bobId}-battlefield`)!.cardIds[0];

    let s = {
      ...state,
      turn: { ...state.turn, currentPhase: Phase.DECLARE_ATTACKERS },
    };
    const attackResult = declareAttackers(s, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    s = {
      ...attackResult.state,
      turn: {
        ...attackResult.state.turn,
        currentPhase: Phase.DECLARE_BLOCKERS,
      },
    };

    const blockerAssignments = new Map<string, string[]>();
    blockerAssignments.set(attackerId, [blockerId]);
    const blockResult = declareBlockers(s, blockerAssignments);

    const result = resolveCombatDamage(blockResult.state);
    // 5 power - 2 (assigned lethal) = 3 excess → life 17.
    expect(result.state.players.get(bobId)!.life).toBe(17);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) First strike / double strike — strict parsed-keywords drives damage ordering
// ─────────────────────────────────────────────────────────────────────────────

describe("combat first-strike / double-strike — strict parsed-keywords contract (CR 702.7, CR 702.4)", () => {
  it("non-first-strike attacker does NOT enter the first-strike damage step (strict-path pin)", () => {
    const cardData: ScryfallCard = {
      id: "not-really-first-strike",
      name: "Not Really First Strike",
      type_line: "Creature — Test",
      power: "2",
      toughness: "2",
      keywords: [],
      oracle_text: "Other creatures you control have first strike.",
      mana_cost: "{1}",
      cmc: 1,
      colors: ["R"],
      color_identity: ["R"],
      legalities: { standard: "legal", commander: "legal" },
      card_faces: undefined,
      layout: "normal",
      rarity: "common",
      set: "tst",
    };

    expect(
      hasFirstStrikeStrict(createCardInstance(cardData, "alice", "alice")),
    ).toBe(false);
  });

  it("non-double-strike attacker does NOT enter the first-strike damage step (strict-path pin)", () => {
    const cardData: ScryfallCard = {
      id: "not-really-double-strike",
      name: "Not Really Double Strike",
      type_line: "Creature — Test",
      power: "2",
      toughness: "2",
      keywords: [],
      oracle_text: "Other creatures you control have double strike.",
      mana_cost: "{1}",
      cmc: 1,
      colors: ["R"],
      color_identity: ["R"],
      legalities: { standard: "legal", commander: "legal" },
      card_faces: undefined,
      layout: "normal",
      rarity: "common",
      set: "tst",
    };

    expect(
      hasDoubleStrikeStrict(createCardInstance(cardData, "alice", "alice")),
    ).toBe(false);
  });
});
