/**
 * Wave 4.8 follow-up 31 priority 1 (lane 28, piece
 * 1/N) (#2614 follow-up):
 * `CopyPermanent.exceptions.add_supertype` arm —
 * the per-copy supertype-prepend variant ("create
 * a token that's a copy of [target] EXCEPT it has
 * [supertypes] in addition to its other
 * characteristics").
 *
 * The schema adds an OPTIONAL
 * `add_supertype: z.array(z.enum(["Legendary",
 * "Snow", "Basic"])).min(1).optional()` sub-arm to
 * `CopyPermanentSchema.exceptions`. The engine
 * consult reads the printed `cardData.type_line`
 * and PREPENDS the listed supertypes to the
 * OUTER FRONT of the TYPES half (the supertypes
 * come BEFORE the `add_type` prepend AND BEFORE
 * the printed types; e.g. `"Creature — Bear"` +
 * `["Legendary"]` = `"Legendary Creature —
 * Bear"` — the supertype is outermost in the
 * types half, per CR 205.4: "[Supertypes] [Types]
 * — [Subtypes]"). The subtypes half is preserved.
 * The arm is ADDITIVE — no overwrite of the
 * printed supertypes.
 *
 * Six test groups:
 *   1. schema — `add_supertype` parses the three
 *      `SUPERTYPES` enum values; rejects unknown
 *      supertypes, empty arrays, and unknown
 *      sub-arm keys (`.strict()`).
 *   2. engine — `add_supertype` prepends to the
 *      OUTER FRONT of the types half
 *      (single-supertype + multi-supertype cases);
 *      the subtypes half is preserved.
 *   3. cross-arm — `add_supertype` composes with
 *      the follow-up 30 priority 4 `add_type` arm
 *      (supertype OUTERMOST, type MIDDLE, then
 *      printed types) and with the follow-up 29
 *      priority 3 piece 4/4 `add_subtype` arm
 *      (supertype OUTERMOST, type MIDDLE, subtype
 *      INNER, then printed types).
 *   4. regression — no `exceptions` arm and an
 *      empty `exceptions` object preserve the v1
 *      lane 70 / piece 1/4 semantic (printed
 *      type_line unchanged).
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
  "Test Copy Permanent Exceptions Add Supertype (follow-up 31 priority 1)";

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

describe("Wave 4.8 follow-up 31 priority 1 — CopyPermanent.exceptions.add_supertype arm", () => {
  beforeAll(() => {
    resetCardScriptsForTests();
  });

  afterAll(() => {
    resetCardScriptsForTests();
  });

  beforeEach(() => {
    resetCardScriptsForTests();
  });

  describe("schema — CopyPermanent.exceptions.add_supertype parses SUPERTYPES", () => {
    it("accepts the add_supertype sub-arm with a single supertype ('Legendary')", () => {
      const parsed = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "test",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            exceptions: { add_supertype: ["Legendary"] },
          },
        ],
      });
      const eff = parsed.spell![0] as CardEffect & {
        exceptions?: { add_supertype?: string[] };
      };
      expect(eff.exceptions).toEqual({
        add_supertype: ["Legendary"],
      });
    });

    it("accepts the add_supertype sub-arm with multiple supertypes", () => {
      const parsed = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "test",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            exceptions: { add_supertype: ["Snow", "Basic"] },
          },
        ],
      });
      const eff = parsed.spell![0] as CardEffect & {
        exceptions?: { add_supertype?: string[] };
      };
      expect(eff.exceptions).toEqual({
        add_supertype: ["Snow", "Basic"],
      });
    });

    it("accepts 'Basic' in the add_supertype array (the standard MTG supertype)", () => {
      // Verifies the Zod enum includes
      // "Basic" alongside "Legendary" and
      // "Snow" — `Basic` is the supertype
      // for basic lands and is part of
      // the standard MTG supertype set
      // (CR 205.4).
      const parsed = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "test",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            exceptions: { add_supertype: ["Basic"] },
          },
        ],
      });
      const eff = parsed.spell![0] as CardEffect & {
        exceptions?: { add_supertype?: string[] };
      };
      expect(eff.exceptions).toEqual({
        add_supertype: ["Basic"],
      });
    });

    it("rejects an empty add_supertype array (MIN 1 enforced at the Zod layer)", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: HOST_NAME,
          oracle: "test",
          spell: [
            {
              op: "CopyPermanent",
              target: { kind: "filter", value: "creature" },
              controller: "any",
              exceptions: { add_supertype: [] },
            },
          ],
        }),
      ).toThrow();
    });

    it("rejects an unknown supertype (the Zod enum rejects non-SUPERTYPES values)", () => {
      // The Zod enum rejects supertypes
      // outside the three-value
      // SUPERTYPES list. The handoff
      // spec restricts the arm to the
      // standard three supertypes;
      // card types ("Artifact" /
      // "Creature" / etc.) and unknown
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
              exceptions: { add_supertype: ["World"] },
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
              exceptions: { add_supertype: ["Artifact"] },
            },
          ],
        }),
      ).toThrow();
    });

    it("rejects an unknown sub-arm key (the exceptions object stays .strict())", () => {
      // The follow-up 29 piece 4/4
      // `exceptions` Zod object is
      // `.strict()` — unknown keys are
      // rejected. The follow-up 31
      // priority 1 `add_supertype` arm
      // is a new OPTIONAL sub-arm;
      // typos like `add_supertypes`
      // (plural) are rejected.
      expect(() =>
        CardScriptSchema.parse({
          name: HOST_NAME,
          oracle: "test",
          spell: [
            {
              op: "CopyPermanent",
              target: { kind: "filter", value: "creature" },
              controller: "any",
              exceptions: { add_supertypes: ["Legendary"] },
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe("engine — add_supertype prepends to the OUTER FRONT of the types half", () => {
    it("prepends 'Legendary' to a 'Creature — Bear' type_line", () => {
      // Place a bear on Bob's
      // battlefield. Register a
      // CopyPermanent spell with
      // `kind: "id"`, `value: <bear id>`,
      // `count: 1`, and
      // `exceptions: { add_supertype: ["Legendary"] }`.
      // Cast as Alice; the engine creates
      // 1 token whose `cardData.type_line`
      // is rebuilt to prepend "Legendary"
      // to the OUTER FRONT of the printed
      // types — the bear's
      // "Creature — Bear" becomes
      // "Legendary Creature — Bear". The
      // subtypes half ("Bear") is
      // preserved.
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "add-supertype-source",
          name: "Grizzly Bears (add_supertype source)",
          type_line: "Creature — Bear",
          power: "2",
          toughness: "2",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "Create a token that's a legendary bear.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: { add_supertype: ["Legendary"] },
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
      // type_line: "Creature — Bear" +
      // ["Legendary"] → "Legendary
      // Creature — Bear". The supertype
      // is outermost (per CR 205.4); the
      // subtypes half ("Bear") is
      // preserved.
      expect(tokenInst.cardData.type_line).toBe(
        "Legendary Creature — Bear",
      );
      // Other printed fields are
      // preserved (CR 707.2 "all
      // characteristics copied"
      // semantics).
      expect(tokenInst.cardData.name).toBe(
        "Grizzly Bears (add_supertype source)",
      );
      expect(tokenInst.cardData.power).toBe("2");
      expect(tokenInst.cardData.toughness).toBe("2");
    });

    it("prepends multiple supertypes in declared order (multi-supertype case)", () => {
      // `add_supertype: ["Snow", "Basic"]`
      // — both supertypes are prepended
      // in declared order to the printed
      // "Creature — Bear" → "Snow Basic
      // Creature — Bear". The subtypes
      // half ("Bear") is preserved.
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "multi-supertype-source",
          name: "Bear (multi-supertype source)",
          type_line: "Creature — Bear",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "Create a token that's a snow basic bear.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: {
              add_supertype: ["Snow", "Basic"],
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
      expect(tokenInst.cardData.type_line).toBe(
        "Snow Basic Creature — Bear",
      );
    });
  });

  describe("cross-arm — add_supertype composes with add_type and add_subtype", () => {
    it("add_supertype + add_type: supertype OUTERMOST, added type MIDDLE, printed type INNER", () => {
      // Cross-arm order test for the
      // follow-up 31 priority 1
      // `add_supertype` arm +
      // follow-up 30 priority 4
      // `add_type` arm. The `add_type`
      // consult runs FIRST (it prepends
      // the added card type to the
      // FRONT of the types half —
      // types half becomes `[Artifact]
      // [printed types]`). Then the
      // `add_supertype` consult runs
      // (it prepends the supertype to
      // the OUTER FRONT of the types
      // half — types half becomes
      // `[Legendary] [Artifact]
      // [printed types]`). The
      // subtypes half is preserved.
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "cross-arm-supertype-type-source",
          name: "Bear (cross-arm supertype + type source)",
          type_line: "Creature — Bear",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "Create a token that's a legendary artifact bear.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: {
              add_supertype: ["Legendary"],
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
      // First, add_type prepends
      // "Artifact" to the types half:
      // "Creature — Bear" →
      // "Artifact Creature — Bear".
      // Then, add_supertype prepends
      // "Legendary" to the OUTER FRONT
      // of the types half:
      // "Artifact Creature — Bear" →
      // "Legendary Artifact Creature —
      // Bear".
      expect(tokenInst.cardData.type_line).toBe(
        "Legendary Artifact Creature — Bear",
      );
    });

    it("add_supertype + add_subtype: supertype OUTERMOST, subtypes INNER (appended)", () => {
      // Cross-arm order test for the
      // follow-up 31 priority 1
      // `add_supertype` arm +
      // follow-up 29 priority 3 piece
      // 4/4 `add_subtype` arm. The
      // `add_subtype` consult runs
      // FIRST (it appends to the
      // subtypes half — type_line
      // becomes `[types] — [subtypes]
      // [added subtypes]`). Then the
      // `add_supertype` consult runs
      // (it prepends to the OUTER FRONT
      // of the types half — types half
      // becomes `[supertype] [printed
      // types]`). The subtypes half is
      // preserved.
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "cross-arm-supertype-subtype-source",
          name: "Bear (cross-arm supertype + subtype source)",
          type_line: "Creature — Bear",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "Create a token that's a legendary bear warrior.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: {
              add_supertype: ["Legendary"],
              add_subtype: ["Warrior"],
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
      // First, add_subtype appends
      // "Warrior" to the subtypes
      // half: "Creature — Bear" →
      // "Creature — Bear Warrior".
      // Then, add_supertype prepends
      // "Legendary" to the OUTER FRONT
      // of the types half:
      // "Creature — Bear Warrior" →
      // "Legendary Creature — Bear
      // Warrior".
      expect(tokenInst.cardData.type_line).toBe(
        "Legendary Creature — Bear Warrior",
      );
    });
  });

  describe("regression — no add_supertype arm preserves the v1 lane 70 / piece 1/4 semantic", () => {
    it("no exceptions arm: the printed type_line is the token's type_line (no rebuild)", () => {
      // Regression guard: without an
      // `exceptions` arm, the token's
      // type_line is the source's printed
      // type_line (CR 707.2 "all
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
          id: "no-exceptions-supertype-source",
          name: "Bear (no exceptions supertype source)",
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
      // Printed type_line is preserved
      // unchanged.
      expect(tokenInst.cardData.type_line).toBe("Creature — Bear");
    });
  });
});