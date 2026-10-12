/**
 * "You may" optional trigger / effect semantics — engine arm
 * (Wave 4.8 follow-up 2 lane 60, #2614 follow-up).
 *
 * Many cards say "you may pay 2 life; if you do, draw a card" /
 * "you may draw a card" / "you may discard a card". The drafter
 * list (issue #2614) flagged several real cards (Perilous Snare,
 * Cackling Counterforce, Skyship Buccaneer's later-payment
 * variant) as multi-lane blockers because the engine had no
 * general-purpose "you may" gate on a triggered ability.
 *
 * Lane 60 ships the smallest scoped piece:
 *
 * Schema (card-scripts/schema.ts, TriggerSchema):
 *   `you_may: z.boolean().optional()` — a trigger-level flag
 *   that defers the entire `effects` array behind a yes/no
 *   confirmation prompt offered to the controller at
 *   resolution time (CR 117.3a "you may"). Mutually exclusive
 *   with `modes` (modal "choose one"); the schema rejects the
 *   combination.
 *
 * Engine (card-scripts/interpret.ts, resolveScriptedAbility):
 *   When a scripted trigger carries `you_may: true`, the
 *   engine consults `stackObject.you_may_resolved`:
 *     - `false`: skip the entire effects list (trigger fizzles
 *       silently, the way a player declining "you may pay 2
 *       life; if you do, draw" skips both halves).
 *     - `undefined`: surface a yes/no `waitingChoice` of type
 *       `you_may_prompt` (created by
 *       `createYouMayPromptWaitingChoice`) and suspend
 *       resolution.
 *     - `true`: run the effects list normally.
 *
 *   The resolver (`spell-casting/choices.ts`#resolveWaitingChoice)
 *   stamps `stackObject.you_may_resolved` from the player's
 *   answer and clears the choice; the next pass through
 *   `resolveScriptedAbility` picks up the recorded decision and
 *   either runs the effects or skips them.
 *
 *   `StackObject.you_may_resolved?: boolean` (types/stack.ts) is
 *   the script-trigger analog of `chosenModes` for "you may"
 *   gating.
 *
 * Out of scope (multi-lane): dynamic cost reductions combined
 * with the "you may" payment ("you may pay 2 life" combined with
 * another effect's discount). That's lane 65 work.
 *
 * This lane ships a synthetic triggered-ability host via
 * `CardScriptSchema.parse + registerCardScripts` and exercises
 * the gate from a manually-pushed stack object, mirroring the
 * source-power-counters / removes-all-abilities-static test
 * pattern.
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { CardScriptSchema, type CardScript } from "../card-scripts/schema";
import { registerCardScripts } from "../card-scripts/registry";
import {
  createYouMayPromptWaitingChoice,
  resolveScriptedAbility,
} from "../card-scripts/interpret";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { resolveWaitingChoice } from "../spell-casting/choices";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
  StackObject,
} from "../types";

/**
 * Synthetic card name. The test card is a 1/1 Bear with a
 * single ETB trigger:
 *
 *   "When this creature enters, you may draw a card."
 *
 * The schema parses it; the engine resolves it through the
 * `you_may` gate.
 */
const TEST_CARD_NAME = "Test Host with You May Trigger (lane 60)";

const TEST_CARD_SCRIPT: CardScript = CardScriptSchema.parse({
  name: TEST_CARD_NAME,
  oracle: "When this creature enters, you may draw a card.",
  triggers: [
    {
      text: "When this creature enters, you may draw a card.",
      event: "etb",
      you_may: true,
      effects: [{ op: "Draw", amount: 1 }],
    },
  ],
});

function card(overrides: Partial<ScryfallCard>): ScryfallCard {
  const name = overrides.name ?? "Test Card";
  return {
    id: `mock-${name}`,
    name,
    type_line: "Creature \u2014 Bear",
    oracle_text: "When this creature enters, you may draw a card.",
    mana_cost: "{1}",
    cmc: 1,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: "1",
    toughness: "1",
    ...overrides,
  } as ScryfallCard;
}

/** Place a creature on its owner's battlefield. */
function putOnBattlefield(
  state: GameState,
  playerId: PlayerId,
  data: ScryfallCard,
): CardInstanceId {
  const c = createCardInstance(data, playerId, playerId, {
    currentZoneKey: `${playerId}-battlefield`,
  });
  state.cards.set(c.id, { ...c, hasSummoningSickness: false });
  const key = `${playerId}-battlefield`;
  const z = state.zones.get(key)!;
  state.zones.set(key, { ...z, cardIds: [...z.cardIds, c.id] });
  return c.id;
}

