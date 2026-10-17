/**
 * Wave 4.8 follow-up 34 priority 1 (lane 28, piece
 * 3/N) (#2614 follow-up):
 * `CopyPermanent.exceptions.set_supertype` arm —
 * the per-copy outermost-prefix REPLACE variant
 * for the supertype segment of the types half of
 * `type_line` (e.g. "Create a token that's a copy
 * of target creature except it's Legendary."
 * — drop printed supertype-prefix words, replace
 * with the listed supertypes in declared order,
 * preserve the rest of the types half + the
 * subtypes half).
 *
 * The schema adds an OPTIONAL
 * `set_supertype: ("Legendary" | "Snow" |
 * "Basic")[]` sub-arm to the
 * `CopyPermanentSchema.exceptions` object. The
 * enum is the legal supertype set per CR 205.4
 * ("[Supertypes] [Types] — [Subtypes]"). The
 * engine consult runs LAST in the per-pass
 * order — by the time it executes, the types
 * half has been finalized by `add_type` /
 * `set_type` / `add_supertype` cancellations.
 *
 * Three test groups:
 *   1. schema — `set_supertype` parses as a
 *      non-empty array of the legal supertype
 *      enum; rejects empty arrays, illegal
 *      supertype strings, and unknown sub-arm
 *      keys (`.strict()`).
 *   2. engine — `set_supertype` REPLACES the
 *      supertype-prefix segment of the types
 *      half (single supertype case + multi
 *      supertype case); the existing
 *      supertype-prefix words are dropped; the
 *      rest of the types half is preserved
 *      verbatim; the subtypes half is preserved
 *      unchanged; the em-dash separator is added
 *      when the source had no subtypes half.
 *   3. precedence — `set_supertype` REPLACE
 *      wins over `add_supertype` when both are
 *      set on the same effect (the REPLACE
 *      variant takes PRECEDENCE — the additive
 *      `add_supertype` consult is SKIPPED).
 *   4. cross-axis — `set_supertype` + `set_type`
 *      + `set_subtype` on the same effect
 *      rebuilds the entire type_line as
 *      `<set_supertype> <set_type> —
 *      <set_subtype>` (all four axes cooperate
 *      — each consult operates on the latest
 *      state).
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
  "Test Copy Permanent Exceptions Set Supertype (follow-up 34 priority 1)";

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

describe("CopyPermanent.exceptions.set_supertype — follow-up 34", () => {
  describe("schema — set_supertype parses as a non-empty supertype enum array", () => {
    it("accepts a single-supertype set_supertype array (Legendary)", () => {
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle:
          "Create a token that's a copy of target creature except it's Legendary.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            count: 1,
            exceptions: { set_supertype: ["Legendary"] },
          },
        ],
      });
      const eff = script.spell![0] as CardEffect & {
        op: "CopyPermanent";
        exceptions?: { set_supertype?: string[] };
      };
      expect(eff.exceptions?.set_supertype).toEqual(["Legendary"]);
    });

    it("accepts a multi-supertype set_supertype array (declared order preserved)", () => {
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle:
          "Create a token that's a copy of target creature except it's Legendary Snow.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            count: 1,
            exceptions: { set_supertype: ["Legendary", "Snow"] },
          },
        ],
      });
      const eff = script.spell![0] as CardEffect & {
        op: "CopyPermanent";
        exceptions?: { set_supertype?: string[] };
      };
      expect(eff.exceptions?.set_supertype).toEqual(["Legendary", "Snow"]);
    });

    it("accepts all three supertype enum values in one array", () => {
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle:
          "Create a token that's a copy of target creature except it's Legendary Snow Basic.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            count: 1,
            exceptions: {
              set_supertype: ["Legendary", "Snow", "Basic"],
            },
          },
        ],
      });
      const eff = script.spell![0] as CardEffect & {
        op: "CopyPermanent";
        exceptions?: { set_supertype?: string[] };
      };
      expect(eff.exceptions?.set_supertype).toEqual([
        "Legendary",
        "Snow",
        "Basic",
      ]);
    });

    it("rejects an empty set_supertype array (min(1))", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: HOST_NAME,
          oracle: "Empty set_supertype should fail.",
          spell: [
            {
              op: "CopyPermanent",
              target: { kind: "filter", value: "creature" },
              controller: "any",
              count: 1,
              exceptions: { set_supertype: [] },
            },
          ],
        }),
      ).toThrow();
    });

    it("rejects an illegal supertype string (e.g. 'World')", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: HOST_NAME,
          oracle:
            "Illegal supertype should fail (World not in the supertype enum).",
          spell: [
            {
              op: "CopyPermanent",
              target: { kind: "filter", value: "creature" },
              controller: "any",
              count: 1,
              exceptions: { set_supertype: ["World"] },
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
                set_supertype: ["Legendary"],
                set_super_kind: ["ancient"],
              },
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe("engine — set_supertype REPLACES the supertype-prefix segment", () => {
    it("REPLACES the printed supertype-prefix word with the listed supertype (declared order preserved; rest of types half preserved)", () => {
      // Source: "Legendary Creature — Bear"
      // (printed supertype is "Legendary",
      // types is "Creature", subtypes is
      // "Bear"). The copy token's
      // `type_line` should be
      // "Snow Creature — Bear" — the
      // printed "Legendary" is dropped;
      // the listed "Snow" is placed at
      // the outermost position; the rest
      // of the types half ("Creature") is
      // preserved verbatim; the subtypes
      // half ("Bear") is preserved.
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "single-set-supertype-source",
          name: "Legendary Bear (single set_supertype source)",
          type_line: "Legendary Creature — Bear",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle:
          "Create a token that's a copy of target creature except it's Snow.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: { set_supertype: ["Snow"] },
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
      // Printed "Legendary" is dropped;
      // new supertype is "Snow"; types
      // half "Creature" preserved;
      // subtypes half "Bear" preserved.
      expect(tokenInst!.cardData.type_line).toBe("Snow Creature — Bear");
    });

    it("REPLACES the printed supertype-prefix word with multiple listed supertypes in declared order", () => {
      // Source: "Legendary Creature —
      // Bear". The copy token's
      // `type_line` should be
      // "Snow Basic Creature — Bear" —
      // printed Legendary dropped; new
      // supertypes "Snow Basic" in declared
      // order; rest of types half +
      // subtypes half preserved.
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "multi-set-supertype-source",
          name: "Legendary Bear (multi set_supertype source)",
          type_line: "Legendary Creature — Bear",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle:
          "Create a token that's a copy of target creature except it's Snow Basic.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: { set_supertype: ["Snow", "Basic"] },
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
      // Printed "Legendary" dropped;
      // new supertypes "Snow Basic"
      // in declared order; rest of types
      // half preserved; subtypes half
      // preserved.
      expect(tokenInst!.cardData.type_line).toBe("Snow Basic Creature — Bear");
    });

    it("drops the em-dash when the source has no subtypes half", () => {
      // Source: "Creature" (no em-dash,
      // no subtypes half). The copy
      // token's type_line should become
      // "Legendary Creature" — listed
      // supertype prepended; rest of
      // types half preserved verbatim;
      // em-dash separator dropped since
      // there was no subtypes half.
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "no-subtype-set-supertype-source",
          name: "Faceless One (no subtypes set_supertype source)",
          type_line: "Creature",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle:
          "Create a token that's a copy of target creature except it's Legendary.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: { set_supertype: ["Legendary"] },
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
      // No supertype-prefix word is
      // dropped (since the source had
      // none); no subtypes half is
      // appended (since the source had
      // none); the listed "Legendary"
      // is placed at the outermost
      // position before the rest of
      // the types half.
      expect(tokenInst!.cardData.type_line).toBe("Legendary Creature");
    });
  });

  describe("precedence — set_supertype REPLACE wins over add_supertype on the same axis", () => {
    it("set_supertype wins: add_supertype consult is SKIPPED when set_supertype is present", () => {
      // REPLACE wins on the same axis —
      // the PRECEDENCE block in
      // schema.ts (follow-up 33 piece 1)
      // codifies this rule. Markers:
      // `REPLACE wins over additive on
      // the supertype axis`, parallel
      // to `set_subtype` vs
      // `add_subtype` (follow-up 33),
      // `set_type` vs `add_type`
      // (follow-up 34 piece 2/N), and
      // `set_toughness` vs
      // `add_toughness` (follow-up 32 /
      // commit 41b3ad3a).
      //
      // Source: "Basic Creature —
      // Bear". Effect lists BOTH:
      //   - set_supertype: ["Legendary"]
      //     (REPLACE)
      //   - add_supertype: ["Snow"]
      //     (ADDITIVE)
      // The token's type_line should
      // be "Legendary Creature —
      // Bear" — REPLACE wins;
      // add_supertype "Snow" is
      // dropped via SKIP; printed
      // "Basic" is dropped.
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "precedence-set-supertype-source",
          name: "Basic Bear (precedence set_supertype source)",
          type_line: "Basic Creature — Bear",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle:
          "Create a token that's a copy of target creature. set_supertype wins over add_supertype on the supertype axis.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: {
              set_supertype: ["Legendary"],
              add_supertype: ["Snow"],
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
      // REPLACE wins: printed "Basic"
      // is dropped; additive "Snow" is
      // dropped via SKIP; new
      // supertype is "Legendary"; types
      // half preserved; subtypes half
      // preserved.
      expect(tokenInst!.cardData.type_line).toBe("Legendary Creature — Bear");
    });
  });

  describe("cross-axis — set_supertype + set_type + set_subtype cooperates", () => {
    it("set_supertype + set_type + set_subtype on the same effect rebuilds type_line as '<set_supertype> <set_type> — <set_subtype>'", () => {
      // Cross-axis REPLACE forms are
      // allowed together. The per-pass
      // consult order in
      // `applyExceptions` is:
      //   1. set_subtype (subtypes
      //      REPLACE)
      //   2. set_type (types REPLACE)
      //   3. set_supertype (outermost
      //      prefix REPLACE — operates
      //      on the post-set_type types
      //      half)
      // Final type_line:
      // "<set_supertype> <set_type> —
      // <set_subtype>" — all four axes
      // cooperate; each consult operates
      // on the latest state.
      //
      // Source: "Legendary Creature —
      // Bear Spirit". Effect lists:
      //   - set_supertype: ["Snow"]
      //   - set_type: ["Artifact",
      //     "Creature"]
      //   - set_subtype: ["Construct"]
      // The token's type_line should be
      // "Snow Artifact Creature —
      // Construct" (printed supertype
      // "Legendary" dropped; new
      // supertype "Snow" placed at
      // outermost; types half
      // "Artifact Creature" (declared
      // order); subtypes half
      // "Construct" — printed "Bear
      // Spirit" dropped).
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "cross-axis-set-supertype-source",
          name: "Mystic Bear (cross-axis set_supertype source)",
          type_line: "Legendary Creature — Bear Spirit",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle:
          "Create a token that's a copy of target creature except it's a Snow Artifact Creature Construct (cross-axis set_supertype + set_type + set_subtype).",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: {
              set_supertype: ["Snow"],
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
      // Cross-axis REPLACE rebuilds:
      //   - printed supertype
      //     "Legendary" dropped;
      //   - new supertype "Snow" at
      //     outermost;
      //   - types half "Artifact
      //     Creature" (declared
      //     order);
      //   - subtypes half "Construct"
      //     (printed "Bear Spirit"
      //     dropped).
      expect(tokenInst!.cardData.type_line).toBe(
        "Snow Artifact Creature — Construct",
      );
    });
  });
});
