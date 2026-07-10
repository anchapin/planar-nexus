/**
 * Mutation-targeted edge cases for `trigger-system.ts`.
 *
 * Issue #1395: Stryker mutation suites for the rules engine. These tests pin
 * down the boundary/condition mutants Stryker otherwise reports as surviving
 * in the CR 603 trigger-firing code:
 *
 *  - Intervening-"if" gate at trigger time (CR 603.4): the `continue` that
 *    suppresses a trigger whose clause is false.
 *  - Untap-step "YOUR" gating (CR 502.3): only the active player's controller
 *    fires (`card.controllerId !== activePlayerId`).
 *  - Prowess noncreature gating + "you cast" ownership (CR 702.108), incl.
 *    multiple instances (CR 702.108b).
 *  - Storm copy-count math (CR 702.41): `castThisTurn - 1` + `Math.max`.
 *  - Monarchy-change trigger scoping (issue #1225): monarch controller only.
 *  - APNAP ordering (CR 603.3): active player stacks first.
 *  - `putTriggersOnStack` preserves the intervening-if on the stack object.
 */

import {
  detectTurnStartTriggers,
  detectUntapStepTriggers,
  detectProwessTriggers,
  detectStormTrigger,
  detectMonarchyChangeTriggers,
  putTriggersOnStack,
} from "../trigger-system";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  StackObject,
} from "../types";
import type { ScryfallCard } from "@/app/actions";

function makeGame(players = 2): { state: GameState; ids: PlayerId[] } {
  let state = createInitialGameState(
    players === 1 ? ["Alice"] : ["Alice", "Bob"],
    20,
    false,
  );
  state = startGame(state);
  return { state, ids: Array.from(state.players.keys()) };
}

function mkCard(
  name: string,
  oracle: string,
  opts: { type?: string; keywords?: string[] } = {},
): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: opts.type ?? `Creature — ${name}`,
    keywords: opts.keywords ?? [],
    oracle_text: oracle,
    mana_cost: "{1}",
    cmc: 2,
    colors: ["R"],
    color_identity: ["R"],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
  } as ScryfallCard;
}

/** Place a card on a player's battlefield and return its id. */
function placeOnBf(
  state: GameState,
  cardData: ScryfallCard,
  controllerId: PlayerId,
): CardInstanceId {
  const card = createCardInstance(cardData, controllerId, controllerId);
  card.hasSummoningSickness = false;
  const zoneKey = `${controllerId}-battlefield`;
  card.currentZoneKey = zoneKey;
  const bf = state.zones.get(zoneKey)!;
  state.zones.set(zoneKey, { ...bf, cardIds: [...bf.cardIds, card.id] });
  state.cards.set(card.id, card);
  return card.id;
}

/** Push a synthetic spell object onto the stack (for storm detection). */
function pushStackObject(
  state: GameState,
  controllerId: PlayerId,
  storm = false,
): string {
  const id = `stack-${Math.random().toString(36).slice(2)}`;
  const obj: StackObject = {
    id,
    type: "spell",
    sourceCardId: "src-1",
    controllerId,
    name: "Storm Spell",
    text: "",
    manaCost: null,
    targets: [],
    chosenModes: [],
    variableValues: new Map(),
    isCountered: false,
    timestamp: Date.now(),
    // The storm marker is carried as an ad-hoc flag on the stack object.
  } as StackObject;
  (obj as unknown as { storm: boolean }).storm = storm;
  state.stack.push(obj);
  return id;
}