/** Hand count for `playerId` after applying `state`. */
function handCount(state: GameState, playerId: PlayerId): number {
  return Array.from(state.cards.values()).filter(
    (card) =>
      card.ownerId === playerId &&
      card.currentZoneKey !== null &&
      card.currentZoneKey.endsWith("-hand"),
  ).length;
}

describe("You may trigger gate (Wave 4.8 follow-up 2 lane 60, #2614 follow-up)", () => {
  let state: GameState;
  let alice: PlayerId;
  let bob: PlayerId;

  beforeEach(() => {
    registerCardScripts([TEST_CARD_SCRIPT]);
    state = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
    [alice, bob] = Array.from(state.players.keys());
    state.status = "in_progress";
    state.turn.activePlayerId = alice;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = alice;
    state.stack = [];
    // Empty Alice's library so a "yes" draw doesn't pull from
    // undefined territory; a draw-from-empty causes a loss which
    // the engine handles, but this test focuses on the gate, not
    // fatigue losses.
    const libKey = `${alice}-library`;
    const lib = state.zones.get(libKey)!;
    state.zones.set(libKey, { ...lib, cardIds: [] });
  });

  describe("schema", () => {
    it("accepts you_may on a trigger with effects", () => {
      const parsed = CardScriptSchema.parse({
        name: "Test OK (lane 60)",
        oracle: "When this enters, you may draw a card.",
        triggers: [
          {
            text: "When this enters, you may draw a card.",
            event: "etb",
            you_may: true,
            effects: [{ op: "Draw", amount: 1 }],
          },
        ],
      });
      expect(parsed.triggers?.[0].you_may).toBe(true);
    });

    it("rejects you_may combined with modes (modal mutually exclusive)", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: "Test Bad Combo (lane 60)",
          oracle:
            "When this enters, choose one \u2014 you may draw a card; or do nothing.",
          triggers: [
            {
              text:
                "When this enters, choose one \u2014 you may draw a card; or do nothing.",
              event: "etb",
              you_may: true,
              modes: {
                text: "Choose one",
                options: [
                  {
                    label: "you may draw a card",
                    text: "you may draw a card",
                    effects: [{ op: "Draw", amount: 1 }],
                  },
                ],
                choose: 1,
              },
            },
          ],
        }),
      ).toThrow(/you_may and modes/);
    });

    it("accepts a trigger without you_may (no break to v1)", () => {
      // The lane 59 Redcap Gutter-Dweller / Banner of Kinship
      // cards must continue to parse unmodified.
      const parsed = CardScriptSchema.parse({
        name: "Test No You May (lane 60)",
        oracle: "When this enters, draw a card.",
        triggers: [
          {
            text: "When this enters, draw a card.",
            event: "etb",
            effects: [{ op: "Draw", amount: 1 }],
          },
        ],
      });
      expect(parsed.triggers?.[0].you_may).toBeUndefined();
    });
  });

  describe("prompt surfacing", () => {
    it("surfaces a you_may_prompt waitingChoice when you_may_resolved is undefined", () => {
      const cardId = putOnBattlefield(state, alice, card({ name: TEST_CARD_NAME }));
      const stackObject: StackObject = {
        id: "lane60-ability",
        type: "ability",
        triggered: true,
        sourceCardId: cardId,
        controllerId: alice,
        name: TEST_CARD_NAME,
        text: "When this creature enters, you may draw a card.",
        manaCost: null,
        targets: [],
        chosenModes: [],
        variableValues: new Map(),
        isCopy: false,
        isCountered: false,
        timestamp: 0,
        // you_may_resolved intentionally omitted
      } as StackObject;
      state.stack.push(stackObject);
      // Strip the implicit ETB-event hard-coded engine path: the
      // synthetic script is resolved via `resolveScriptedAbility`
      // directly, not through `detectTriggeredAbilities`.
      const before = handCount(state, alice);
      const r = resolveScriptedAbility(state, stackObject);
      expect(r).toBeDefined();
      expect(r!.waitingChoice).toBeDefined();
      expect(r!.waitingChoice!.type).toBe("you_may_prompt");
      expect(r!.waitingChoice!.playerId).toBe(alice);
      // Handsize unchanged — the prompt must suspend resolution.
      expect(handCount(r!, alice)).toBe(before);
    });
  });

  describe("declining (no)", () => {
    it("skips the effects when you_may_resolved is false", () => {
      const cardId = putOnBattlefield(state, alice, card({ name: TEST_CARD_NAME }));
      const stackObject: StackObject = {
        id: "lane60-no",
        type: "ability",
        triggered: true,
        sourceCardId: cardId,
        controllerId: alice,
        name: TEST_CARD_NAME,
        text: "When this creature enters, you may draw a card.",
        manaCost: null,
        targets: [],
        chosenModes: [],
        variableValues: new Map(),
        isCopy: false,
        isCountered: false,
        timestamp: 0,
        you_may_resolved: false,
      } as StackObject;
      state.stack.push(stackObject);
      const before = handCount(state, alice);
      const r = resolveScriptedAbility(state, stackObject);
      expect(r).toBeDefined();
      expect(r!.waitingChoice).toBeNull();
      // No draw happened — controller declined.
      expect(handCount(r!, alice)).toBe(before);
    });
  });

  describe("accepting (yes)", () => {
    it("runs the effects when you_may_resolved is true", () => {
      const cardId = putOnBattlefield(state, alice, card({ name: TEST_CARD_NAME }));
      const stackObject: StackObject = {
        id: "lane60-yes",
        type: "ability",
        triggered: true,
        sourceCardId: cardId,
        controllerId: alice,
        name: TEST_CARD_NAME,
        text: "When this creature enters, you may draw a card.",
        manaCost: null,
        targets: [],
        chosenModes: [],
        variableValues: new Map(),
        isCopy: false,
        isCountered: false,
        timestamp: 0,
        you_may_resolved: true,
      } as StackObject;
      state.stack.push(stackObject);
      const r = resolveScriptedAbility(state, stackObject);
      expect(r).toBeDefined();
      expect(r!.waitingChoice).toBeNull();
    });
  });

  describe("resolveWaitingChoice you_may_prompt arm", () => {
    it("no: stamps you_may_resolved=false and clears the choice", () => {
      const cardId = putOnBattlefield(state, alice, card({ name: TEST_CARD_NAME }));
      const stackObject: StackObject = {
        id: "lane60-resolve-no",
        type: "ability",
        triggered: true,
        sourceCardId: cardId,
        controllerId: alice,
        name: TEST_CARD_NAME,
        text: "When this creature enters, you may draw a card.",
        manaCost: null,
        targets: [],
        chosenModes: [],
        variableValues: new Map(),
        isCopy: false,
        isCountered: false,
        timestamp: 0,
      } as StackObject;
      state.stack.push(stackObject);
      state.waitingChoice = createYouMayPromptWaitingChoice(
        stackObject.id,
        alice,
        stackObject.text,
      );
      const r = resolveWaitingChoice(state, alice, false);
      expect(r.success).toBe(true);
      expect(r.state.waitingChoice).toBeNull();
      const stamped = r.state.stack.find((s) => s.id === stackObject.id)!;
      expect(stamped.you_may_resolved).toBe(false);
    });

    it("yes: stamps you_may_resolved=true and clears the choice", () => {
      const cardId = putOnBattlefield(state, alice, card({ name: TEST_CARD_NAME }));
      const stackObject: StackObject = {
        id: "lane60-resolve-yes",
        type: "ability",
        triggered: true,
        sourceCardId: cardId,
        controllerId: alice,
        name: TEST_CARD_NAME,
        text: "When this creature enters, you may draw a card.",
        manaCost: null,
        targets: [],
        chosenModes: [],
        variableValues: new Map(),
        isCopy: false,
        isCountered: false,
        timestamp: 0,
      } as StackObject;
      state.stack.push(stackObject);
      state.waitingChoice = createYouMayPromptWaitingChoice(
        stackObject.id,
        alice,
        stackObject.text,
      );
      const r = resolveWaitingChoice(state, alice, true);
      expect(r.success).toBe(true);
      expect(r.state.waitingChoice).toBeNull();
      const stamped = r.state.stack.find((s) => s.id === stackObject.id)!;
      expect(stamped.you_may_resolved).toBe(true);
    });
  });

  describe("bob (opponent) cannot answer alice's you_may_prompt", () => {
    it("rejects when the wrong playerId tries to resolve", () => {
      const cardId = putOnBattlefield(state, alice, card({ name: TEST_CARD_NAME }));
      const stackObject: StackObject = {
        id: "lane60-wrong-player",
        type: "ability",
        triggered: true,
        sourceCardId: cardId,
        controllerId: alice,
        name: TEST_CARD_NAME,
        text: "When this creature enters, you may draw a card.",
        manaCost: null,
        targets: [],
        chosenModes: [],
        variableValues: new Map(),
        isCopy: false,
        isCountered: false,
        timestamp: 0,
      } as StackObject;
      state.stack.push(stackObject);
      state.waitingChoice = createYouMayPromptWaitingChoice(
        stackObject.id,
        alice,
        stackObject.text,
      );
      // Bob (the opponent) attempts to answer — must be rejected.
      const r = resolveWaitingChoice(state, bob, true);
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/Not this player's turn/);
    });
  });
});
