/**
 * Wave 4.8 follow-up 34 priority 1 (lane 28, piece
 * 4/N) (#2614 follow-up):
 * `CopyPermanent.exceptions.set_color_identity`
 * arm — the per-copy HYBRID REPLACE for the
 * `color_identity` field ONLY (LEAVES `colors`
 * unchanged). This is the inverse of `set_color`
 * (which REPLACES BOTH `colors` AND
 * `color_identity` to the same list).
 *
 * v1 typical use case: a token that's a copy of
 * target creature except it has the chosen
 * player's color identity — commander-deck
 * reconstruct semantics where the face card's
 * printed colors are preserved but its
 * color_identity is rebound.
 *
 * The schema adds an OPTIONAL
 * `set_color_identity: COLOR[]` sub-arm to the
 * `CopyPermanentSchema.exceptions` object (the
 * same `COLOR` enum already used for `add_color` /
 * `set_color`). The engine consult REPLACES only
 * the `color_identity` array (deduped; declared
 * order preserved). The `colors` array is
 * preserved verbatim from whatever the prior
 * pass left (printed base, post-`add_color`, or
 * post-`set_color`).
 *
 * When `set_color_identity` is present, the
 * `add_color` consult is SKIPPED entirely
 * (REPLACE wins on each axis independently —
 * `color_identity` is its own axis).
 *
 * Cross-axis with `set_color`: `set_color` runs
 * FIRST and sets BOTH `colors` AND
 * `color_identity`. Then `set_color_identity`
 * runs and further REPLACES `color_identity` to
 * its own list — the FINAL `color_identity` is
 * `set_color_identity`'s list, NOT `set_color`'s.
 * The `colors` array, however, is FINALIZED by
 * `set_color` (it is NOT touched by
 * `set_color_identity`).
 *
 * Three test groups:
 *   1. schema — `set_color_identity` parses as a
 *      non-empty COLOR enum array; rejects empty
 *      arrays, illegal color strings, and
 *      unknown sub-arm keys (`.strict()`).
 *   2. engine — `set_color_identity` REPLACES
 *      ONLY the `color_identity` array (single
 *      color case + multi color case); the
 *      `colors` array is preserved verbatim
 *      across cases.
 *   3. precedence — `set_color_identity` REPLACE
 *      wins over `add_color` when both are set on
 *      the same effect (the REPLACE variant takes
 *      PRECEDENCE — the additive `add_color`
 *      consult is SKIPPED on the `colors`
 *      axis).
 *   4. cross-axis — `set_color` + `set_color_identity`
 *      on the same effect: `set_color` REPLACES
 *      BOTH `colors` and `color_identity` first;
 *      then `set_color_identity` further
 *      REPLACES `color_identity` to its own list
 *      (FINAL `color_identity` reflects
 *      `set_color_identity`, NOT `set_color`).
 */
import { describe, it, expect, afterAll, beforeEach } from "@jest/globals";
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
  "Test Copy Permanent Exceptions Set Color Identity (follow-up 34 priority 1)";

