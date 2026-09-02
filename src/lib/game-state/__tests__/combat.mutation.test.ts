/**
 * Mutation-targeted edge cases for `combat.ts`.
 *
 * Issue #1597: Stryker mutation suite for the CR 510 combat-resolution code.
 * These tests pin down the ordering- and boundary-sensitive mutants Stryker
 * would otherwise report as surviving:
 *
 *  - Deathtouch + trample damage assignment (CR 702.2b / 702.19b): a
 *    deathtouch attacker assigns only 1 damage per blocker (any nonzero
 *    amount is lethal); a non-deathtouch attacker must assign full lethal.
 *  - Double-strike lifelink / commander damage math uses the attacker's
 *    power per damage step (not a doubled "total damage" figure).
 *  - Multi-blocker attacker damage-assignment ordering (CR 510.1c): lethal
 *    is assigned to the first blocker in the announced order before the
 *    next; overflow is lost without trample.
 *  - First-strike vs regular damage-step separation (CR 702.4b, #969):
 *    which attackers/blockers act in which step, and dead creatures never
 *    deal damage again.
 *  - Declaration validation: menace minimum (CR 702.70), phase gating,
 *    flying/reach, protection (CR 702.16d), landwalk (CR 702.14).
 *
 * (Banding/flanking have no resolution logic in combat.ts — flanking is a
 * trigger handled outside this module — so no banding/flanking cases.)
 */

import {
  canAttack,
  canBlock,
  declareAttackers,
  declareBlockers,
  setDamageAssignmentOrder,
  resolveCombatDamage,
  type CombatActionResult,
} from "../combat";
import { createInitialGameState, startGame } from "../game-state";
import {
  createCardInstance,
  initializePlaneswalkerLoyalty,
} from "../card-instance";
import { Phase, type CardInstanceId, type GameState } from "../types";
import type { ScryfallCard } from "@/lib/card-database";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface CreatureSpec {
  name: string;
  power: number;
  toughness: number;
  keywords?: string[];
  /** Override the type line (e.g. "Legendary Creature — X"). */
  typeLine?: string;
  /** Override oracle text (e.g. "protection from red"). */
  oracleText?: string;
  /** Override card colors (defaults to ["R"]). */
  colors?: string[];
}

function mkCreature(spec: CreatureSpec): ScryfallCard {
  return {
    id: `mock-${spec.name.toLowerCase().replace(/\s+/g, "-")}`,
    name: spec.name,
    type_line: spec.typeLine ?? `Creature — Test`,
    power: spec.power != null ? spec.power.toString() : undefined,
    toughness: spec.toughness != null ? spec.toughness.toString() : undefined,
    keywords: spec.keywords ?? [],
    oracle_text: spec.oracleText ?? (spec.keywords ?? []).join(" "),
    mana_cost: "{1}",
    cmc: 2,
    colors: spec.colors ?? ["R"],
    color_identity: spec.colors ?? ["R"],
    legalities: { standard: "legal", commander: "legal" },
    card_faces: undefined,
    layout: "normal",
  } as unknown as ScryfallCard;
}

function addToBattlefield(
  state: GameState,
  cardData: ScryfallCard,
  controllerId: CardInstanceId | string,
): CardInstanceId {
  const instance = createCardInstance(
    cardData,
    controllerId as CardInstanceId,
    controllerId as CardInstanceId,
  );
  instance.hasSummoningSickness = false;
  state.cards.set(instance.id, instance);
  const battlefield = state.zones.get(`${controllerId}-battlefield`)!;
  state.zones.set(`${controllerId}-battlefield`, {
    ...battlefield,
    cardIds: [...battlefield.cardIds, instance.id],
  });
  return instance.id;
}

function setupGame(
  player1Creatures: CreatureSpec[] = [],
  player2Creatures: CreatureSpec[] = [],
): { state: GameState; aliceId: string; bobId: string } {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);

  const playerIds = Array.from(state.players.keys());
  const aliceId = playerIds[0];
  const bobId = playerIds[1];

  for (const spec of player1Creatures) {
    addToBattlefield(state, mkCreature(spec), aliceId);
  }
  for (const spec of player2Creatures) {
    addToBattlefield(state, mkCreature(spec), bobId);
  }

  return { state, aliceId, bobId };
}

/** Declare one attacker + its blockers, returning the post-declaration state. */
function declareCombat(
  state: GameState,
  attackerId: CardInstanceId,
  defenderId: string,
  blockerIds: CardInstanceId[],
): CombatActionResult {
  state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
  const attackResult = declareAttackers(state, [
    { cardId: attackerId, defenderId },
  ]);
  if (!attackResult.success) {
    throw new Error(`declareAttackers failed: ${attackResult.errors}`);
  }
  attackResult.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;
  return declareBlockers(
    attackResult.state,
    new Map([[attackerId, blockerIds]]),
  );
}

