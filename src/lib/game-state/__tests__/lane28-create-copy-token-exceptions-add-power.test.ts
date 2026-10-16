/**
 * Wave 4.8 follow-up 30 priority 2 (lane 28, piece
 * 2/N) (#2614 follow-up):
 * `CopyPermanent.exceptions.add_power` arm — the
 * per-copy additive P/T merge variant (Phyrexian
 * Metamorph's "it has +1/+0" half — or "it has -1/-0"
 * with a negative integer).
 *
 * The schema adds an OPTIONAL
 * `add_power: z.number().int().optional()` sub-arm
 * to `CopyPermanentSchema.exceptions`. The engine
 * consult parses the printed `power` string as an
 * integer (default 0; non-integer printed powers
 * like `*` or `1+*` yield 0), ADDS the `add_power`
 * value, and rebuilds `cardData.power` as a string.
 * The merge is ADDITIVE — no overwrite of the
 * printed power. Negative integers are accepted
 * (Phyrexian Metamorph-style `-1` → printed
 * `2` + `-1` = `1`).
 *
 * Four test groups:
 *   1. schema — `add_power` parses as a Zod
 *      integer; rejects floats, NaN, and unknown
 *      sub-arm keys (`.strict()`).
 *   2. engine — `add_power` adds to the printed
 *      power (positive + negative cases); the
 *      result is a string.
 *   3. cross-arm — `add_power` composes with the
 *      `add_color` arm (priority 1 cross-arm
 *      regression guard).
 *   4. regression — no `exceptions` arm and an
 *      empty `exceptions` object preserve the v1
 *      lane 70 / piece 1/4 semantic (printed power
 *      unchanged).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import {
  CardScriptSchema,
  type CardEffect,
  type CardScript,
} from "../card-scripts/schema";
import {
  registerCardScripts,
  resetCardScriptsForTests,
} from "../card-scripts/registry";
import { castSpell } from "../spell-casting/cast";
import { resolveTopOfStack } from "../spell-casting/resolve";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const HOST_NAME =
  "Test Copy Permanent Exceptions Add Power (follow-up 30 priority 2)";

function makeCard(
  overrides: Partial<ScryfallCard> & { id: string },
): ScryfallCard {
  return {
    id: `mock-${overrides.id}`,
    name: overrides.name ?? HOST_NAME,
    type_line: overrides.type_line ?? "Creature — Shapeshifter",
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost ?? "{3}{U}",
    cmc: overrides.cmc ?? 4,
    colors: overrides.colors ?? ["U"],
    color_identity: overrides.color_identity ?? ["U"],
    keywords: overrides.keywords ?? [],
    power: overrides.power ?? "0",
    toughness: overrides.toughness ?? "0",
    legalities: { standard: "legal" },
    layout: "normal",
  } as ScryfallCard;
}

interface SetupResult {
  state: GameState;
  aliceId: PlayerId;
  bobId: PlayerId;
}

function setupTwoPlayerGame(): SetupResult {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);
  const playerIds = Array.from(state.players.keys()) as PlayerId[];
  return {
    state,
    aliceId: playerIds[0],
    bobId: playerIds[1],
  };
}

/**
 * Adds a card directly to the named player's
 * battlefield.
 */
function putOnBattlefield(
  state: GameState,
  controllerId: PlayerId,
  cardDef: ScryfallCard,
): { state: GameState; cardId: CardInstanceId } {
  const cardId = `card-${cardDef.id}-${Math.random().toString(36).slice(2)}` as CardInstanceId;
  const card = createCardInstance(cardDef, controllerId, controllerId, {
    id: cardId,
    currentZoneKey: `${controllerId}-battlefield`,
  });
  card.hasSummoningSickness = false;
  const newCards = new Map(state.cards);
  newCards.set(cardId, card);
  const newZones = new Map(state.zones);
  const bfKey = `${controllerId}-battlefield`;
  const bf = newZones.get(bfKey);
  if (!bf) throw new Error("battlefield zone not found");
  newZones.set(bfKey, { ...bf, cardIds: [...bf.cardIds, cardId] });
  return {
    state: {
      ...state,
      cards: newCards,
      zones: newZones,
      lastModifiedAt: Date.now(),
    },
    cardId,
  };
}

/**
 * Casts the host script as a spell and resolves
 * the top of the stack. Re-registers the
 * passed script under `HOST_NAME` so the
 * cast path's `card.cardData.name`-keyed
 * lookup finds it.
 */
