/**
 * Integration tests for Commander Damage tracking through real game-state mutations.
 *
 * Issue #1017: Verify commander damage accumulates correctly through combat and
 * triggers game loss at 21 cumulative combat damage (CR 903.9a).
 *
 * These tests exercise the commander-damage module against full GameState objects
 * built with createInitialGameState/startGame, and drive one scenario end-to-end
 * through the real combat pipeline (declareAttackers -> resolveCombatDamage).
 */

import {
  registerCommander,
  dealCommanderDamage,
  getCommanderDamage,
  getTotalCommanderDamage,
  hasLostFromCommanderDamage,
  resetCommanderDamageFromCommander,
  DEFAULT_COMMANDER_DAMAGE_THRESHOLD,
} from "../commander-damage";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { declareAttackers, resolveCombatDamage } from "../combat";
import { checkStateBasedActions } from "../state-based-actions";
import { Phase, ZoneType } from "../types";
import type { GameState, CardInstanceId, PlayerId, CardInstance } from "../types";
import type { ScryfallCard } from "@/app/actions";

function createMockCommander(
  name: string,
  power = 5,
  toughness = 5,
  colors: string[] = ["W"],
): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: "Legendary Creature — Human",
    oracle_text: "",
    mana_cost: "{2}{W}",
    cmc: 3,
    colors,
    color_identity: colors,
    power: String(power),
    toughness: String(toughness),
    keywords: [],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
  } as ScryfallCard;
}

interface CommanderSetup {
  state: GameState;
  ownerId: PlayerId;
  commanderId: CardInstanceId;
  commander: CardInstance;
}

/**
 * Put a commander onto its owner's battlefield and register it for damage tracking.
 */
function setupCommander(
  state: GameState,
  ownerId: PlayerId,
  cardData: ScryfallCard,
): CommanderSetup {
  const commander = createCardInstance(cardData, ownerId, ownerId);
  commander.hasSummoningSickness = false;
  commander.isTapped = false;

  const battlefieldKey = `${ownerId}-${ZoneType.BATTLEFIELD}`;
  const battlefield = state.zones.get(battlefieldKey);
  if (battlefield) {
    state.zones.set(battlefieldKey, {
      ...battlefield,
      cardIds: [...battlefield.cardIds, commander.id],
    });
  }
  commander.currentZoneKey = battlefieldKey;
  state.cards.set(commander.id, commander);

  state = registerCommander(state, ownerId, commander.id);

  return { state, ownerId, commanderId: commander.id, commander };
}

function createGame(playerNames = ["Alice", "Bob"]): GameState {
  let state = createInitialGameState(playerNames, 20, true);
  state = startGame(state);
  return state;
}