function makeCard(
  overrides: Partial<ScryfallCard> & { id: string },
): ScryfallCard {
  return {
    id: `mock-${overrides.id}`,
    name: overrides.name ?? HOST_NAME,
    type_line: overrides.type_line ?? "Creature — Bear",
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost ?? "{3}{U}",
    cmc: overrides.cmc ?? 4,
    colors: overrides.colors ?? ["G"],
    color_identity: overrides.color_identity ?? ["G"],
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
  const cardId =
    `card-${cardDef.id}-${Math.random().toString(36).slice(2)}` as CardInstanceId;
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
  return { state: { ...state, cards: newCards, zones: newZones }, cardId };
}

function castScript(
  state: GameState,
  aliceId: PlayerId,
  script: { name: string; oracle: string; spell?: unknown[] },
  options: { extraMana?: number } = {},
): { state: GameState } {
  resetCardScriptsForTests();
  registerCardScripts([
    { ...script, name: HOST_NAME } as Parameters<
      typeof registerCardScripts
    >[0][0],
  ]);
  const cardDef = makeCard({
    id: `host-${HOST_NAME.replace(/\s+/g, "-")}`,
    name: HOST_NAME,
  });
  const cardId =
    `card-host-${Math.random().toString(36).slice(2)}` as CardInstanceId;
  const card = createCardInstance(cardDef, aliceId, aliceId, {
    id: cardId,
    currentZoneKey: `${aliceId}-hand`,
  });
  let s: GameState = {
    ...state,
    cards: new Map(state.cards).set(cardId, card),
    zones: new Map(state.zones).set(`${aliceId}-hand`, {
      ...state.zones.get(`${aliceId}-hand`)!,
      cardIds: [...(state.zones.get(`${aliceId}-hand`)!.cardIds ?? []), cardId],
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

beforeEach(() => {
  resetCardScriptsForTests();
});

afterAll(() => {
  resetCardScriptsForTests();
});

describe("CopyPermanent.exceptions.set_color_identity — follow-up 34", () => {
  describe("schema — set_color_identity parses as a non-empty COLOR enum array", () => {
    it("accepts a single-color set_color_identity array", () => {
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle:
          "Create a token that's a copy of target creature except its color identity is white.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            count: 1,
            exceptions: { set_color_identity: ["white"] },
          },
        ],
      });
      const eff = script.spell![0] as CardEffect & {
        op: "CopyPermanent";
        exceptions?: { set_color_identity?: string[] };
      };
      expect(eff.exceptions?.set_color_identity).toEqual(["white"]);
    });

    it("accepts a multi-color set_color_identity array (declared order preserved)", () => {
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle:
          "Create a token that's a copy of target creature except its color identity is white, blue.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            count: 1,
            exceptions: {
              set_color_identity: ["white", "blue"],
            },
          },
        ],
      });
      const eff = script.spell![0] as CardEffect & {
        op: "CopyPermanent";
        exceptions?: { set_color_identity?: string[] };
      };
      expect(eff.exceptions?.set_color_identity).toEqual(["white", "blue"]);
    });

    it("rejects an empty set_color_identity array (min(1))", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: HOST_NAME,
          oracle: "Empty set_color_identity should fail.",
          spell: [
            {
              op: "CopyPermanent",
              target: { kind: "filter", value: "creature" },
              controller: "any",
              count: 1,
              exceptions: { set_color_identity: [] },
            },
          ],
        }),
      ).toThrow();
    });

    it("rejects an illegal color string (e.g. 'purple')", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: HOST_NAME,
          oracle:
            "Illegal color should fail (purple is not in the COLOR enum).",
          spell: [
            {
              op: "CopyPermanent",
              target: { kind: "filter", value: "creature" },
              controller: "any",
              count: 1,
              exceptions: { set_color_identity: ["purple"] },
            },
          ],
        }),
      ).toThrow();
    });

    it("rejects unknown sub-arm keys (exceptions object is .strict())", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: HOST_NAME,
          oracle: "Unknown sub-arm key should fail.",
          spell: [
            {
              op: "CopyPermanent",
              target: { kind: "filter", value: "creature" },
              controller: "any",
              count: 1,
              exceptions: {
                set_color_identity: ["white"],
                set_color_kind: ["shimmering"],
              },
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe("engine — set_color_identity REPLACES only the color_identity array", () => {
    it("REPLACES the color_identity with a single color (colors preserved verbatim)", () => {
      // Source: colors = ["green", "blue"],
      // color_identity = ["G", "U"]
      // (printed). The copy token's
      // `color_identity` should be
      // ["W"] (REPLACE); `colors`
      // should be preserved verbatim
      // (still ["green", "blue"]).
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "single-set-color-identity-source",
          name: "Bant Bear (single set_color_identity source)",
          colors: ["green", "blue"],
          color_identity: ["G", "U"],
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle:
          "Create a token that's a copy of target creature except its color identity is white.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: { set_color_identity: ["white"] },
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
      // REPLACE: color_identity
      // becomes ["white"]. The printed
      // colors ["green", "blue"] are
      // PRESERVED VERBATIM (NOT
      // touched by set_color_identity).
      expect(tokenInst!.cardData.color_identity).toEqual(["white"]);
      expect(tokenInst!.cardData.colors).toEqual(["green", "blue"]);
    });

    it("REPLACES the color_identity with multiple colors (declared order preserved; deduped; colors preserved)", () => {
      // Source: colors = ["green", "blue"],
      // color_identity = ["G", "U"].
      // The copy token's
      // `color_identity` should be
      // ["red", "black"] (REPLACE in
      // declared order); `colors`
      // preserved verbatim.
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "multi-set-color-identity-source",
          name: "Bant Bear (multi set_color_identity source)",
          colors: ["green", "blue"],
          color_identity: ["G", "U"],
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle:
          "Create a token that's a copy of target creature except its color identity is red, black.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: {
              set_color_identity: ["red", "black"],
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
      // REPLACE: color_identity
      // becomes ["red", "black"] in
      // declared order. The printed
      // colors ["green", "blue"]
      // preserved verbatim.
      expect(tokenInst!.cardData.color_identity).toEqual(["red", "black"]);
      expect(tokenInst!.cardData.colors).toEqual(["green", "blue"]);
    });

    it("deduplicates the listed colors while preserving declared order", () => {
      // Listed ["red", "black", "red"]
      // should dedupe to ["red", "black"]
      // (declared order retained on the
      // first occurrence).
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "dedupe-set-color-identity-source",
          name: "Mono Bear (dedupe set_color_identity source)",
          colors: ["green"],
          color_identity: ["G"],
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle:
          "Create a token that's a copy of target creature except its color identity is red, black, red (deduped).",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: {
              set_color_identity: ["red", "black", "red"],
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
      // Listed ["red", "black", "red"]
      // dedupes to ["red", "black"].
      // Printed colors ["green"]
      // preserved verbatim.
      expect(tokenInst!.cardData.color_identity).toEqual(["red", "black"]);
      expect(tokenInst!.cardData.colors).toEqual(["green"]);
    });
  });

  describe("precedence — set_color_identity REPLACE wins over add_color on the colors axis", () => {
    it("set_color_identity wins: add_color consult is SKIPPED when set_color_identity is present", () => {
      // REPLACE wins on each axis
      // independently — even though
      // `set_color_identity` only
      // touches `color_identity`, its
      // presence prevents `add_color`
      // from running on the `colors`
      // axis (the additive overlay on
      // the colors axis is also
      // skipped). The printed `colors`
      // is preserved verbatim.
      //
      // Source: colors = ["green"],
      // color_identity = ["G"]. Effect
      // lists BOTH:
      //   - set_color_identity:
      //     ["red", "black"] (REPLACE
      //     on color_identity axis)
      //   - add_color: ["white"]
      //     (ADDITIVE on colors axis)
      // The token's color_identity
      // should be ["red", "black"]
      // (REPLACE applied);
      // `add_color` is SKIPPED — colors
      // should remain ["green"]
      // (printed base, NOT extended
      // with "white").
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "precedence-set-color-identity-source",
          name: "Mono Bear (precedence set_color_identity source)",
          colors: ["green"],
          color_identity: ["G"],
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle:
          "Create a token that's a copy of target creature. set_color_identity wins over add_color on the colors axis.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: {
              set_color_identity: ["red", "black"],
              add_color: ["white"],
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
      // REPLACE on color_identity:
      // ["red", "black"].
      // add_color SKIPPED: colors
      // remains ["green"] (no white
      // appended).
      expect(tokenInst!.cardData.color_identity).toEqual(["red", "black"]);
      expect(tokenInst!.cardData.colors).toEqual(["green"]);
    });
  });

  describe("cross-axis — set_color + set_color_identity cooperates", () => {
    it("set_color + set_color_identity on the same effect: set_color wins on colors axis; set_color_identity wins on color_identity axis", () => {
      // set_color runs FIRST — sets
      // BOTH `colors` AND
      // `color_identity` to ["white"].
      // Then set_color_identity runs
      // — further REPLACES
      // `color_identity` to ["red",
      // "black"]. Final state: colors
      // = ["white"] (set_color
      // finalized); color_identity =
      // ["red", "black"] (set_color_identity
      // wins over set_color's
      // prior color_identity
      // assignment).
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "cross-axis-set-color-identity-source",
          name: "Bant Bear (cross-axis set_color_identity source)",
          colors: ["green", "blue"],
          color_identity: ["G", "U"],
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle:
          "Create a token that's a copy of target creature except set_color + set_color_identity together (cross-axis).",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: {
              set_color: ["white"],
              set_color_identity: ["red", "black"],
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
      // Cross-axis: set_color
      // finalized colors = ["white"];
      // set_color_identity further
      // replaced color_identity =
      // ["red", "black"].
      expect(tokenInst!.cardData.colors).toEqual(["white"]);
      expect(tokenInst!.cardData.color_identity).toEqual(["red", "black"]);
    });
  });
});
