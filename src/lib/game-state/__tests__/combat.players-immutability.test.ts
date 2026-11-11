/**
 * Combat resolution — input-immutability proof for the players map.
 *
 * Issue #2919: `resolveCombatDamage` used to copy the whole players map on
 * every player-affecting event (seven `new Map(updatedState.players)` sites
 * inside the one function). It now takes ONE working copy of the players map
 * for the whole resolution and mutates that copy in place, publishing it
 * into the threaded state before every helper call that reads
 * `state.players`.
 *
 * The ownership contract this file pins:
 *
 *  - the caller's input players map is NEVER mutated (no `.set()` on it, no
 *    entry replaced, same size, same player objects);
 *  - the caller's input player objects are NEVER mutated in place (they are
 *    frozen, so any in-place write would throw);
 *  - the returned state carries a DIFFERENT players map object than the
 *    input (the working copy), with the combat damage actually applied.
 *
 * The covered paths are the ones that touch players directly: an unblocked
 * lifelink attacker, a blocked attacker whose blocker has lifelink, a
 * trample excess, and an infect/toxic attacker (poison counters).
 */

import {
  declareAttackers,
  declareBlockers,
  resolveCombatDamage,
} from "../combat";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { Phase } from "../types";
import type { CardInstance, GameState, Player, ScryfallCard } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

interface CreatureSpec {
  name: string;
  power: number;
  toughness: number;
  keywords?: string[];
}

function mockCreature(spec: CreatureSpec): ScryfallCard {
  const keywords = spec.keywords ?? [];
  return {
    id: `mock-${spec.name.toLowerCase().replace(/\s+/g, "-")}`,
    name: spec.name,
    type_line: "Creature — Test",
    power: spec.power.toString(),
    toughness: spec.toughness.toString(),
    keywords,
    oracle_text: keywords.join(" "),
    mana_cost: "{1}",
    cmc: 2,
    colors: ["W"],
    color_identity: ["W"],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
  } as ScryfallCard;
}

function setupGame(
  aliceCreatures: CreatureSpec[] = [],
  bobCreatures: CreatureSpec[] = [],
): { state: GameState; aliceId: string; bobId: string } {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);

  const playerIds = Array.from(state.players.keys());
  const aliceId = playerIds[0];
  const bobId = playerIds[1];

  const add = (
    spec: CreatureSpec,
    controllerId: string,
  ): CardInstance["id"] => {
    const instance = createCardInstance(
      mockCreature(spec),
      controllerId,
      controllerId,
    );
    instance.hasSummoningSickness = false;
    state.cards.set(instance.id, instance);
    const battlefield = state.zones.get(`${controllerId}-battlefield`)!;
    state.zones.set(`${controllerId}-battlefield`, {
      ...battlefield,
      cardIds: [...battlefield.cardIds, instance.id],
    });
    return instance.id;
  };

  for (const spec of aliceCreatures) add(spec, aliceId);
  for (const spec of bobCreatures) add(spec, bobId);

  return { state, aliceId, bobId };
}

function battlefieldIds(state: GameState, playerId: string): string[] {
  return state.zones.get(`${playerId}-battlefield`)!.cardIds;
}

/** A snapshot of the players map: entry order, object identity and state. */
function snapshotPlayers(state: GameState): Array<{
  id: string;
  player: Player;
  life: number;
  poisonCounters: number;
  hasLost: boolean;
  lossReason: string | null;
  commanderDamageTotal: number;
}> {
  return Array.from(state.players.entries()).map(([id, player]) => ({
    id,
    player,
    life: player.life,
    poisonCounters: player.poisonCounters,
    hasLost: player.hasLost,
    lossReason: player.lossReason,
    commanderDamageTotal: Array.from(player.commanderDamage.values()).reduce(
      (sum, value) => sum + value,
      0,
    ),
  }));
}

/**
 * Freeze every player object of the input state so an in-place mutation by
 * the engine throws a TypeError instead of silently succeeding.
 */