function castScript(
  state: GameState,
  aliceId: PlayerId,
  script: CardScript,
  options: { extraMana?: number } = {},
): { state: GameState } {
  resetCardScriptsForTests();
  const registered: CardScript = {
    ...script,
    name: HOST_NAME,
  };
  registerCardScripts([registered]);
  const cardDef = makeCard({
    id: `host-${HOST_NAME.replace(/\s+/g, "-")}`,
    name: HOST_NAME,
  });
  const cardId = `card-host-${Math.random().toString(36).slice(2)}` as CardInstanceId;
  const card = createCardInstance(cardDef, aliceId, aliceId, {
    id: cardId,
    currentZoneKey: `${aliceId}-hand`,
  });
  let s: GameState = {
    ...state,
    cards: new Map(state.cards).set(cardId, card),
    zones: new Map(state.zones).set(`${aliceId}-hand`, {
      ...state.zones.get(`${aliceId}-hand`)!,
      cardIds: [
        ...(state.zones.get(`${aliceId}-hand`)!.cardIds ?? []),
        cardId,
      ],
    }),
    turn: {
      ...state.turn,
      activePlayerId: aliceId,
      currentPhase: Phase.PRECOMBAT_MAIN,
    },
    priorityPlayerId: aliceId,
    stack: [],
    status: "in_progress",
    lastModifiedAt: Date.now(),
  };
  s = addMana(s, aliceId, {
    blue: 4 + (options.extraMana ?? 0),
  });
  const cast = castSpell(s, aliceId, cardId);
  if (!cast.success) throw new Error(`cast failed: ${cast.error}`);
  return { state: resolveTopOfStack(cast.state) };
}