describe("trigger-system mutation edge cases (#1395)", () => {
  // -------------------------------------------------------------------------
  // Intervening-"if" gate at trigger time (CR 603.4)
  // -------------------------------------------------------------------------
  describe("intervening-if at trigger time (CR 603.4)", () => {
    it("suppresses an upkeep trigger whose intervening-if is false", () => {
      const { state, ids } = makeGame(1);
      // "you have 50 or more life" — Alice has 20, so the clause is FALSE.
      placeOnBf(
        state,
        mkCard("Test of Endurance", "At the beginning of your upkeep, if you have 50 or more life, you win the game."),
        ids[0],
      );

      const triggers = detectTurnStartTriggers(state, ids[0]);

      expect(triggers).toHaveLength(0);
    });

    it("fires an upkeep trigger whose intervening-if is true", () => {
      const { state, ids } = makeGame(1);
      placeOnBf(
        state,
        mkCard("Test of Endurance", "At the beginning of your upkeep, if you have 50 or more life, you win the game."),
        ids[0],
      );
      state.players.get(ids[0])!.life = 50;

      const triggers = detectTurnStartTriggers(state, ids[0]);

      expect(triggers).toHaveLength(1);
      expect(triggers[0].interveningIf).toBe("you have 50 or more life");
    });
  });

  // -------------------------------------------------------------------------
  // Untap-step "YOUR" gating (CR 502.3)
  // -------------------------------------------------------------------------
  describe("untap-step trigger ownership (CR 502.3)", () => {
    it("fires only for the active player's own untap-step trigger", () => {
      const { state, ids } = makeGame();
      const [alice, bob] = ids;
      placeOnBf(
        state,
        mkCard("Alarm", "At the beginning of your untap step, untap all creatures you control."),
        alice,
      );
      placeOnBf(
        state,
        mkCard("Bobs Alarm", "At the beginning of your untap step, untap all creatures you control."),
        bob,
      );

      // Alice is the active player: only her trigger fires.
      const aliceActive = detectUntapStepTriggers(state, alice);
      expect(aliceActive).toHaveLength(1);
      expect(aliceActive[0].triggeringPlayerId).toBe(alice);

      // Bob active: only Bob's fires.
      const bobActive = detectUntapStepTriggers(state, bob);
      expect(bobActive).toHaveLength(1);
      expect(bobActive[0].triggeringPlayerId).toBe(bob);
    });
  });

  // -------------------------------------------------------------------------
  // Prowess gating (CR 702.108)
  // -------------------------------------------------------------------------
  describe("prowess trigger gating (CR 702.108)", () => {
    function prowessCreature(name: string, instances = 1): ScryfallCard {
      return mkCard(name, "Prowess", {
        keywords: Array.from({ length: instances }, () => "Prowess"),
      });
    }
    function sorcery(): ScryfallCard {
      return mkCard("Sorcery", "Draw a card.", { type: "Sorcery" });
    }
    function creatureSpell(): ScryfallCard {
      return mkCard("Bear Spell", "", { type: "Creature — Bear" });
    }

    it("does NOT fire prowess for a creature spell (kills creature-gate removal)", () => {
      const { state, ids } = makeGame(1);
      placeOnBf(state, prowessCreature("Monk"), ids[0]);
      const spell = placeOnBf(state, creatureSpell(), ids[0]);

      const triggers = detectProwessTriggers(state, spell, ids[0], ids[0]);
      expect(triggers).toHaveLength(0);
    });

    it("fires prowess once for a single instance on a noncreature spell", () => {
      const { state, ids } = makeGame(1);
      placeOnBf(state, prowessCreature("Monk"), ids[0]);
      const spell = placeOnBf(state, sorcery(), ids[0]);

      const triggers = detectProwessTriggers(state, spell, ids[0], ids[0]);
      expect(triggers).toHaveLength(1);
    });

    it("fires prowess per instance when a creature has it twice (CR 702.108b)", () => {
      const { state, ids } = makeGame(1);
      placeOnBf(state, prowessCreature("Double Monk", 2), ids[0]);
      const spell = placeOnBf(state, sorcery(), ids[0]);

      const triggers = detectProwessTriggers(state, spell, ids[0], ids[0]);
      expect(triggers).toHaveLength(2);
    });

    it("does NOT fire prowess for an opponent's creature (kills ownership-gate removal)", () => {
      const { state, ids } = makeGame();
      const [alice, bob] = ids;
      placeOnBf(state, prowessCreature("Bobs Monk"), bob);
      const spell = placeOnBf(state, sorcery(), alice);

      // Alice cast the spell; Bob's prowess creature must NOT trigger.
      const triggers = detectProwessTriggers(state, spell, alice, alice);
      expect(triggers).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Storm copy-count math (CR 702.41)
  // -------------------------------------------------------------------------
  describe("storm copy-count math (CR 702.41)", () => {
    it("reports zero copies when the storm spell is the first cast this turn", () => {
      const { state, ids } = makeGame(1);
      const objId = pushStackObject(state, ids[0], true);
      state.players.get(ids[0])!.spellsCastThisTurn = 1;

      const result = detectStormTrigger(state, objId);
      expect(result.shouldFire).toBe(false);
      expect(result.copyCount).toBe(0);
    });

    it("copies = spellsCastThisTurn - 1 (kills the `- 1` removal mutant)", () => {
      const { state, ids } = makeGame(1);
      const objId = pushStackObject(state, ids[0], true);
      state.players.get(ids[0])!.spellsCastThisTurn = 3;

      const result = detectStormTrigger(state, objId);
      expect(result.shouldFire).toBe(true);
      expect(result.copyCount).toBe(2);
    });

    it("never reports a negative copy count (kills Math.max removal)", () => {
      const { state, ids } = makeGame(1);
      const objId = pushStackObject(state, ids[0], true);
      // Defensive: count below 1 must clamp to 0, not go negative.
      state.players.get(ids[0])!.spellsCastThisTurn = 0;

      const result = detectStormTrigger(state, objId);
      expect(result.copyCount).toBe(0);
      expect(result.shouldFire).toBe(false);
    });

    it("ignores a non-storm stack object", () => {
      const { state, ids } = makeGame(1);
      const objId = pushStackObject(state, ids[0], false);
      state.players.get(ids[0])!.spellsCastThisTurn = 5;

      const result = detectStormTrigger(state, objId);
      expect(result.shouldFire).toBe(false);
      expect(result.copyCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Monarchy-change trigger scoping (issue #1225)
  // -------------------------------------------------------------------------
  describe("monarchy-change trigger scoping (#1225)", () => {
    function monarchCard(name: string, controller: PlayerId, state: GameState): CardInstanceId {
      return placeOnBf(
        state,
        mkCard(name, "Whenever you become the monarch, draw a card."),
        controller,
      );
    }

    it("fires for permanents controlled by the current monarch only", () => {
      const { state, ids } = makeGame();
      const [alice, bob] = ids;
      state.players.get(alice)!.isMonarch = true;
      monarchCard("Regal A", alice, state);
      monarchCard("Regal B", bob, state); // Bob is NOT the monarch.

      const triggers = detectMonarchyChangeTriggers(state, alice);
      expect(triggers).toHaveLength(1);
      expect(triggers[0].triggeringPlayerId).toBe(alice);
    });

    it("fires nothing when there is no monarch", () => {
      const { state, ids } = makeGame(1);
      monarchCard("Regal", ids[0], state);

      const triggers = detectMonarchyChangeTriggers(state, ids[0]);
      expect(triggers).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // APNAP ordering (CR 603.3)
  // -------------------------------------------------------------------------
  describe("APNAP ordering (CR 603.3)", () => {
    it("stacks the active player's trigger ahead of the non-active player's", () => {
      const { state, ids } = makeGame();
      const [alice, bob] = ids;
      placeOnBf(
        state,
        mkCard("Alices Upkeep", "At the beginning of your upkeep, draw a card."),
        alice,
      );
      placeOnBf(
        state,
        mkCard("Bobs Upkeep", "At the beginning of your upkeep, draw a card."),
        bob,
      );

      const triggers = detectTurnStartTriggers(state, alice);
      expect(triggers).toHaveLength(2);
      // Active player (Alice) is ordered first → resolves last, but is FIRST
      // in the array that putTriggersOnStack consumes.
      expect(triggers[0].triggeringPlayerId).toBe(alice);
      expect(triggers[1].triggeringPlayerId).toBe(bob);
    });
  });

  // -------------------------------------------------------------------------
  // putTriggersOnStack
  // -------------------------------------------------------------------------
  describe("putTriggersOnStack preserves intervening-if", () => {
    it("copies the intervening-if onto the generated stack object", () => {
      const { state, ids } = makeGame(1);
      state.players.get(ids[0])!.life = 50;
      const sourceId = placeOnBf(
        state,
        mkCard("Test of Endurance", "At the beginning of your upkeep, if you have 50 or more life, you win the game."),
        ids[0],
      );
      const triggers = detectTurnStartTriggers(state, ids[0]);
      expect(triggers).toHaveLength(1);

      const result = putTriggersOnStack(state, triggers);
      const stackObj = result.state.stack.find((o) => o.sourceCardId === sourceId)!;

      expect(stackObj).toBeDefined();
      expect(stackObj.interveningIf).toBe("you have 50 or more life");
      expect(stackObj.type).toBe("ability");
    });
  });
});
