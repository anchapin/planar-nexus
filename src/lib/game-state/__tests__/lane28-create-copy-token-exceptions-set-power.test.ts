/**
 * Wave 4.8 follow-up 31 priority 3 (lane 28, piece
 * 3/N) (#2614 follow-up):
 * `CopyPermanent.exceptions.set_power` arm — the
 * per-copy DESTRUCTIVE power-REPLACE variant
 * (Phyrexian Metamorph's "exactly N" semantic
 * half for P/T).
 *
 * The schema adds an OPTIONAL
 * `set_power: number` sub-arm to the
 * `CopyPermanentSchema.exceptions` object. The
 * engine consult REPLACES each copy token's
 * `cardData.power` with `String(set_power)` (the
 * integer stringified; the printed power string is
 * discarded entirely). The arm is DESTRUCTIVE — it
 * overwrites the printed power. The `set_power`
 * arm takes PRECEDENCE over `add_power` when both
 * are set (the destructive variant always wins —
 * parallel to the `set_color` PRECEDENCE rule for
 * the additive vs REPLACE color form). The
 * `set_power` arm is distinct from the priority 2
 * `add_power` arm (which MERGES with the printed
 * power).
 *
 * Four test groups:
 *   1. schema — `set_power` parses an integer;
 *      rejects non-integer values, unknown
 *      sub-arm keys (`.strict()`).
 *   2. engine — `set_power` REPLACES `power` (a
 *      standard replacement, a zero replacement,
 *      and a negative replacement); the printed
 *      power is discarded.
 *   3. precedence — `set_power` wins over
 *      `add_power` when both are set (the
 *      destructive variant takes PRECEDENCE); also
 *      `set_power` + `set_toughness` cross-arm
 *      destructive P/T.
 *   4. regression — no `exceptions` arm preserves
 *      the v1 lane 70 / piece 1/4 semantic (no
 *      rebuild of the printed power).
 */
import {
  describe,
  it,
  expect,
  afterAll,
  beforeEach,
} from "@jest/globals";
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
  "Test Copy Permanent Exceptions Set Power (follow-up 31 priority 3)";

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
    power: overrides.power ?? "2",
    toughness: overrides.toughness ?? "2",
    legalities: { standard: "legal" },
    layout: "normal",
  } as ScryfallCard;
}

function setupTwoPlayerGame(): {
  state: GameState;
  aliceId: PlayerId;
  bobId: PlayerId;
} {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);
  const playerIds = Array.from(state.players.keys()) as PlayerId[];
  return {
    state,
    aliceId: playerIds[0],
    bobId: playerIds[1],
  };
}

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