function freezePlayers(state: GameState): void {
  for (const player of state.players.values()) {
    Object.freeze(player);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveCombatDamage — input players map is never mutated (#2919)", () => {
  it("does not mutate the input players map or player objects across unblocked, blocked-with-lifelink and trample paths", () => {
    const { state, aliceId, bobId } = setupGame(
      [
        // Unblocked lifelink attacker: Bob loses life, Alice gains life.
        {
          name: "Lifelink Gainer",
          power: 3,
          toughness: 3,
          keywords: ["Lifelink"],
        },
        // Trample attacker blocked by a 2/2: 2 damage tramples over.
        { name: "Trampler", power: 4, toughness: 4, keywords: ["Trample"] },
        // Plain attacker blocked by the lifelink wall.
        { name: "Brawler", power: 3, toughness: 3 },
      ],
      [
        // Lifelink blocker: its controller gains life when it deals damage.
        {
          name: "Lifelink Wall",
          power: 1,
          toughness: 1,
          keywords: ["Lifelink"],
        },
        { name: "Grizzly Bears", power: 2, toughness: 2 },
      ],
    );

    const aliceIds = battlefieldIds(state, aliceId);
    const bobIds = battlefieldIds(state, bobId);
    const lifelinkAttacker = aliceIds[0];
    const trampler = aliceIds[1];
    const brawler = aliceIds[2];
    const lifelinkBlocker = bobIds[0];
    const bear = bobIds[1];

    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const attackResult = declareAttackers(state, [
      { cardId: lifelinkAttacker, defenderId: bobId },
      { cardId: trampler, defenderId: bobId },
      { cardId: brawler, defenderId: bobId },
    ]);
    expect(attackResult.success).toBe(true);

    const declared = attackResult.state;
    declared.turn.currentPhase = Phase.DECLARE_BLOCKERS;
    const blockResult = declareBlockers(
      declared,
      new Map([
        [trampler, [bear]],
        [brawler, [lifelinkBlocker]],
      ]),
    );
    expect(blockResult.success).toBe(true);

    const combatState = blockResult.state;
    combatState.turn.currentPhase = Phase.COMBAT_DAMAGE;

    // Freeze the input player objects and snapshot the input map.
    freezePlayers(combatState);
    const before = snapshotPlayers(combatState);
    const inputPlayersMap = combatState.players;

    const result = resolveCombatDamage(combatState);
    expect(result.success).toBe(true);

    // 1. The input map object is untouched: same size, same entries, same
    //    order, same player objects, same player state.
    const after = snapshotPlayers(combatState);
    expect(combatState.players).toBe(inputPlayersMap);
    expect(inputPlayersMap.size).toBe(before.length);
    expect(after.map((entry) => entry.id)).toEqual(
      before.map((entry) => entry.id),
    );
    for (let i = 0; i < before.length; i++) {
      expect(after[i].player).toBe(before[i].player);
      expect(after[i].life).toBe(before[i].life);
      expect(after[i].poisonCounters).toBe(before[i].poisonCounters);
      expect(after[i].hasLost).toBe(before[i].hasLost);
      expect(after[i].lossReason).toBe(before[i].lossReason);
      expect(after[i].commanderDamageTotal).toBe(
        before[i].commanderDamageTotal,
      );
    }

    // 2. The returned state carries a different players map (the working
    //    copy) with the combat damage applied:
    //      Bob  - 3 (unblocked lifelink attacker) - 2 (trample excess)
    //          + 1 (lifelink blocker dealt damage)
    //      Alice + 3 (lifelink attacker)
    expect(result.state.players).not.toBe(inputPlayersMap);
    expect(result.state.players.get(bobId)!.life).toBe(20 - 3 - 2 + 1);
    expect(result.state.players.get(aliceId)!.life).toBe(20 + 3);
  });

  it("keeps the input players map pristine for the infect/toxic path", () => {
    const { state, aliceId, bobId } = setupGame([
      {
        name: "Plague Bearer",
        power: 2,
        toughness: 2,
        keywords: ["Infect", "Toxic"],
      },
    ]);

    const attacker = battlefieldIds(state, aliceId)[0];
    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const attackResult = declareAttackers(state, [
      { cardId: attacker, defenderId: bobId },
    ]);
    expect(attackResult.success).toBe(true);

    const combatState = attackResult.state;
    combatState.turn.currentPhase = Phase.COMBAT_DAMAGE;

    freezePlayers(combatState);
    const before = snapshotPlayers(combatState);
    const inputPlayersMap = combatState.players;

    const result = resolveCombatDamage(combatState);
    expect(result.success).toBe(true);

    const after = snapshotPlayers(combatState);
    expect(combatState.players).toBe(inputPlayersMap);
    expect(after).toEqual(before);
    for (let i = 0; i < before.length; i++) {
      expect(after[i].player).toBe(before[i].player);
    }

    // Infect deals poison counters instead of life loss (CR 702.90b) and
    // toxic adds its own poison counters on top (CR 702.95).
    const bob = result.state.players.get(bobId)!;
    expect(bob.life).toBe(20);
    expect(bob.poisonCounters).toBeGreaterThan(0);
    expect(result.state.players).not.toBe(inputPlayersMap);
  });

  it("returns a players map that is a fresh snapshot (not the working map reused by later calls)", () => {
    const { state, aliceId, bobId } = setupGame([
      { name: "Hammerhand", power: 3, toughness: 3 },
    ]);

    const attacker = battlefieldIds(state, aliceId)[0];
    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const attackResult = declareAttackers(state, [
      { cardId: attacker, defenderId: bobId },
    ]);
    expect(attackResult.success).toBe(true);

    const combatState = attackResult.state;
    combatState.turn.currentPhase = Phase.COMBAT_DAMAGE;

    const first = resolveCombatDamage(combatState);
    expect(first.success).toBe(true);
    const firstPlayers = first.state.players;

    // A second resolution over the same (already-resolved) input must not
    // reach back into the first result's map.
    const second = resolveCombatDamage(combatState);
    expect(second.success).toBe(true);
    expect(second.state.players).not.toBe(firstPlayers);
    expect(first.state.players.get(bobId)!.life).toBe(17);
    expect(second.state.players.get(bobId)!.life).toBe(17);
  });
});
