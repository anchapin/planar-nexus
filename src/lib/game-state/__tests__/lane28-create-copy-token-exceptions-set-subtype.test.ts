/**
 * Wave 4.8 follow-up 33 priority 1 (lane 28, piece
 * 1/N) (#2614 follow-up):
 * `CopyPermanent.exceptions.set_subtype` arm — the
 * per-copy REPLACE variant for the subtypes half of
 * `type_line` (e.g. "Create a token that's a copy
 * of target creature except it's a Shapeshifter
 * instead of Bear.").
 *
 * The schema adds an OPTIONAL
 * `set_subtype: string[]` sub-arm to the
 * `CopyPermanentSchema.exceptions` object. The
 * engine consult REPLACES the subtypes half of
 * `cardData.type_line` with the listed subtype
 * names (printed subtypes are dropped; the types
 * half is preserved unchanged). When `set_subtype`
 * is present, the `add_subtype` append-consult is
 * SKIPPED — REPLACE wins on the same axis (parallel
 * to `set_toughness` vs `add_toughness` precedence
 * from follow-up 32 / commit 41b3ad3a — the
 * REPLACE form is the final word on the axis).
 *
 * Three test groups:
 *   1. schema — `set_subtype` parses as a
 *      non-empty string array; rejects empty
 *      arrays, empty-string subtypes, and unknown
 *      sub-arm keys (`.strict()`).
 *   2. engine — `set_subtype` REPLACES the
 *      subtypes half of `type_line` (single subtype
 *      case + multi-subtype case); the printed
 *      subtypes are discarded; the types half is
 *      preserved unchanged.
 *   3. precedence — `set_subtype` REPLACE wins over
 *      `add_subtype` when both are set on the same
 *      effect (the REPLACE variant takes
 *      PRECEDENCE — the additive `add_subtype`
 *      consult is SKIPPED).
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
  "Test Copy Permanent Exceptions Set Subtype (follow-up 33 priority 1)";

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

describe("CopyPermanent.exceptions.set_subtype — follow-up 33", () => {
  describe("schema — set_subtype parses as a non-empty string array", () => {
    it("accepts a single-subtype set_subtype array", () => {
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle:
          "Create a token that's a copy of target creature except it's a Shapeshifter instead of Bear.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            count: 1,
            exceptions: { set_subtype: ["Shapeshifter"] },
          },
        ],
      });
      const eff = script.spell![0] as CardEffect & {
        op: "CopyPermanent";
        exceptions?: { set_subtype?: string[] };
      };
      expect(eff.exceptions?.set_subtype).toEqual(["Shapeshifter"]);
    });

    it("accepts a multi-subtype set_subtype array (declared order preserved)", () => {
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle:
          "Create a token that's a copy of target creature except it has these new subtypes.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            count: 1,
            exceptions: { set_subtype: ["Shapeshifter", "Advisor"] },
          },
        ],
      });
      const eff = script.spell![0] as CardEffect & {
        op: "CopyPermanent";
        exceptions?: { set_subtype?: string[] };
      };
      expect(eff.exceptions?.set_subtype).toEqual(["Shapeshifter", "Advisor"]);
    });

    it("rejects an empty set_subtype array (min(1))", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: HOST_NAME,
          oracle: "Empty set_subtype should fail.",
          spell: [
            {
              op: "CopyPermanent",
              target: { kind: "filter", value: "creature" },
              controller: "any",
              count: 1,
              exceptions: { set_subtype: [] },
            },
          ],
        }),
      ).toThrow();
    });

    it("rejects an empty-string subtype (min(1) on the element)", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: HOST_NAME,
          oracle: "Empty-string subtype should fail.",
          spell: [
            {
              op: "CopyPermanent",
              target: { kind: "filter", value: "creature" },
              controller: "any",
              count: 1,
              exceptions: { set_subtype: [""] },
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
                set_subtype: ["Shapeshifter"],
                set_kind: ["human"],
              },
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe("engine — set_subtype REPLACES the subtypes half of type_line", () => {
    it("REPLACES a single printed subtype with the listed subtype (types half preserved)", () => {
      // Source: "Creature — Bear" (printed
      // subtypes half is "Bear"). The copy
      // token's `type_line` should be
      // "Creature — Shapeshifter" (types
      // half preserved, subtypes half
      // REPLACED).
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "single-set-subtype-source",
          name: "Bear (single set_subtype source)",
          type_line: "Creature — Bear",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle:
          "Create a token that's a copy of target creature except it's a Shapeshifter instead of Bear.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: { set_subtype: ["Shapeshifter"] },
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
      // Printed "Bear" is dropped; new
      // subtype is "Shapeshifter"; types
      // half "Creature" preserved.
      expect(tokenInst!.cardData.type_line).toBe("Creature — Shapeshifter");
    });

    it("REPLACES the subtypes half with multiple listed subtypes (declared order preserved)", () => {
      // Source: "Legendary Creature — Bear
      // Spirit" (multi-subtype printed). The
      // copy token's `type_line` should be
      // "Legendary Creature — Shapeshifter
      // Advisor" (types half preserved; both
      // printed subtypes dropped; new
      // subtypes in declared order).
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "multi-set-subtype-source",
          name: "Mystic Bear (multi set_subtype source)",
          type_line: "Legendary Creature — Bear Spirit",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle:
          "Create a token that's a copy of target creature except it gains these new subtypes.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: { set_subtype: ["Shapeshifter", "Advisor"] },
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
      // Printed "Bear Spirit" is
      // dropped; new subtypes are
      // "Shapeshifter Advisor" in that
      // declared order; types half
      // "Legendary Creature" preserved.
      expect(tokenInst!.cardData.type_line).toBe(
        "Legendary Creature — Shapeshifter Advisor",
      );
    });

    it("em-dash separator is added even when the source has no subtypes half", () => {
      // Source: "Creature" (no em-dash, no
      // subtypes half). The copy token's
      // `type_line` should become
      // "Creature — Shapeshifter" with the
      // em-dash separator added by the
      // engine consult.
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "no-subtype-source",
          name: "Faceless One (no subtype set_subtype source)",
          type_line: "Creature",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle:
          "Create a token that's a copy of target creature except it gains the Shapeshifter subtype.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: { set_subtype: ["Shapeshifter"] },
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
      // em-dash separator is added; new
      // subtypes half is "Shapeshifter";
      // types half "Creature" preserved.
      expect(tokenInst!.cardData.type_line).toBe("Creature — Shapeshifter");
    });
  });

  describe("precedence — set_subtype REPLACE wins over add_subtype on the same axis", () => {
    it("set_subtype wins: add_subtype consult is SKIPPED when set_subtype is present", () => {
      // REPLACE wins on the same axis —
      // the new PRECEDENCE block in
      // schema.ts (follow-up 33 piece 1)
      // codifies this rule across the
      // P/T, color, type, subtype, and
      // keyword axes. Markers: `REPLACE
      // wins over additive on the
      // subtype axis`, parallel to the
      // `set_toughness` vs
      // `add_toughness` rule from
      // follow-up 32 / commit 41b3ad3a.
      //
      // Source: "Creature — Bear". The
      // effect lists BOTH:
      //   - set_subtype: ["Shapeshifter"]
      //     (REPLACE)
      //   - add_subtype: ["Advisor"]
      //     (ADDITIVE)
      // The token's type_line should be
      // "Creature — Shapeshifter"
      // (REPLACE wins; Advisor is
      // dropped; printed Bear is
      // dropped).
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "precedence-set-subtype-source",
          name: "Bear (precedence set_subtype source)",
          type_line: "Creature — Bear",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle:
          "Create a token that's a copy of target creature. set_subtype wins over add_subtype on the subtype axis.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: {
              set_subtype: ["Shapeshifter"],
              add_subtype: ["Advisor"],
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
      // "Bear" is dropped, the additive
      // "Advisor" is dropped (the
      // add_subtype consult is SKIPPED
      // when set_subtype is present on
      // the same effect), and the new
      // subtypes half is "Shapeshifter".
      // Types half "Creature"
      // preserved.
      expect(tokenInst!.cardData.type_line).toBe("Creature — Shapeshifter");
    });
  });
});