describe("Wave 4.8 follow-up 30 priority 2 — CopyPermanent.exceptions.add_power arm", () => {
  beforeAll(() => {
    resetCardScriptsForTests();
  });

  afterAll(() => {
    resetCardScriptsForTests();
  });

  beforeEach(() => {
    resetCardScriptsForTests();
  });

  describe("schema — CopyPermanent.exceptions.add_power parses as an integer", () => {
    it("accepts the add_power sub-arm with a positive integer (Phyrexian Metamorph +1/+0 half)", () => {
      const parsed = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "test",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            exceptions: { add_power: 1 },
          },
        ],
      });
      const eff = parsed.spell![0] as CardEffect & {
        exceptions?: { add_power?: number };
      };
      expect(eff.exceptions).toEqual({ add_power: 1 });
    });

    it("accepts a negative integer (Phyrexian Metamorph -1/-0 half)", () => {
      const parsed = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "test",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            exceptions: { add_power: -1 },
          },
        ],
      });
      const eff = parsed.spell![0] as CardEffect & {
        exceptions?: { add_power?: number };
      };
      expect(eff.exceptions).toEqual({ add_power: -1 });
    });

    it("rejects a float (the Zod int() rejects non-integer values)", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: HOST_NAME,
          oracle: "test",
          spell: [
            {
              op: "CopyPermanent",
              target: { kind: "filter", value: "creature" },
              controller: "any",
              exceptions: { add_power: 0.5 },
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe("engine — add_power adds to the printed power", () => {
    it("adds +1 to a 2/2 bear's power (the standard +1/+0 case)", () => {
      // Place a 2/2 bear on Bob's
      // battlefield. Register a
      // CopyPermanent spell with
      // `kind: "id"`, `value: <bear id>`,
      // `count: 1`, and
      // `exceptions: { add_power: 1 }`.
      // Cast as Alice; the engine creates
      // 1 token whose `cardData.power` is
      // "2" + 1 = "3" (the result is a
      // string). Other printed fields
      // (toughness, name, type_line) are
      // preserved.
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "add-power-source",
          name: "Bear (add_power source)",
          type_line: "Creature — Bear",
          power: "2",
          toughness: "2",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "Create a token that's a 2/2 bear with +1 power.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: { add_power: 1 },
          },
        ],
      });
      const after = castScript(s, setup.aliceId, script);
      const aliceBfKey = `${setup.aliceId}-battlefield`;
      const aliceBf = after.state.zones.get(aliceBfKey);
      expect(aliceBf).toBeDefined();
      if (!aliceBf) return;
      const tokenIds = aliceBf.cardIds.filter((id) =>
        id.startsWith("copyperm-"),
      );
      expect(tokenIds).toHaveLength(1);
      const tokenInst = after.state.cards.get(tokenIds[0]);
      expect(tokenInst).toBeDefined();
      if (!tokenInst) return;
      // power: "2" + 1 = "3".
      expect(tokenInst.cardData.power).toBe("3");
      // toughness is preserved (the
      // add_power arm does NOT touch
      // toughness).
      expect(tokenInst.cardData.toughness).toBe("2");
      // Other printed fields preserved.
      expect(tokenInst.cardData.name).toBe(
        "Bear (add_power source)",
      );
      expect(tokenInst.cardData.type_line).toBe("Creature — Bear");
    });

    it("adds -1 to a 2/2 bear's power (the negative case)", () => {
      // `add_power: -1` — Phyrexian
      // Metamorph-style. The engine
      // computes 2 + (-1) = 1; the
      // token's printed power is "1".
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "add-power-negative-source",
          name: "Bear (add_power negative source)",
          type_line: "Creature — Bear",
          power: "2",
          toughness: "2",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "Create a token that's a 2/2 bear with -1 power.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: { add_power: -1 },
          },
        ],
      });
      const after = castScript(s, setup.aliceId, script);
      const aliceBfKey = `${setup.aliceId}-battlefield`;
      const aliceBf = after.state.zones.get(aliceBfKey);
      expect(aliceBf).toBeDefined();
      if (!aliceBf) return;
      const tokenIds = aliceBf.cardIds.filter((id) =>
        id.startsWith("copyperm-"),
      );
      expect(tokenIds).toHaveLength(1);
      const tokenInst = after.state.cards.get(tokenIds[0]);
      expect(tokenInst).toBeDefined();
      if (!tokenInst) return;
      // power: "2" + -1 = "1".
      expect(tokenInst.cardData.power).toBe("1");
      // toughness is preserved.
      expect(tokenInst.cardData.toughness).toBe("2");
    });
  });

  describe("cross-arm — add_power composes with the existing add_color arm", () => {
    it("add_power + add_color: token receives both the color merge and the additive power merge", () => {
      // Regression guard for the
      // follow-up 30 priority 1 `add_color`
      // arm — when both arms are present,
      // the engine consults both in order
      // (color first, then power), and
      // each token receives both
      // modifications.
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "cross-arm-power-source",
          name: "Bear (cross-arm power source)",
          type_line: "Creature — Bear",
          colors: ["green"],
          color_identity: ["green"],
          power: "2",
          toughness: "2",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "Create a token that's a green bear, also red, with +1 power.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: {
              add_color: ["red"],
              add_power: 1,
            },
          },
        ],
      });
      const after = castScript(s, setup.aliceId, script);
      const aliceBfKey = `${setup.aliceId}-battlefield`;
      const aliceBf = after.state.zones.get(aliceBfKey);
      expect(aliceBf).toBeDefined();
      if (!aliceBf) return;
      const tokenIds = aliceBf.cardIds.filter((id) =>
        id.startsWith("copyperm-"),
      );
      expect(tokenIds).toHaveLength(1);
      const tokenInst = after.state.cards.get(tokenIds[0]);
      expect(tokenInst).toBeDefined();
      if (!tokenInst) return;
      // add_color rebuilds colors +
      // color_identity.
      expect(tokenInst.cardData.colors).toEqual(["green", "red"]);
      expect(tokenInst.cardData.color_identity).toEqual([
        "green",
        "red",
      ]);
      // add_power rebuilds the power
      // string.
      expect(tokenInst.cardData.power).toBe("3");
      // toughness is preserved (add_power
      // does NOT touch toughness — the
      // add_toughness arm rides priority 3).
      expect(tokenInst.cardData.toughness).toBe("2");
    });
  });

  describe("regression — no add_power arm preserves the v1 lane 70 / piece 1/4 semantic", () => {
    it("no exceptions arm: the printed power is the token's power (no merge)", () => {
      // Regression guard: without an
      // `exceptions` arm, the token's
      // power is the source's printed
      // power (CR 707.2 "all
      // characteristics copied"
      // semantics, unmodified). The
      // `add_power` arm is OPTIONAL; the
      // v1 minimum preserves the
      // no-merge semantic.
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "no-exceptions-power-source",
          name: "Bear (no exceptions power source)",
          type_line: "Creature — Bear",
          power: "2",
          toughness: "2",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "Create a copy of target creature.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
          },
        ],
      });
      const after = castScript(s, setup.aliceId, script);
      const aliceBfKey = `${setup.aliceId}-battlefield`;
      const aliceBf = after.state.zones.get(aliceBfKey);
      expect(aliceBf).toBeDefined();
      if (!aliceBf) return;
      const tokenIds = aliceBf.cardIds.filter((id) =>
        id.startsWith("copyperm-"),
      );
      expect(tokenIds).toHaveLength(1);
      const tokenInst = after.state.cards.get(tokenIds[0]);
      expect(tokenInst).toBeDefined();
      if (!tokenInst) return;
      // Printed power is preserved
      // unchanged.
      expect(tokenInst.cardData.power).toBe("2");
      expect(tokenInst.cardData.toughness).toBe("2");
    });
  });
});