/** Run the first-strike step, then the regular damage step. */
function runBothDamageSteps(state: GameState): {
  firstStrike: CombatActionResult;
  regular: CombatActionResult;
} {
  state.turn.currentPhase = Phase.COMBAT_DAMAGE_FIRST_STRIKE;
  const firstStrike = resolveCombatDamage(state);
  expect(firstStrike.success).toBe(true);
  firstStrike.state.turn.currentPhase = Phase.COMBAT_DAMAGE;
  const regular = resolveCombatDamage(firstStrike.state);
  expect(regular.success).toBe(true);
  return { firstStrike, regular };
}

/** Run only the regular damage step (no first-strike creatures in play). */
function runRegularDamageStep(state: GameState): CombatActionResult {
  state.turn.currentPhase = Phase.COMBAT_DAMAGE;
  const result = resolveCombatDamage(state);
  expect(result.success).toBe(true);
  return result;
}

function isInGraveyard(
  state: GameState,
  playerId: string,
  cardId: CardInstanceId,
): boolean {
  return state.zones.get(`${playerId}-graveyard`)!.cardIds.includes(cardId);
}

function idsOf(state: GameState, playerId: string): CardInstanceId[] {
  return state.zones.get(`${playerId}-battlefield`)!.cardIds;
}

// ─────────────────────────────────────────────────────────────────────────────
// (a) Deathtouch + trample damage assignment (CR 702.2b / 702.19b)
// ─────────────────────────────────────────────────────────────────────────────

