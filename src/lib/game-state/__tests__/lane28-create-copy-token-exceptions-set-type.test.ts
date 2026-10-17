/**
 * Wave 4.8 follow-up 34 priority 1 (lane 28, piece
 * 2/N) (#2614 follow-up):
 * `CopyPermanent.exceptions.set_type` arm — the
 * per-copy REPLACE variant for the TYPES half of
 * `type_line` (e.g. "Create a token that's a copy
 * of target creature except it's an Equipment
 * instead of Creature.").
 *
 * The schema adds an OPTIONAL
 * `set_type: string[]` sub-arm to the
 * `CopyPermanentSchema.exceptions` object. The
 * engine consult REPLACES the TYPES half of
 * `cardData.type_line` with the listed type
 * names (printed types are dropped; the subtypes
 * half is preserved unchanged). When `set_type`
 * is present, the `add_type` prepend-consult is
 * SKIPPED — REPLACE wins on the same axis
 * (parallel to `set_subtype` vs `add_subtype`
 * from follow-up 33, and to `set_toughness` vs
 * `add_toughness` from follow-up 32 / commit
 * 41b3ad3a).
 *
 * Cross-axis interaction: when BOTH `set_type`
 * (types-half REPLACE) and `set_subtype`
 * (subtypes-half REPLACE) ride together on the
 * same effect, the engine rebuilds the entire
 * type_line as `<set_type> — <set_subtype>` —
 * both printed halves are dropped. Both
 * `add_type` and `add_subtype` consults are
 * SKIPPED on their respective axes (REPLACE
 * wins); cross-axis additive consults do NOT
 * cancel each other — additive on independent
 * axes still runs as long as neither REPLACE
 * form is set on that axis.
 *
 * Three test groups:
 *   1. schema — `set_type` parses as a non-empty
 *      string array; rejects empty arrays,
 *      empty-string types, and unknown sub-arm
 *      keys (`.strict()`).
 *   2. engine — `set_type` REPLACES the types
 *      half of `type_line` (single type case +
 *      multi-type case); the printed types are
 *      discarded; the subtypes half is preserved
 *      unchanged; the em-dash separator is
 *      added when the source had no subtypes
 *      half.
 *   3. precedence — `set_type` REPLACE wins
 *      over `add_type` when both are set on the
 *      same effect (the REPLACE variant takes
 *      PRECEDENCE — the additive `add_type`
 *      consult is SKIPPED).
 *   4. cross-axis — `set_type` + `set_subtype`
 *      on the same effect rebuilds the type_line
 *      as `<set_type> — <set_subtype>` (both
 *      printed halves dropped).
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
  "Test Copy Permanent Exceptions Set Type (follow-up 34 priority 1)";

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

describe("CopyPermanent.exceptions.set_type — follow-up 34", () => {
  describe("schema — set_type parses as a non-empty string array", () => {
    it("accepts a single-type set_type array", () => {
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle:
          "Create a token that's a copy of target creature except it's an Equipment instead of Creature.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            count: 1,
            exceptions: { set_type: ["Equipment"] },
          },
        ],
      });
      const eff = script.spell![0] as CardEffect & {
        op: "CopyPermanent";
        exceptions?: { set_type?: string[] };
      };
      expect(eff.exceptions?.set_type).toEqual(["Equipment"]);
    });

    it("accepts a multi-type set_type array (declared order preserved)", () => {
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle:
          "Create a token that's a copy of target creature except it's an Artifact Creature instead of Creature.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            count: 1,
            exceptions: { set_type: ["Artifact", "Creature"] },
          },
        ],
      });
      const eff = script.spell![0] as CardEffect & {
        op: "CopyPermanent";
        exceptions?: { set_type?: string[] };
      };
      expect(eff.exceptions?.set_type).toEqual(["Artifact", "Creature"]);
    });

    it("rejects an empty set_type array (min(1))", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: HOST_NAME,
          oracle: "Empty set_type should fail.",
          spell: [
            {
              op: "CopyPermanent",
              target: { kind: "filter", value: "creature" },
              controller: "any",
              count: 1,
              exceptions: { set_type: [] },
            },
          ],
        }),
      ).toThrow();
    });

    it("rejects an empty-string type (min(1) on the element)", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: HOST_NAME,
          oracle: "Empty-string type should fail.",
          spell: [
            {
              op: "CopyPermanent",
              target: { kind: "filter", value: "creature" },
              controller: "any",
              count: 1,
              exceptions: { set_type: [""] },
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
              exceptions: { set_type: ["Equipment"], set_kind: ["man-made"] },
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe("engine — set_type REPLACES the TYPES half of type_line", () => {
    it("REPLACES a single printed type with the listed type (subtypes half preserved)", () => {
      // Source: "Creature — Bear" (printed
      // types half is "Creature", subtypes
      // half is "Bear"). The copy token's
      // `type_line` should be
      // "Equipment — Bear" (types half
      // REPLACED; subtypes half preserved
      // verbatim).
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "single-set-type-source",
          name: "Bear (single set_type source)",
          type_line: "Creature — Bear",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle:
          "Create a token that's a copy of target creature except it's an Equipment instead of Creature.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: { set_type: ["Equipment"] },
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
      // Printed "Creature" is dropped;
      // new types half is "Equipment";
      // subtypes half "Bear" preserved
      // unchanged.
      expect(tokenInst!.cardData.type_line).toBe("Equipment — Bear");
    });

    it("REPLACES the types half with multiple listed types (subtypes half preserved)", () => {
      // Source: "Creature — Bear" (single
      // printed type). The copy token's
      // `type_line` should be
      // "Artifact Creature — Bear" (new
      // types in declared order; subtypes
      // half preserved verbatim).
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "multi-set-type-source",
          name: "Bear (multi set_type source)",
          type_line: "Creature — Bear",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle:
          "Create a token that's a copy of target creature except it's an Artifact Creature instead of Creature.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: { set_type: ["Artifact", "Creature"] },
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
      // Printed "Creature" is dropped;
      // new types half is "Artifact
      // Creature" (declared order); subtypes
      // half "Bear" preserved.
      expect(tokenInst!.cardData.type_line).toBe("Artifact Creature — Bear");
    });

    it("drops the em-dash separator when the source has no subtypes half", () => {
      // Source: "Creature" (no em-dash, no
      // subtypes half). The copy token's
      // `type_line` should be "Equipment"
      // (no em-dash separator since there
      // was no subtypes half to preserve).
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "no-subtype-set-type-source",
          name: "Faceless One (no subtypes set_type source)",
          type_line: "Creature",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle:
          "Create a token that's a copy of target creature except it's an Equipment instead of Creature.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: { set_type: ["Equipment"] },
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
      // No printed subtypes half — the
      // em-dash separator is NOT added;
      // type_line is just "Equipment".
      expect(tokenInst!.cardData.type_line).toBe("Equipment");
    });
  });

  describe("precedence — set_type REPLACE wins over add_type on the same axis", () => {
    it("set_type wins: add_type consult is SKIPPED when set_type is present", () => {
      // REPLACE wins on the same axis —
      // the PRECEDENCE block in
      // schema.ts (follow-up 33 piece 1)
      // codifies this rule. Markers:
      // `REPLACE wins over additive on
      // the type axis`, parallel to the
      // `set_subtype` vs `add_subtype`
      // rule from follow-up 33 and the
      // `set_toughness` vs
      // `add_toughness` rule from
      // follow-up 32 / commit 41b3ad3a.
      //
      // Source: "Creature — Bear". The
      // effect lists BOTH:
      //   - set_type: ["Equipment"]
      //     (REPLACE)
      //   - add_type: ["Artifact"]
      //     (ADDITIVE)
      // The token's type_line should be
      // "Equipment — Bear" (REPLACE wins;
      // Artifact is dropped via SKIP;
      // printed Creature is dropped;
      // subtypes half Bear preserved).
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "precedence-set-type-source",
          name: "Bear (precedence set_type source)",
          type_line: "Creature — Bear",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle:
          "Create a token that's a copy of target creature. set_type wins over add_type on the type axis.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: {
              set_type: ["Equipment"],
              add_type: ["Artifact"],
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
      // REPLACE wins: the printed
      // "Creature" is dropped, the
      // additive "Artifact" is dropped
      // (the add_type consult is SKIPPED
      // when set_type is present on the
      // same effect), and the new types
      // half is "Equipment". Subtypes
      // half "Bear" preserved.
      expect(tokenInst!.cardData.type_line).toBe("Equipment — Bear");
    });
  });

  describe("cross-axis — set_type + set_subtype rebuilds type_line", () => {
    it("set_type + set_subtype on the same effect rebuilds type_line as `<set_type> — <set_subtype>`", () => {
      // Cross-axis REPLACE forms are
      // allowed together. The engine
      // rebuilds the entire type_line as
      // `<set_type> — <set_subtype>`.
      // Both printed halves are dropped.
      // Both `add_type` and `add_subtype`
      // consults are SKIPPED on their
      // respective axes (REPLACE wins
      // on each axis independently).
      //
      // Source: "Legendary Creature —
      // Bear Spirit". Effect lists:
      //   - set_type: ["Artifact",
      //     "Creature"]
      //   - set_subtype: ["Construct"]
      // The token's type_line should be
      // "Artifact Creature — Construct"
      // (both printed halves dropped;
      // both REPLACE forms applied; both
      // printed types and subtypes
      // replaced).
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "cross-axis-set-type-source",
          name: "Mystic Bear (cross-axis set_type source)",
          type_line: "Legendary Creature — Bear Spirit",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle:
          "Create a token that's a copy of target creature except it's an Artifact Creature Construct (cross-axis set_type + set_subtype).",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: {
              set_type: ["Artifact", "Creature"],
              set_subtype: ["Construct"],
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
      // Cross-axis REPLACE rebuilds
      // type_line as "<set_type> —
      // <set_subtype>". Both printed
      // halves ("Legendary Creature" and
      // "Bear Spirit") are dropped.
      expect(tokenInst!.cardData.type_line).toBe(
        "Artifact Creature — Construct",
      );
    });
  });
});
