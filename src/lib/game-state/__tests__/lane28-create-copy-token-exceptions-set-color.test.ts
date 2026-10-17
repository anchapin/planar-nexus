/**
 * Wave 4.8 follow-up 31 priority 2 (lane 28, piece
 * 2/N) (#2614 follow-up):
 * `CopyPermanent.exceptions.set_color` arm — the
 * per-copy DESTRUCTIVE color-REPLACE variant
 * (Phyrexian Metamorph's "exactly [color]" semantic
 * half).
 *
 * The schema adds an OPTIONAL
 * `set_color: COLOR[]` sub-arm to the
 * `CopyPermanentSchema.exceptions` object. The
 * engine consult REPLACES each copy token's
 * `cardData.colors` with the listed color names
 * (deduplicated; declared order preserved) AND
 * rebuilds `cardData.color_identity` to match the
 * REPLACED list verbatim (no merge, no append —
 * the printed colors are discarded; the listed
 * colors become the entire `colors` /
 * `color_identity` arrays). The arm is
 * DESTRUCTIVE — it overwrites the printed colors.
 * The `set_color` arm takes PRECEDENCE over
 * `add_color` when both are set (the destructive
 * variant always wins — parallel to the
 * `andPer.perCounterSummed` precedence rule for
 * the additive vs REPLACE form). Color names use
 * the engine's full-name convention (`"white" |
 * "blue" | "black" | "red" | "green" |
 * "colorless"`) — parallel to the follow-up 30
 * priority 1 `add_color` sub-arm and the lane 75c
 * `become_copy` color conventions.
 *
 * Four test groups:
 *   1. schema — `set_color` parses the COLOR enum;
 *      rejects empty arrays, unknown color
 *      strings, and unknown sub-arm keys
 *      (`.strict()`).
 *   2. engine — `set_color` REPLACES `colors` AND
 *      `color_identity` (single-color case +
 *      multi-color case); the printed colors are
 *      discarded.
 *   3. precedence — `set_color` wins over
 *      `add_color` when both are set (the
 *      destructive variant takes PRECEDENCE).
 *   4. regression — no `exceptions` arm and an
 *      empty `exceptions` object preserve the v1
 *      lane 70 / piece 1/4 semantic (no rebuild
 *      of the printed colors / color_identity).
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
  "Test Copy Permanent Exceptions Set Color (follow-up 31 priority 2)";

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
    colors: overrides.colors ?? ["G"],
    color_identity: overrides.color_identity ?? ["G"],
    keywords: overrides.keywords ?? [],
    power: overrides.power ?? "0",
    toughness: overrides.toughness ?? "0",
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

describe("Wave 4.8 follow-up 31 priority 2 — CopyPermanent.exceptions.set_color arm", () => {
  afterAll(() => {
    resetCardScriptsForTests();
  });

  beforeEach(() => {
    resetCardScriptsForTests();
  });

  describe("schema — CopyPermanent.exceptions.set_color parses COLOR", () => {
    it("accepts the set_color sub-arm with a single color ('red')", () => {
      const parsed = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "test",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            exceptions: { set_color: ["red"] },
          },
        ],
      });
      const eff = parsed.spell![0] as CardEffect & {
        exceptions?: { set_color?: string[] };
      };
      expect(eff.exceptions).toEqual({
        set_color: ["red"],
      });
    });

    it("accepts the set_color sub-arm with multiple colors", () => {
      const parsed = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "test",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            exceptions: { set_color: ["red", "white"] },
          },
        ],
      });
      const eff = parsed.spell![0] as CardEffect & {
        exceptions?: { set_color?: string[] };
      };
      expect(eff.exceptions).toEqual({
        set_color: ["red", "white"],
      });
    });

    it("accepts 'colorless' in the set_color array (the engine's full-name convention)", () => {
      // `colorless` is the engine's
      // full-name convention (parallel to
      // `white` / `blue` / `black` /
      // `red` / `green`); Scryfall's
      // short letter is "C" but the
      // engine's enum uses the full name.
      const parsed = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "test",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            exceptions: { set_color: ["colorless"] },
          },
        ],
      });
      const eff = parsed.spell![0] as CardEffect & {
        exceptions?: { set_color?: string[] };
      };
      expect(eff.exceptions).toEqual({
        set_color: ["colorless"],
      });
    });

    it("rejects an empty set_color array (MIN 1 enforced at the Zod layer)", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: HOST_NAME,
          oracle: "test",
          spell: [
            {
              op: "CopyPermanent",
              target: { kind: "filter", value: "creature" },
              controller: "any",
              exceptions: { set_color: [] },
            },
          ],
        }),
      ).toThrow();
    });

    it("rejects an unknown color string (the Zod enum rejects non-COLOR values)", () => {
      // The Zod enum rejects color
      // names outside the six-value
      // COLOR list. Scryfall's short
      // letter "R" / "U" / "G" / "B" /
      // "W" / "C" are NOT accepted at
      // the schema layer — the engine
      // uses full names.
      expect(() =>
        CardScriptSchema.parse({
          name: HOST_NAME,
          oracle: "test",
          spell: [
            {
              op: "CopyPermanent",
              target: { kind: "filter", value: "creature" },
              controller: "any",
              exceptions: { set_color: ["R"] },
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
              exceptions: { set_color: ["purple"] },
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
      // `set_colors` (plural) is a
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
              exceptions: { set_colors: ["red"] },
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe("engine — set_color REPLACES colors AND color_identity", () => {
    it("replaces a green source's colors with red (single-color destructive)", () => {
      // Place a green bear on Bob's
      // battlefield. Register a
      // CopyPermanent spell with
      // `kind: "id"`, `value: <bear id>`,
      // `count: 1`, and
      // `exceptions: { set_color: ["red"] }`.
      // Cast as Alice; the engine creates
      // 1 token whose `cardData.colors` is
      // REPLACED with `["red"]` (the
      // printed green is discarded) and
      // `cardData.color_identity` is
      // REBUILT to `["red"]` (the
      // destructive variant — the
      // identity is the same list, not a
      // transform of the printed identity).
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "set-color-source",
          name: "Grizzly Bears (set_color source)",
          type_line: "Creature — Bear",
          colors: ["G"],
          color_identity: ["G"],
          power: "2",
          toughness: "2",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "Create a token that's a copy of target creature except it's red.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: { set_color: ["red"] },
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
      // printed green is dropped; the
      // new colors are red-only.
      expect(tokenInst.cardData.colors).toEqual(["red"]);
      // The `color_identity` is rebuilt
      // to match the REPLACED list
      // verbatim (the destructive
      // variant — the identity is the
      // same list, not a transform of
      // the printed identity).
      expect(tokenInst.cardData.color_identity).toEqual(["red"]);
    });

    it("replaces a green source's colors with red + white (multi-color destructive)", () => {
      // `set_color: ["red", "white"]` —
      // both colors REPLACE the printed
      // green (no merge — the printed
      // green is discarded). The
      // `color_identity` is rebuilt to
      // match the REPLACED list
      // verbatim: `["red", "white"]`.
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "multi-set-color-source",
          name: "Bear (multi set_color source)",
          type_line: "Creature — Bear",
          colors: ["G"],
          color_identity: ["G"],
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "Create a token that's a copy of target creature except it's red and white.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: { set_color: ["red", "white"] },
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
      expect(tokenInst.cardData.colors).toEqual(["red", "white"]);
      expect(tokenInst.cardData.color_identity).toEqual([
        "red",
        "white",
      ]);
    });
  });

  describe("precedence — set_color takes PRECEDENCE over add_color when both are set", () => {
    it("set_color + add_color: the destructive variant wins, the additive 'add_color' is dropped", () => {
      // Cross-arm precedence test for
      // the follow-up 31 priority 2
      // `set_color` arm + the follow-up
      // 30 priority 1 `add_color` arm.
      // When both are set, the
      // destructive `set_color` wins:
      // the printed green is discarded
      // AND the additive `add_color`
      // consult is skipped (blue is
      // dropped). The final colors are
      // red-only.
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "precedence-set-add-color-source",
          name: "Bear (set_color + add_color precedence source)",
          type_line: "Creature — Bear",
          colors: ["G"],
          color_identity: ["G"],
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "Create a token that's a copy of target creature except it's red (NOT red and blue).",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: {
              set_color: ["red"],
              add_color: ["blue"],
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
      // The destructive `set_color`
      // wins: the printed green is
      // dropped AND the additive
      // `add_color` consult is skipped
      // (blue is dropped). Final colors
      // are red-only.
      expect(tokenInst.cardData.colors).toEqual(["red"]);
      expect(tokenInst.cardData.color_identity).toEqual(["red"]);
    });
  });

  describe("regression — no set_color arm preserves the v1 lane 70 / piece 1/4 semantic", () => {
    it("no exceptions arm: the printed colors / color_identity are the token's colors (no rebuild)", () => {
      // Regression guard: without an
      // `exceptions` arm, the token's
      // colors / color_identity are
      // the source's printed colors
      // (CR 707.2 "all characteristics
      // copied" semantics, unmodified).
      // The exceptions arm is OPTIONAL;
      // the v1 minimum preserves the
      // no-rebuild semantic.
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "no-exceptions-set-color-source",
          name: "Bear (no exceptions set_color source)",
          type_line: "Creature — Bear",
          colors: ["G"],
          color_identity: ["G"],
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
      // Printed colors / color_identity
      // are preserved unchanged.
      expect(tokenInst.cardData.colors).toEqual(["G"]);
      expect(tokenInst.cardData.color_identity).toEqual(["G"]);
    });
  });
});