describe("combat mutation: deathtouch + trample assignment", () => {
  it("deathtouch attacker assigns only 1 to a 2/2 blocker (already lethal) and tramples the rest", () => {
    const { state, aliceId, bobId } = setupGame(
      [
        {
          name: "DT Trampler",
          power: 3,
          toughness: 3,
          keywords: ["Deathtouch", "Trample"],
        },
      ],
      [{ name: "Bear", power: 2, toughness: 2 }],
    );
    const attackerId = idsOf(state, aliceId)[0];
    const blockerId = idsOf(state, bobId)[0];

    const blockResult = declareCombat(state, attackerId, bobId, [blockerId]);
    const result = runRegularDamageStep(blockResult.state);

    // Exactly 1 damage went to the blocker (deathtouch = lethal — it dies),
    // so only 2 trample over. A non-deathtouch assignment (2 to the blocker)
    // would leave the player at 19 instead.
    expect(isInGraveyard(result.state, bobId, blockerId)).toBe(true);
    expect(result.state.players.get(bobId)!.life).toBe(18);
  });

  it("non-deathtouch attacker must assign FULL lethal before trampling", () => {
    const { state, aliceId, bobId } = setupGame(
      [{ name: "Trampler", power: 4, toughness: 4, keywords: ["Trample"] }],
      [{ name: "Bear", power: 2, toughness: 2 }],
    );
    const attackerId = idsOf(state, aliceId)[0];
    const blockerId = idsOf(state, bobId)[0];

    const blockResult = declareCombat(state, attackerId, bobId, [blockerId]);
    const result = runRegularDamageStep(blockResult.state);

    // 2 damage (full lethal) kills the blocker; only 2 tramples over.
    // A premature deathtouch-style assignment of 1 would trample 3 instead.
    expect(isInGraveyard(result.state, bobId, blockerId)).toBe(true);
    expect(result.state.players.get(bobId)!.life).toBe(18);
  });

  it("deathtouch assigns 1 per blocker in order, then tramples the remainder", () => {
    const { state, aliceId, bobId } = setupGame(
      [
        {
          name: "DT Trampler",
          power: 5,
          toughness: 5,
          keywords: ["Deathtouch", "Trample"],
        },
      ],
      [
        { name: "Chump", power: 1, toughness: 1 },
        { name: "Wall", power: 2, toughness: 2 },
      ],
    );
    const attackerId = idsOf(state, aliceId)[0];
    const [chumpId, wallId] = idsOf(state, bobId);

    const blockResult = declareCombat(state, attackerId, bobId, [
      chumpId,
      wallId,
    ]);
    const result = runRegularDamageStep(blockResult.state);

    // 1 damage to each blocker is lethal under deathtouch (even the 2/2);
    // 3 trample over. Non-deathtouch assignment would trample only 2.
    expect(isInGraveyard(result.state, bobId, chumpId)).toBe(true);
    expect(isInGraveyard(result.state, bobId, wallId)).toBe(true);
    expect(result.state.players.get(bobId)!.life).toBe(17);
  });

  it("without trample, overflow damage is lost even when every blocker dies", () => {
    const { state, aliceId, bobId } = setupGame(
      [{ name: "Rhino", power: 6, toughness: 6 }],
      [
        { name: "Bear", power: 2, toughness: 2 },
        { name: "Ogre", power: 3, toughness: 3 },
      ],
    );
    const attackerId = idsOf(state, aliceId)[0];
    const [bearId, ogreId] = idsOf(state, bobId);

    const blockResult = declareCombat(state, attackerId, bobId, [
      bearId,
      ogreId,
    ]);
    const result = runRegularDamageStep(blockResult.state);

    expect(isInGraveyard(result.state, bobId, bearId)).toBe(true);
    expect(isInGraveyard(result.state, bobId, ogreId)).toBe(true);
    // No trample: the excess 1 damage vanishes; the player is untouched.
    expect(result.state.players.get(bobId)!.life).toBe(20);
  });

  it("deathtouch stops assigning once damage is exhausted (no zero-damage events)", () => {
    const { state, aliceId, bobId } = setupGame(
      [
        {
          name: "DT Snake",
          power: 2,
          toughness: 2,
          keywords: ["Deathtouch"],
        },
      ],
      [
        { name: "Chump A", power: 1, toughness: 1 },
        { name: "Chump B", power: 1, toughness: 1 },
        { name: "Chump C", power: 1, toughness: 1 },
      ],
    );
    const attackerId = idsOf(state, aliceId)[0];
    const [aId, bId, cId] = idsOf(state, bobId);

    const blockResult = declareCombat(state, attackerId, bobId, [
      aId,
      bId,
      cId,
    ]);
    const result = runRegularDamageStep(blockResult.state);

    // The first two blockers each take exactly 1 (lethal under deathtouch)
    // and die; the third must receive nothing — the 2 damage ran out.
    expect(isInGraveyard(result.state, bobId, aId)).toBe(true);
    expect(isInGraveyard(result.state, bobId, bId)).toBe(true);
    expect(result.state.cards.get(cId)!.damage).toBe(0);
    expect(isInGraveyard(result.state, bobId, cId)).toBe(false);
    expect(result.description).not.toContain("deals 0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (d) First-strike vs regular damage-step separation (CR 702.4b, #969)
// ─────────────────────────────────────────────────────────────────────────────

describe("combat mutation: damage-step separation", () => {
  it("first-strike-only attacker deals damage ONLY in the first-strike step", () => {
    const { state, aliceId, bobId } = setupGame(
      [
        {
          name: "FS Attacker",
          power: 3,
          toughness: 3,
          keywords: ["First Strike"],
        },
      ],
      [],
    );
    const attackerId = idsOf(state, aliceId)[0];

    const attackResult = declareCombat(state, attackerId, bobId, []);
    const { firstStrike, regular } = runBothDamageSteps(attackResult.state);

    expect(firstStrike.state.players.get(bobId)!.life).toBe(17);
    // No second hit: the regular step must exclude first-strike-only creatures.
    expect(regular.state.players.get(bobId)!.life).toBe(17);
  });

  it("double-strike attacker deals damage in BOTH steps", () => {
    const { state, aliceId, bobId } = setupGame(
      [
        {
          name: "DS Attacker",
          power: 2,
          toughness: 2,
          keywords: ["Double Strike"],
        },
      ],
      [],
    );
    const attackerId = idsOf(state, aliceId)[0];

    const attackResult = declareCombat(state, attackerId, bobId, []);
    const { regular } = runBothDamageSteps(attackResult.state);

    expect(regular.state.players.get(bobId)!.life).toBe(16);
  });

  it("a first-strike blocker and a double-strike attacker kill each other in the first-strike step", () => {
    const { state, aliceId, bobId } = setupGame(
      [
        {
          name: "DS Attacker",
          power: 2,
          toughness: 2,
          keywords: ["Double Strike"],
        },
      ],
      [
        {
          name: "FS Blocker",
          power: 2,
          toughness: 2,
          keywords: ["First Strike"],
        },
      ],
    );
    const attackerId = idsOf(state, aliceId)[0];
    const blockerId = idsOf(state, bobId)[0];

    const blockResult = declareCombat(state, attackerId, bobId, [blockerId]);
    const { firstStrike } = runBothDamageSteps(blockResult.state);

    // The FS blocker dealt its 2 during the FIRST-STRIKE step (a regular
    // blocker would only deal when its attacker processes the regular step),
    // so the attacker dies immediately — and takes the DS attacker down too.
    expect(isInGraveyard(firstStrike.state, aliceId, attackerId)).toBe(true);
    expect(isInGraveyard(firstStrike.state, bobId, blockerId)).toBe(true);
  });

  it("a regular blocker deals damage only in the regular damage step", () => {
    const { state, aliceId, bobId } = setupGame(
      [{ name: "Attacker", power: 2, toughness: 2 }],
      [{ name: "Big Blocker", power: 4, toughness: 4 }],
    );
    const attackerId = idsOf(state, aliceId)[0];
    const blockerId = idsOf(state, bobId)[0];

    const blockResult = declareCombat(state, attackerId, bobId, [blockerId]);
    const { firstStrike, regular } = runBothDamageSteps(blockResult.state);

    // First strike step: neither creature has first strike — nothing happens.
    expect(firstStrike.state.cards.get(attackerId)!.damage).toBe(0);
    expect(firstStrike.state.cards.get(blockerId)!.damage).toBe(0);
    // Regular step: the blocker deals its 4 back → the 2/2 attacker dies,
    // while the 4/4 blocker only takes the attacker's 2 and survives.
    expect(regular.state.cards.get(blockerId)!.damage).toBe(2);
    expect(isInGraveyard(regular.state, aliceId, attackerId)).toBe(true);
    expect(isInGraveyard(regular.state, bobId, blockerId)).toBe(false);
  });

  it("a double-strike blocker deals damage in BOTH steps", () => {
    const { state, aliceId, bobId } = setupGame(
      [
        {
          name: "DS Attacker",
          power: 1,
          toughness: 4,
          keywords: ["Double Strike"],
        },
      ],
      [
        {
          name: "DS Blocker",
          power: 2,
          toughness: 2,
          keywords: ["Double Strike"],
        },
      ],
    );
    const attackerId = idsOf(state, aliceId)[0];
    const blockerId = idsOf(state, bobId)[0];

    const blockResult = declareCombat(state, attackerId, bobId, [blockerId]);
    const { firstStrike, regular } = runBothDamageSteps(blockResult.state);

    // First strike step: attacker deals 1 (blocker survives at 1 marked),
    // blocker deals 2 back (attacker at 2/4 marked, still alive).
    expect(firstStrike.state.cards.get(attackerId)!.damage).toBe(2);
    expect(isInGraveyard(firstStrike.state, bobId, blockerId)).toBe(false);
    // Regular step: both strike again — the blocker takes its 2nd damage and
    // dies; the attacker takes 2 more (4 total) on its 4-toughness body → dies.
    expect(isInGraveyard(regular.state, bobId, blockerId)).toBe(true);
    expect(isInGraveyard(regular.state, aliceId, attackerId)).toBe(true);
  });

  it("a double-strike attacker killed in the first-strike step does NOT deal again (#969)", () => {
    const { state, aliceId, bobId } = setupGame(
      [
        {
          name: "DS Attacker",
          power: 2,
          toughness: 2,
          keywords: ["Double Strike"],
        },
      ],
      [
        {
          name: "FS Blocker",
          power: 3,
          toughness: 3,
          keywords: ["First Strike"],
        },
      ],
    );
    const attackerId = idsOf(state, aliceId)[0];
    const blockerId = idsOf(state, bobId)[0];

    const blockResult = declareCombat(state, attackerId, bobId, [blockerId]);
    const { firstStrike, regular } = runBothDamageSteps(blockResult.state);

    // First strike step: attacker deals 2 (blocker survives), blocker deals 3
    // → attacker dies. The dead attacker must NOT deal its second hit.
    expect(isInGraveyard(firstStrike.state, aliceId, attackerId)).toBe(true);
    expect(regular.state.players.get(bobId)!.life).toBe(20);
    expect(regular.state.cards.get(blockerId)!.damage).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) Multi-blocker attacker damage-assignment ordering (CR 510.1c)
// ─────────────────────────────────────────────────────────────────────────────

describe("combat mutation: damage assignment order", () => {
  it("assigns lethal in the CHOSEN order; overflow truncates at the last blocker", () => {
    const { state, aliceId, bobId } = setupGame(
      [{ name: "Attacker", power: 2, toughness: 2 }],
      [
        { name: "Big Wall", power: 5, toughness: 5 },
        { name: "Chump", power: 1, toughness: 1 },
      ],
    );
    const attackerId = idsOf(state, aliceId)[0];
    const [wallId, chumpId] = idsOf(state, bobId);

    const blockResult = declareCombat(state, attackerId, bobId, [
      wallId,
      chumpId,
    ]);
    // Announce: chump first, wall second.
    const orderResult = setDamageAssignmentOrder(
      blockResult.state,
      attackerId,
      [chumpId, wallId],
    );
    expect(orderResult.success).toBe(true);

    const result = runRegularDamageStep(orderResult.state);

    // Chump (first) takes the lethal 1 and dies; the wall (second) only
    // receives the 1 overflow and survives.
    expect(isInGraveyard(result.state, bobId, chumpId)).toBe(true);
    expect(result.state.cards.get(wallId)!.damage).toBe(1);
    expect(isInGraveyard(result.state, bobId, wallId)).toBe(false);
    expect(result.state.players.get(bobId)!.life).toBe(20);
  });

  it("defaults to blocker declaration order when the attacker announces nothing", () => {
    const { state, aliceId, bobId } = setupGame(
      [{ name: "Attacker", power: 2, toughness: 2 }],
      [
        { name: "Chump", power: 1, toughness: 1 },
        { name: "Big Wall", power: 5, toughness: 5 },
      ],
    );
    const attackerId = idsOf(state, aliceId)[0];
    const [chumpId, wallId] = idsOf(state, bobId);

    // Declared [chump, wall] — insertion order puts chump first.
    const blockResult = declareCombat(state, attackerId, bobId, [
      chumpId,
      wallId,
    ]);
    const result = runRegularDamageStep(blockResult.state);

    expect(isInGraveyard(result.state, bobId, chumpId)).toBe(true);
    expect(result.state.cards.get(wallId)!.damage).toBe(1);
    expect(isInGraveyard(result.state, bobId, wallId)).toBe(false);
  });

  it("rejects an incomplete damage-assignment permutation", () => {
    const { state, aliceId, bobId } = setupGame(
      [{ name: "Attacker", power: 2, toughness: 2 }],
      [
        { name: "Wall A", power: 2, toughness: 2 },
        { name: "Wall B", power: 2, toughness: 2 },
      ],
    );
    const attackerId = idsOf(state, aliceId)[0];
    const [aId, bId] = idsOf(state, bobId);

    const blockResult = declareCombat(state, attackerId, bobId, [aId, bId]);
    const result = setDamageAssignmentOrder(blockResult.state, attackerId, [
      aId,
    ]);
    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toContain("every blocker exactly once");
  });

  it("rejects duplicates and unknown creatures in the order", () => {
    const { state, aliceId, bobId } = setupGame(
      [{ name: "Attacker", power: 2, toughness: 2 }],
      [
        { name: "Wall A", power: 2, toughness: 2 },
        { name: "Wall B", power: 2, toughness: 2 },
      ],
    );
    const attackerId = idsOf(state, aliceId)[0];
    const [aId, bId] = idsOf(state, bobId);

    const blockResult = declareCombat(state, attackerId, bobId, [aId, bId]);

    // Same length as the blocker list, but 'a' appears twice → duplicate.
    const duplicate = setDamageAssignmentOrder(blockResult.state, attackerId, [
      aId,
      aId,
    ]);
    expect(duplicate.success).toBe(false);
    expect(duplicate.errors?.[0]).toContain("more than once");

    // Right length, but one entry isn't blocking this attacker.
    const unknown = setDamageAssignmentOrder(blockResult.state, attackerId, [
      aId,
      "card-not-blocking" as CardInstanceId,
    ]);
    expect(unknown.success).toBe(false);
    expect(unknown.errors?.[0]).toContain("not blocking this attacker");
    expect(bId).toBeTruthy();
  });

  it("refuses to set an order for an unblocked attacker", () => {
    const { state, aliceId, bobId } = setupGame(
      [{ name: "Attacker", power: 2, toughness: 2 }],
      [],
    );
    const attackerId = idsOf(state, aliceId)[0];

    const attackResult = declareCombat(state, attackerId, bobId, []);
    const result = setDamageAssignmentOrder(attackResult.state, attackerId, []);
    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toContain("not blocked");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) Double-strike lifelink / commander damage uses per-step attacker power
// ─────────────────────────────────────────────────────────────────────────────

describe("combat mutation: lifelink / commander damage math", () => {
  it("unblocked double-strike lifelink attacker gains life equal to TOTAL damage dealt", () => {
    const { state, aliceId, bobId } = setupGame(
      [
        {
          name: "DS Vampire",
          power: 2,
          toughness: 2,
          keywords: ["Double Strike", "Lifelink"],
        },
      ],
      [],
    );
    const attackerId = idsOf(state, aliceId)[0];

    const attackResult = declareCombat(state, attackerId, bobId, []);
    const { regular } = runBothDamageSteps(attackResult.state);

    // Bob takes 2+2 = 4; Alice gains exactly 4 (2 per step — NOT 4 per step).
    expect(regular.state.players.get(bobId)!.life).toBe(16);
    expect(regular.state.players.get(aliceId)!.life).toBe(24);
  });

  it("unblocked lifelink attacker in a single step gains exactly its power", () => {
    const { state, aliceId, bobId } = setupGame(
      [{ name: "Vampire", power: 3, toughness: 3, keywords: ["Lifelink"] }],
      [],
    );
    const attackerId = idsOf(state, aliceId)[0];

    const attackResult = declareCombat(state, attackerId, bobId, []);
    const result = runRegularDamageStep(attackResult.state);

    expect(result.state.players.get(bobId)!.life).toBe(17);
    expect(result.state.players.get(aliceId)!.life).toBe(23);
  });

  it("legendary creature commander tracks commander damage on the defender", () => {
    const { state, aliceId, bobId } = setupGame(
      [
        {
          name: "Commander Guy",
          power: 5,
          toughness: 5,
          typeLine: "Legendary Creature — Human Soldier",
        },
      ],
      [],
    );
    const attackerId = idsOf(state, aliceId)[0];

    const attackResult = declareCombat(state, attackerId, bobId, []);
    const result = runRegularDamageStep(attackResult.state);

    expect(result.state.players.get(bobId)!.life).toBe(15);
    expect(
      result.state.players.get(bobId)!.commanderDamage.get(attackerId),
    ).toBe(5);
  });

  it("combat damage clamps a player's life at zero (never negative)", () => {
    const { state, aliceId, bobId } = setupGame(
      [{ name: "Attacker", power: 5, toughness: 5 }],
      [],
    );
    const attackerId = idsOf(state, aliceId)[0];
    state.players.get(bobId)!.life = 3;

    const attackResult = declareCombat(state, attackerId, bobId, []);
    const result = runRegularDamageStep(attackResult.state);

    expect(result.state.players.get(bobId)!.life).toBe(0);
  });

  it("unblocked combat damage to a planeswalker removes loyalty counters", () => {
    const { state, aliceId, bobId } = setupGame(
      [{ name: "Attacker", power: 3, toughness: 3 }],
      [],
    );
    const pwData = {
      id: "mock-pw-jace",
      name: "Jace",
      type_line: "Planeswalker — Jace",
      loyalty: "5",
      keywords: [],
      oracle_text: "",
      mana_cost: "{3}",
      cmc: 4,
      colors: ["U"],
      color_identity: ["U"],
      legalities: { standard: "legal", commander: "legal" },
      card_faces: undefined,
      layout: "normal",
    } as unknown as ScryfallCard;
    const pwId = addToBattlefield(state, pwData, bobId);
    const pwWithLoyalty = initializePlaneswalkerLoyalty(state.cards.get(pwId)!);
    state.cards.set(pwWithLoyalty.id, pwWithLoyalty);

    const attackerId = idsOf(state, aliceId)[0];
    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const attackResult = declareAttackers(state, [
      { cardId: attackerId, defenderId: pwId },
    ]);
    expect(attackResult.success).toBe(true);
    expect(
      attackResult.state.combat.attackers.find((a) => a.cardId === attackerId)
        ?.isAttackingPlaneswalker,
    ).toBe(true);

    const result = runRegularDamageStep(attackResult.state);

    // Bob's life untouched — the damage went to the planeswalker instead.
    expect(result.state.players.get(bobId)!.life).toBe(20);
    const loyalty = result.state.cards
      .get(pwId)!
      .counters?.find((c) => c.type === "loyalty");
    expect(loyalty?.count).toBe(2); // 5 - 3
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (e) Declaration validation: menace, phase gating, guards
// ─────────────────────────────────────────────────────────────────────────────

describe("combat mutation: declaration validation", () => {
  it("menace attacker cannot be blocked by fewer than two creatures (CR 702.70)", () => {
    const { state, aliceId, bobId } = setupGame(
      [
        {
          name: "Menace Brute",
          power: 2,
          toughness: 2,
          keywords: ["Menace"],
        },
      ],
      [
        { name: "Chump A", power: 1, toughness: 1 },
        { name: "Chump B", power: 1, toughness: 1 },
      ],
    );
    const attackerId = idsOf(state, aliceId)[0];
    const [aId, bId] = idsOf(state, bobId);

    // Single-blocker assignment: rejected — the attacker stays unblocked.
    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const attackResult = declareAttackers(state, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    attackResult.state.turn.currentPhase = Phase.DECLARE_BLOCKERS;
    const oneBlocker = declareBlockers(
      attackResult.state,
      new Map([[attackerId, [aId]]]),
    );
    expect(oneBlocker.success).toBe(true);
    expect(oneBlocker.state.combat.blockers.has(attackerId)).toBe(false);
    expect(oneBlocker.errors?.join(" ")).toContain("menace");

    // Two blockers: accepted.
    const twoBlockers = declareBlockers(
      attackResult.state,
      new Map([[attackerId, [aId, bId]]]),
    );
    expect(twoBlockers.state.combat.blockers.has(attackerId)).toBe(true);
    expect(twoBlockers.state.combat.blockers.get(attackerId)).toHaveLength(2);
  });

  it("an empty blocker assignment stays legal and emits no errors", () => {
    const { state, aliceId, bobId } = setupGame(
      [{ name: "Attacker", power: 2, toughness: 2 }],
      [{ name: "Chump", power: 1, toughness: 1 }],
    );
    const attackerId = idsOf(state, aliceId)[0];

    const attackResult = declareCombat(state, attackerId, bobId, []);
    expect(attackResult.errors).toBeUndefined();
  });

  it("declareBlockers requires attackers to be declared first", () => {
    const { state, bobId } = setupGame(
      [],
      [{ name: "Chump", power: 1, toughness: 1 }],
    );
    const blockerId = idsOf(state, bobId)[0];

    const result = declareBlockers(
      state,
      new Map([["card-none" as CardInstanceId, [blockerId]]]),
    );
    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toContain("No attackers declared");
  });

  it("declareAttackers only runs during declare-attackers / begin-combat", () => {
    const { state, aliceId, bobId } = setupGame(
      [{ name: "Attacker", power: 2, toughness: 2 }],
      [],
    );
    const attackerId = idsOf(state, aliceId)[0];

    // Draw step: rejected.
    state.turn.currentPhase = Phase.DRAW;
    const rejected = declareAttackers(state, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    expect(rejected.success).toBe(false);
    expect(rejected.errors?.[0]).toContain("declare attackers");

    // Begin-combat step: accepted.
    state.turn.currentPhase = Phase.BEGIN_COMBAT;
    const accepted = declareAttackers(state, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    expect(accepted.success).toBe(true);
  });

  it("resolveCombatDamage without combat to resolve fails cleanly", () => {
    const { state, aliceId, bobId } = setupGame(
      [{ name: "Attacker", power: 2, toughness: 2 }],
      [],
    );
    const attackerId = idsOf(state, aliceId)[0];

    // In combat phase but zero attackers declared → nothing to resolve.
    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const empty = declareAttackers(state, []);
    expect(empty.success).toBe(true);

    const result = resolveCombatDamage(empty.state);
    expect(result.success).toBe(false);
    expect(result.description).toContain("No combat to resolve");
    expect(bobId).toBeTruthy();
    expect(state.cards.has(attackerId)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// canAttack / canBlock guards (evasion & keyword gates)
// ─────────────────────────────────────────────────────────────────────────────

describe("combat mutation: canAttack / canBlock guards", () => {
  it("tapped creature cannot attack without vigilance but can with it", () => {
    const { state, aliceId, bobId } = setupGame(
      [
        { name: "Tapped Bear", power: 2, toughness: 2 },
        {
          name: "Vigilant Bear",
          power: 2,
          toughness: 2,
          keywords: ["Vigilance"],
        },
      ],
      [],
    );
    const [bearId, vigilantId] = idsOf(state, aliceId);
    state.cards.get(bearId)!.isTapped = true;
    state.cards.get(vigilantId)!.isTapped = true;

    expect(canAttack(state, bearId, bobId).canAttack).toBe(false);
    expect(canAttack(state, vigilantId, bobId).canAttack).toBe(true);
  });

  it("summoning sickness blocks attacking unless the creature has haste", () => {
    const { state, aliceId, bobId } = setupGame(
      [
        { name: "Sick Bear", power: 2, toughness: 2 },
        { name: "Hasty Bear", power: 2, toughness: 2, keywords: ["Haste"] },
      ],
      [],
    );
    const [sickId, hastyId] = idsOf(state, aliceId);
    state.cards.get(sickId)!.hasSummoningSickness = true;
    state.cards.get(hastyId)!.hasSummoningSickness = true;

    expect(canAttack(state, sickId, bobId).canAttack).toBe(false);
    expect(canAttack(state, hastyId, bobId).canAttack).toBe(true);
  });

  it("non-creatures and off-battlefield cards can never attack", () => {
    const { state, aliceId, bobId } = setupGame(
      [{ name: "Bear", power: 2, toughness: 2 }],
      [],
    );
    const attackerId = idsOf(state, aliceId)[0];

    const instant = addToBattlefield(
      state,
      mkCreature({
        name: "Shock",
        power: 0,
        toughness: 0,
        typeLine: "Instant",
      }),
      aliceId,
    );
    expect(canAttack(state, instant, bobId).canAttack).toBe(false);

    // Remove the creature from the battlefield zone.
    const bf = state.zones.get(`${aliceId}-battlefield`)!;
    state.zones.set(`${aliceId}-battlefield`, {
      ...bf,
      cardIds: bf.cardIds.filter((id) => id !== attackerId),
    });
    expect(canAttack(state, attackerId, bobId).canAttack).toBe(false);
  });

  it("flying can only be blocked by flying or reach (CR 702.9 / 702.17)", () => {
    const { state, aliceId, bobId } = setupGame(
      [{ name: "Falcon", power: 2, toughness: 2, keywords: ["Flying"] }],
      [
        { name: "Ground Bear", power: 2, toughness: 2 },
        { name: "Reach Spider", power: 2, toughness: 2, keywords: ["Reach"] },
        { name: "Bird", power: 2, toughness: 2, keywords: ["Flying"] },
      ],
    );
    const attackerId = idsOf(state, aliceId)[0];
    const [groundId, spiderId, birdId] = idsOf(state, bobId);

    expect(canBlock(state, groundId, attackerId).canBlock).toBe(false);
    expect(canBlock(state, spiderId, attackerId).canBlock).toBe(true);
    expect(canBlock(state, birdId, attackerId).canBlock).toBe(true);
  });

  it("protection from red prevents blocking a red attacker; white protection does not", () => {
    const { state, aliceId, bobId } = setupGame(
      [{ name: "Red Attacker", power: 2, toughness: 2, colors: ["red"] }],
      [
        {
          name: "Red Ward",
          power: 2,
          toughness: 2,
          oracleText: "protection from red",
        },
        {
          name: "White Ward",
          power: 2,
          toughness: 2,
          oracleText: "protection from white",
        },
      ],
    );
    const attackerId = idsOf(state, aliceId)[0];
    const [redWardId, whiteWardId] = idsOf(state, bobId);

    expect(canBlock(state, redWardId, attackerId).canBlock).toBe(false);
    expect(canBlock(state, whiteWardId, attackerId).canBlock).toBe(true);
  });

  it("islandwalk cannot be blocked while the defender controls an Island (CR 702.14)", () => {
    const { state, aliceId, bobId } = setupGame(
      [
        {
          name: "Isle Walker",
          power: 2,
          toughness: 2,
          oracleText: "islandwalk",
        },
      ],
      [{ name: "Bear", power: 2, toughness: 2 }],
    );
    const attackerId = idsOf(state, aliceId)[0];
    const blockerId = idsOf(state, bobId)[0];

    // Without an Island: blockable.
    expect(canBlock(state, blockerId, attackerId).canBlock).toBe(true);

    const island = addToBattlefield(
      state,
      {
        ...mkCreature({ name: "Island", power: 0, toughness: 0 }),
        type_line: "Basic Land — Island",
      } as ScryfallCard,
      bobId,
    );
    expect(state.cards.has(island)).toBe(true);
    expect(canBlock(state, blockerId, attackerId).canBlock).toBe(false);
  });

  it("tapped creatures cannot block", () => {
    const { state, aliceId, bobId } = setupGame(
      [{ name: "Attacker", power: 2, toughness: 2 }],
      [{ name: "Sleepy Bear", power: 2, toughness: 2 }],
    );
    const attackerId = idsOf(state, aliceId)[0];
    const blockerId = idsOf(state, bobId)[0];
    state.cards.get(blockerId)!.isTapped = true;

    expect(canBlock(state, blockerId, attackerId).canBlock).toBe(false);
  });

  it("a zero-power blocker deals no damage back (no zero-damage events)", () => {
    const { state, aliceId, bobId } = setupGame(
      [{ name: "Attacker", power: 2, toughness: 2 }],
      [{ name: "Wall of Zero", power: 0, toughness: 3 }],
    );
    const attackerId = idsOf(state, aliceId)[0];
    const blockerId = idsOf(state, bobId)[0];

    const blockResult = declareCombat(state, attackerId, bobId, [blockerId]);
    const result = runRegularDamageStep(blockResult.state);

    // Attacker unharmed — the 0-power blocker must not "deal" 0 damage.
    expect(result.state.cards.get(attackerId)!.damage).toBe(0);
    expect(result.description).not.toContain("deals 0");
    expect(result.state.cards.get(blockerId)!.damage).toBe(2);
  });
});