describe("Commander Damage Integration — CR 903.9a (issue #1017)", () => {
  let state: GameState;
  let aliceId: PlayerId;
  let bobId: PlayerId;
  let commanderId: CardInstanceId;

  beforeEach(() => {
    state = createGame(["Alice", "Bob"]);
    const ids = Array.from(state.players.keys());
    aliceId = ids[0];
    bobId = ids[1];

    const setup = setupCommander(
      state,
      aliceId,
      createMockCommander("Alice's General", 5, 5),
    );
    state = setup.state;
    commanderId = setup.commanderId;
  });

  describe("cumulative tracking across combat", () => {
    it("accumulates commander damage across multiple combat phases (3 + 7 + 11 = 21)", () => {
      let result = dealCommanderDamage(state, commanderId, bobId, 3);
      expect(result.success).toBe(true);
      expect(getCommanderDamage(result.state, bobId, commanderId)).toBe(3);
      expect(getTotalCommanderDamage(result.state, bobId)).toBe(3);

      result = dealCommanderDamage(result.state, commanderId, bobId, 7);
      expect(getCommanderDamage(result.state, bobId, commanderId)).toBe(10);

      result = dealCommanderDamage(result.state, commanderId, bobId, 11);
      expect(getCommanderDamage(result.state, bobId, commanderId)).toBe(21);
      expect(getTotalCommanderDamage(result.state, bobId)).toBe(21);

      // The final 11-damage blow triggers the loss (>= 21 cumulative).
      expect(result.playerLost).toBe(bobId);
      expect(hasLostFromCommanderDamage(result.state, bobId)).toBe(true);
      expect(result.state.players.get(bobId)!.hasLost).toBe(true);
    });

    it("does NOT lose at exactly threshold - 1 (20 damage)", () => {
      const result = dealCommanderDamage(state, commanderId, bobId, 20);
      expect(getCommanderDamage(result.state, bobId, commanderId)).toBe(20);
      expect(hasLostFromCommanderDamage(result.state, bobId)).toBe(false);
      expect(result.playerLost).toBeUndefined();
      expect(result.state.players.get(bobId)!.hasLost).toBe(false);
    });
  });

  describe("loss at exactly 21 cumulative commander damage", () => {
    it("marks the receiver as losing the game at 21 damage", () => {
      const result = dealCommanderDamage(state, commanderId, bobId, 21);
      expect(getCommanderDamage(result.state, bobId, commanderId)).toBe(21);
      expect(result.playerLost).toBe(bobId);
      expect(result.state.players.get(bobId)!.hasLost).toBe(true);
      expect(result.state.players.get(bobId)!.lossReason).toMatch(
        /commander damage/i,
      );
    });

    it("is detected by state-based actions (CR 903.10a)", () => {
      // Deal 21 commander damage, then run SBA on the resulting state.
      const damaged = dealCommanderDamage(state, commanderId, bobId, 21).state;
      const sba = checkStateBasedActions(damaged);
      expect(sba.actionsPerformed).toBe(true);
      expect(sba.state.players.get(bobId)!.hasLost).toBe(true);
      expect(sba.descriptions.some((d) => /commander damage/i.test(d))).toBe(
        true,
      );
    });

    it("ends the game when only one player remains (2-player)", () => {
      const result = dealCommanderDamage(state, commanderId, bobId, 21);
      expect(result.state.status).toBe("completed");
      expect(result.state.winners).toContain(aliceId);
    });
  });

  describe("reset when a commander changes zones", () => {
    it("clears the tally for a specific commander across all receivers", () => {
      const result = dealCommanderDamage(state, commanderId, bobId, 15);
      expect(getCommanderDamage(result.state, bobId, commanderId)).toBe(15);

      const reset = resetCommanderDamageFromCommander(result.state, commanderId);
      expect(getCommanderDamage(reset, bobId, commanderId)).toBe(0);
      expect(getTotalCommanderDamage(reset, bobId)).toBe(0);
      expect(hasLostFromCommanderDamage(reset, bobId)).toBe(false);
    });

    it("does not affect damage tracked from other commanders", () => {
      // A second commander from Alice.
      const second = setupCommander(
        state,
        aliceId,
        createMockCommander("Partner General", 4, 4),
      );
      let s = second.state;
      const secondId = second.commanderId;

      s = dealCommanderDamage(s, commanderId, bobId, 9).state;
      s = dealCommanderDamage(s, secondId, bobId, 8).state;
      expect(getCommanderDamage(s, bobId, commanderId)).toBe(9);
      expect(getCommanderDamage(s, bobId, secondId)).toBe(8);

      // Reset only the first commander (e.g. it changed zones).
      s = resetCommanderDamageFromCommander(s, commanderId);
      expect(getCommanderDamage(s, bobId, commanderId)).toBe(0);
      expect(getCommanderDamage(s, bobId, secondId)).toBe(8);
    });
  });

  describe("per-opponent tracking in multiplayer", () => {
    it("tracks damage from one commander to each opponent independently", () => {
      const multi = createGame(["Alice", "Bob", "Charlie"]);
      const ids = Array.from(multi.players.keys());
      const aId = ids[0];
      const bId = ids[1];
      const cId = ids[2];

      const setup = setupCommander(
        multi,
        aId,
        createMockCommander("Multi General", 6, 6),
      );
      let s = setup.state;
      const cmd = setup.commanderId;

      s = dealCommanderDamage(s, cmd, bId, 5).state;
      s = dealCommanderDamage(s, cmd, cId, 9).state;

      // Bob and Charlie have independent tallies; neither has lost.
      expect(getCommanderDamage(s, bId, cmd)).toBe(5);
      expect(getCommanderDamage(s, cId, cmd)).toBe(9);
      expect(hasLostFromCommanderDamage(s, bId)).toBe(false);
      expect(hasLostFromCommanderDamage(s, cId)).toBe(false);
      expect(getTotalCommanderDamage(s, bId)).toBe(5);
      expect(getTotalCommanderDamage(s, cId)).toBe(9);

      // Charlie hits 21 first and loses, while Bob is unaffected.
      s = dealCommanderDamage(s, cmd, cId, 12).state;
      expect(getCommanderDamage(s, cId, cmd)).toBe(21);
      expect(hasLostFromCommanderDamage(s, cId)).toBe(true);
      expect(hasLostFromCommanderDamage(s, bId)).toBe(false);
      expect(getCommanderDamage(s, bId, cmd)).toBe(5);
    });

    it("tracks two commanders (partner) against the same opponent separately", () => {
      let s = state;
      const first = commanderId;

      const partner = setupCommander(
        s,
        aliceId,
        createMockCommander("Partner General", 4, 4),
      );
      s = partner.state;
      const partnerId = partner.commanderId;

      // 20 from each is NOT lethal — CR 903.9a is per-commander, not summed.
      s = dealCommanderDamage(s, first, bobId, 20).state;
      s = dealCommanderDamage(s, partnerId, bobId, 20).state;

      expect(getCommanderDamage(s, bobId, first)).toBe(20);
      expect(getCommanderDamage(s, bobId, partnerId)).toBe(20);
      expect(hasLostFromCommanderDamage(s, bobId)).toBe(false);

      // One more point from the first commander is lethal for that commander.
      s = dealCommanderDamage(s, first, bobId, 1).state;
      expect(hasLostFromCommanderDamage(s, bobId)).toBe(true);
    });
  });

  describe("end-to-end through the combat pipeline", () => {
    it("declareAttackers + resolveCombatDamage reduces life AND tracks commander damage", () => {
      // Commander has power 5 -> deals 5 combat damage.
      let s = state;
      s.turn.currentPhase = Phase.DECLARE_ATTACKERS;

      const declare = declareAttackers(s, [
        { cardId: commanderId, defenderId: bobId },
      ]);
      expect(declare.success).toBe(true);
      expect(declare.errors ?? []).toHaveLength(0);
      s = declare.state;
      // Ensure combat is armed for resolution.
      s = {
        ...s,
        combat: { ...s.combat, inCombatPhase: true },
      };

      const bobLifeBefore = s.players.get(bobId)!.life;
      const resolve = resolveCombatDamage(s);
      expect(resolve.success).toBe(true);

      const after = resolve.state;
      // Life loss from the 5-power combat damage.
      expect(after.players.get(bobId)!.life).toBe(bobLifeBefore - 5);
      // Commander damage tallied separately on the receiver.
      expect(getCommanderDamage(after, bobId, commanderId)).toBe(5);
      expect(getTotalCommanderDamage(after, bobId)).toBe(5);
      expect(hasLostFromCommanderDamage(after, bobId)).toBe(false);
    });

    it("lethal commander combat damage ends the game through the pipeline", () => {
      // Pre-load 16 commander damage so a single 5-power combat hit reaches 21.
      let s = dealCommanderDamage(state, commanderId, bobId, 16).state;
      s.turn.currentPhase = Phase.DECLARE_ATTACKERS;

      const declare = declareAttackers(s, [
        { cardId: commanderId, defenderId: bobId },
      ]);
      expect(declare.success).toBe(true);
      s = { ...declare.state, combat: { ...declare.state.combat, inCombatPhase: true } };

      const resolve = resolveCombatDamage(s);
      const after = resolve.state;

      expect(getCommanderDamage(after, bobId, commanderId)).toBe(21);
      expect(hasLostFromCommanderDamage(after, bobId)).toBe(true);
      expect(after.players.get(bobId)!.hasLost).toBe(true);
    });
  });

  it("uses the canonical 21-damage threshold constant", () => {
    expect(DEFAULT_COMMANDER_DAMAGE_THRESHOLD).toBe(21);
  });
});