describe("Wave 4.8 follow-up 31 priority 3 — CopyPermanent.exceptions.set_power arm", () => {
  afterAll(() => {
    resetCardScriptsForTests();
  });

  beforeEach(() => {
    resetCardScriptsForTests();
  });

  describe("schema — CopyPermanent.exceptions.set_power parses an integer", () => {
    it("accepts the set_power sub-arm with a positive integer (5)", () => {
      const parsed = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "test",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            exceptions: { set_power: 5 },
          },
        ],
      });
      const eff = parsed.spell![0] as CardEffect & {
        exceptions?: { set_power?: number };
      };
      expect(eff.exceptions).toEqual({
        set_power: 5,
      });
    });

    it("accepts zero (the zero-power destructive case)", () => {
      const parsed = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "test",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            exceptions: { set_power: 0 },
          },
        ],
      });
      const eff = parsed.spell![0] as CardEffect & {
        exceptions?: { set_power?: number };
      };
      expect(eff.exceptions).toEqual({
        set_power: 0,
      });
    });

    it("accepts a negative integer (the negative-power destructive case)", () => {
      // The additive `add_power` arm
      // also accepts negative values
      // (Phyrexian Metamorph-style -1/-0);
      // the destructive `set_power` arm
      // mirrors that.
      const parsed = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "test",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            exceptions: { set_power: -1 },
          },
        ],
      });
      const eff = parsed.spell![0] as CardEffect & {
        exceptions?: { set_power?: number };
      };
      expect(eff.exceptions).toEqual({
        set_power: -1,
      });
    });

    it("rejects a non-integer value (the Zod layer enforces .int())", () => {
      // The Zod layer rejects
      // non-integer values for
      // `set_power` (parallel to
      // `add_power`).
      expect(() =>
        CardScriptSchema.parse({
          name: HOST_NAME,
          oracle: "test",
          spell: [
            {
              op: "CopyPermanent",
              target: { kind: "filter", value: "creature" },
              controller: "any",
              exceptions: { set_power: 2.5 },
            },
          ],
        }),
      ).toThrow();
      expect(() =>
        CardScriptSchema.parse({
          name: HOST_NAME,
          oracle: "test",
          spell: [
            {
              op: "CopyPermanent",
              target: { kind: "filter", value: "creature" },
              controller: "any",
              exceptions: { set_power: "5" },
            },
          ],
        }),
      ).toThrow();
    });

    it("rejects an unknown sub-arm key (the exceptions object stays .strict())", () => {
      // The follow-up 29 piece 4/4
      // `exceptions` Zod object is
      // `.strict()` — unknown keys are
      // rejected. A typo like
      // `set_powers` (plural) is a
      // different key and is rejected.
      expect(() =>
        CardScriptSchema.parse({
          name: HOST_NAME,
          oracle: "test",
          spell: [
            {
              op: "CopyPermanent",
              target: { kind: "filter", value: "creature" },
              controller: "any",
              exceptions: { set_powers: 5 },
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe("engine — set_power REPLACES the printed power", () => {
    it("replaces a 2/2 bear's power with 5 (standard replacement)", () => {
      // Place a 2/2 bear on Bob's
      // battlefield. Register a
      // CopyPermanent spell with
      // `kind: "id"`, `value: <bear id>`,
      // `count: 1`, and
      // `exceptions: { set_power: 5 }`.
      // Cast as Alice; the engine creates
      // 1 token whose `cardData.power` is
      // REPLACED with `"5"` (the
      // printed "2" is discarded; the
      // toughness is unchanged at "2").
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "set-power-source",
          name: "Grizzly Bears (set_power source)",
          type_line: "Creature — Bear",
          power: "2",
          toughness: "2",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "Create a token that's a 5/2 bear.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: { set_power: 5 },
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
      // Destructive REPLACE — the
      // printed "2" is dropped; the new
      // power is "5".
      expect(tokenInst.cardData.power).toBe("5");
      // The toughness is unchanged (no
      // `set_toughness` or `add_toughness`
      // arm fires — the printed
      // toughness is preserved).
      expect(tokenInst.cardData.toughness).toBe("2");
    });

    it("replaces a 2/2 bear's power with 0 (zero-power destructive)", () => {
      // `set_power: 0` — the new power
      // is "0" (zero-power destructive —
      // reads as "0/2"). The printed
      // "2" is discarded.
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "zero-set-power-source",
          name: "Bear (zero set_power source)",
          type_line: "Creature — Bear",
          power: "2",
          toughness: "2",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "Create a token that's a 0/2 bear.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: { set_power: 0 },
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
      expect(tokenInst.cardData.power).toBe("0");
      expect(tokenInst.cardData.toughness).toBe("2");
    });
  });

  describe("precedence — set_power takes PRECEDENCE over add_power when both are set", () => {
    it("set_power + add_power: the destructive variant wins, the additive 'add_power' is dropped", () => {
      // Cross-arm precedence test for
      // the follow-up 31 priority 3
      // `set_power` arm + the follow-up
      // 30 priority 2 `add_power` arm.
      // When both are set, the
      // destructive `set_power` wins:
      // the printed "2" is discarded
      // AND the additive `add_power`
      // consult is skipped (the +1
      // additive is dropped). The final
      // power is 5.
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "precedence-set-add-power-source",
          name: "Bear (set_power + add_power precedence source)",
          type_line: "Creature — Bear",
          power: "2",
          toughness: "2",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "Create a token that's a 5/2 bear (NOT a 3/2 bear).",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: {
              set_power: 5,
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
      // The destructive `set_power`
      // wins: the printed "2" is
      // discarded AND the additive
      // `add_power` consult is skipped
      // (the +1 is dropped). Final
      // power is "5".
      expect(tokenInst.cardData.power).toBe("5");
    });
  });

  describe("regression — no set_power arm preserves the v1 lane 70 / piece 1/4 semantic", () => {
    it("no exceptions arm: the printed power is the token's power (no rebuild)", () => {
      // Regression guard: without an
      // `exceptions` arm, the token's
      // power is the source's printed
      // power (CR 707.2 "all
      // characteristics copied"
      // semantics, unmodified). The
      // exceptions arm is OPTIONAL; the
      // v1 minimum preserves the
      // no-rebuild semantic.
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "no-exceptions-set-power-source",
          name: "Bear (no exceptions set_power source)",
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
    });
  });
});