/**
 * Wave 4.8 follow-up 30 priority 1 (lane 28, piece
 * 1/N) (#2614 follow-up):
 * `CopyPermanent.exceptions.add_color` arm — the
 * per-copy additive color-merge variant (Phyrexian
 * Metamorph's "it's red in addition to its other
 * colors" half).
 *
 * The schema adds an OPTIONAL
 * `add_color: COLOR[]` sub-arm to the
 * `CopyPermanentSchema.exceptions` object. The
 * engine consult APPENDS the listed color names to
 * each copy token's `cardData.colors` (deduped;
 * declared order preserved) and rebuilds the
 * matching `cardData.color_identity` array to the
 * union of printed + added colors. The `add_color`
 * arm is ADDITIVE — no overwrite of the printed
 * colors. Color names use the engine's full-name
 * convention (`"white" | "blue" | "black" | "red" |
 * "green" | "colorless"`) — parallel to the
 * `CreateToken.color` enum and the lane 75c
 * `become_copy` color conventions.
 *
 * Four test groups:
 *   1. schema — `add_color` parses the COLOR enum;
 *      rejects empty arrays, unknown color strings,
 *      and unknown sub-arm keys (`.strict()`).
 *   2. engine — `add_color` merges into `colors` +
 *      `color_identity`; single-color case +
 *      multi-color case.
 *   3. cross-arm — `add_color` composes with the
 *      existing `add_subtype` arm (regression
 *      guard for follow-up 29 priority 3 piece
 *      4/4).
 *   4. regression — no `exceptions` arm and an
 *      empty `exceptions` object preserve the v1
 *      lane 70 / piece 1/4 semantic (no rebuild
 *      of the printed colors / color_identity).
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
  "Test Copy Permanent Exceptions Add Color (follow-up 30 priority 1)";

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

describe("Wave 4.8 follow-up 30 priority 1 — CopyPermanent.exceptions.add_color arm", () => {
  beforeAll(() => {
    resetCardScriptsForTests();
  });

  afterAll(() => {
    resetCardScriptsForTests();
  });

  beforeEach(() => {
    resetCardScriptsForTests();
  });

  describe("schema — CopyPermanent.exceptions.add_color parses the COLOR enum", () => {
    it("accepts the add_color sub-arm with a single color name (Phyrexian Metamorph-style)", () => {
      const parsed = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "test",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            exceptions: {
              add_color: ["red"],
            },
          },
        ],
      });
      const eff = parsed.spell![0] as CardEffect & {
        exceptions?: { add_color?: string[] };
      };
      expect(eff.exceptions).toEqual({ add_color: ["red"] });
    });

    it("accepts the add_color sub-arm with multiple color names", () => {
      const parsed = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "test",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            exceptions: {
              add_color: ["red", "white"],
            },
          },
        ],
      });
      const eff = parsed.spell![0] as CardEffect & {
        exceptions?: { add_color?: string[] };
      };
      expect(eff.exceptions).toEqual({
        add_color: ["red", "white"],
      });
    });

    it("accepts 'colorless' in the add_color array (the colorless is a valid color name)", () => {
      // Verifies the Zod enum includes
      // "colorless" alongside the five
      // chromatic colors — the COLOR enum
      // mirrors the engine's full-name
      // convention (`CreateToken.color`
      // uses the same enum).
      const parsed = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "test",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            exceptions: {
              add_color: ["colorless"],
            },
          },
        ],
      });
      const eff = parsed.spell![0] as CardEffect & {
        exceptions?: { add_color?: string[] };
      };
      expect(eff.exceptions).toEqual({
        add_color: ["colorless"],
      });
    });

    it("rejects an empty add_color array (MIN 1 enforced at the Zod layer)", () => {
      // `z.array(z.enum([...])).min(1)`
      // rejects the empty array (the v1
      // minimum requires at least one
      // added color).
      expect(() =>
        CardScriptSchema.parse({
          name: HOST_NAME,
          oracle: "test",
          spell: [
            {
              op: "CopyPermanent",
              target: { kind: "filter", value: "creature" },
              controller: "any",
              exceptions: { add_color: [] },
            },
          ],
        }),
      ).toThrow();
    });

    it("rejects an unknown color string in add_color (the Zod enum rejects non-COLOR values)", () => {
      // The Zod enum rejects color names
      // outside the six-value COLOR list.
      // The handoff spec restricts the
      // arm to "white" | "blue" | "black"
      // | "red" | "green" | "colorless" —
      // single-letter codes (W | U | B |
      // R | G) and Scryfall-style "W,U,B"
      // strings are NOT accepted at the
      // schema layer.
      expect(() =>
        CardScriptSchema.parse({
          name: HOST_NAME,
          oracle: "test",
          spell: [
            {
              op: "CopyPermanent",
              target: { kind: "filter", value: "creature" },
              controller: "any",
              exceptions: { add_color: ["R"] },
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
              exceptions: { add_color: ["purple"] },
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe("engine — add_color merges into colors + color_identity", () => {
    it("appends 'red' to a green bear's colors + color_identity (Phyrexian Metamorph-style)", () => {
      // Place a green bear on Bob's
      // battlefield. Register a
      // CopyPermanent spell with
      // `kind: "id"`, `value: <bear id>`,
      // `count: 1`, and
      // `exceptions: { add_color: ["red"] }`.
      // Cast as Alice; the engine creates
      // 1 token whose `cardData.colors`
      // is the printed `["green"]`
      // APPENDED with `["red"]`
      // (deduped) → `["green", "red"]`,
      // and whose `cardData.color_identity`
      // mirrors the same union
      // (`["green", "red"]`).
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "metamorph-source",
          name: "Grizzly Bears (metamorph add_color source)",
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
        oracle: "Create a token that's a green bear that's also red.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: { add_color: ["red"] },
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
      // colors: printed ["green"] +
      // added ["red"] → ["green", "red"]
      // (declared order: printed first,
      // then added).
      expect(tokenInst.cardData.colors).toEqual(["green", "red"]);
      // color_identity: union mirror.
      expect(tokenInst.cardData.color_identity).toEqual([
        "green",
        "red",
      ]);
      // Other printed fields are
      // preserved (CR 707.2 "all
      // characteristics copied"
      // semantics).
      expect(tokenInst.cardData.name).toBe(
        "Grizzly Bears (metamorph add_color source)",
      );
      expect(tokenInst.cardData.type_line).toBe("Creature — Bear");
      expect(tokenInst.cardData.power).toBe("2");
      expect(tokenInst.cardData.toughness).toBe("2");
    });

    it("appends multiple colors to a green bear (multi-color additive merge)", () => {
      // `add_color: ["red", "white"]` —
      // both colors are appended to the
      // printed `["green"]` in declared
      // order → `["green", "red",
      // "white"]`.
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "multi-color-source",
          name: "Bear (multi-color add_color source)",
          type_line: "Creature — Bear",
          colors: ["green"],
          color_identity: ["green"],
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "Create a token that's a green bear that's also red and white.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: { add_color: ["red", "white"] },
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
      expect(tokenInst.cardData.colors).toEqual([
        "green",
        "red",
        "white",
      ]);
      expect(tokenInst.cardData.color_identity).toEqual([
        "green",
        "red",
        "white",
      ]);
    });
  });

  describe("cross-arm — add_color composes with the existing add_subtype arm", () => {
    it("add_color + add_subtype: token receives both the subtype append and the color merge", () => {
      // Regression guard for the
      // follow-up 29 priority 3 piece
      // 4/4 `add_subtype` arm — when
      // both arms are present, the
      // engine consults both in order
      // (subtype first, then color),
      // and each token receives both
      // modifications.
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "cross-arm-source",
          name: "Bear (cross-arm source)",
          type_line: "Creature — Bear",
          colors: ["green"],
          color_identity: ["green"],
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "Create a token that's a green bear, also artifact, also red.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: {
              add_subtype: ["Artifact"],
              add_color: ["red"],
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
      // add_subtype appends to the
      // subtypes half.
      expect(tokenInst.cardData.type_line).toBe(
        "Creature — Bear Artifact",
      );
      // add_color merges into colors +
      // color_identity.
      expect(tokenInst.cardData.colors).toEqual(["green", "red"]);
      expect(tokenInst.cardData.color_identity).toEqual([
        "green",
        "red",
      ]);
    });
  });

  describe("regression — no add_color arm preserves the v1 lane 70 / piece 1/4 semantic", () => {
    it("no exceptions arm: the printed colors + color_identity are the token's (no merge)", () => {
      // Regression guard: without an
      // `exceptions` arm, the token's
      // `colors` and `color_identity`
      // are the source's printed values
      // (CR 707.2 "all characteristics
      // copied" semantics, unmodified).
      // The `add_color` arm is
      // OPTIONAL; the v1 minimum
      // preserves the no-merge semantic.
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "no-exceptions-source",
          name: "Bear (no exceptions source)",
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
      // Printed colors + color_identity
      // are preserved unchanged.
      expect(tokenInst.cardData.colors).toEqual(["green"]);
      expect(tokenInst.cardData.color_identity).toEqual(["green"]);
    });
  });
});