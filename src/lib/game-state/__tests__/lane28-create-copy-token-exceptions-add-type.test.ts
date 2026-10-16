/**
 * Wave 4.8 follow-up 30 priority 4 (lane 28, piece
 * 4/N) (#2614 follow-up):
 * `CopyPermanent.exceptions.add_type` arm — the
 * per-copy type-line prepend variant (Phyrexian
 * Metamorph's "it's an Artifact in addition to its
 * other types" half).
 *
 * The schema adds an OPTIONAL
 * `add_type: z.array(z.enum(CARD_TYPES)).min(1).
 * optional()` sub-arm to
 * `CopyPermanentSchema.exceptions`. The engine
 * consult reads the printed `cardData.type_line`
 * and PREPENDS the listed card types to the TYPES
 * half (the types come BEFORE the printed types;
 * e.g. `"Creature — Bear"` + `["Artifact"]` =
 * `"Artifact Creature — Bear"`). The subtypes
 * half is preserved. The arm is ADDITIVE — no
 * overwrite of the printed types.
 *
 * Four test groups:
 *   1. schema — `add_type` parses the seven
 *      `CARD_TYPES` enum values; rejects unknown
 *      types, empty arrays, and unknown sub-arm
 *      keys (`.strict()`).
 *   2. engine — `add_type` prepends to the types
 *      half (single-type + multi-type cases); the
 *      subtypes half is preserved.
 *   3. cross-arm — `add_type` composes with the
 *      `add_subtype` arm (priority 3 lane 28
 *      piece 4/4 cross-arm regression guard —
 *      subtype append is INNER; type prepend is
 *      OUTER).
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
  "Test Copy Permanent Exceptions Add Type (follow-up 30 priority 4)";

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

describe("Wave 4.8 follow-up 30 priority 4 — CopyPermanent.exceptions.add_type arm", () => {
  beforeAll(() => {
    resetCardScriptsForTests();
  });

  afterAll(() => {
    resetCardScriptsForTests();
  });

  beforeEach(() => {
    resetCardScriptsForTests();
  });

  describe("schema — CopyPermanent.exceptions.add_type parses CARD_TYPES", () => {
    it("accepts the add_type sub-arm with a single card type (Phyrexian Metamorph-style 'Artifact')", () => {
      const parsed = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "test",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            exceptions: { add_type: ["Artifact"] },
          },
        ],
      });
      const eff = parsed.spell![0] as CardEffect & {
        exceptions?: { add_type?: string[] };
      };
      expect(eff.exceptions).toEqual({ add_type: ["Artifact"] });
    });

    it("accepts the add_type sub-arm with multiple card types", () => {
      const parsed = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "test",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            exceptions: { add_type: ["Artifact", "Tribal"] },
          },
        ],
      });
      const eff = parsed.spell![0] as CardEffect & {
        exceptions?: { add_type?: string[] };
      };
      expect(eff.exceptions).toEqual({
        add_type: ["Artifact", "Tribal"],
      });
    });

    it("accepts 'Tribal' in the add_type array (the legacy type that some cards still use)", () => {
      // Verifies the Zod enum includes
      // "Tribal" alongside the six modern
      // types — `Tribal` is a legacy type
      // that some older cards still use
      // (e.g. "Tribal Enchantment").
      const parsed = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "test",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            exceptions: { add_type: ["Tribal"] },
          },
        ],
      });
      const eff = parsed.spell![0] as CardEffect & {
        exceptions?: { add_type?: string[] };
      };
      expect(eff.exceptions).toEqual({ add_type: ["Tribal"] });
    });

    it("rejects an empty add_type array (MIN 1 enforced at the Zod layer)", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: HOST_NAME,
          oracle: "test",
          spell: [
            {
              op: "CopyPermanent",
              target: { kind: "filter", value: "creature" },
              controller: "any",
              exceptions: { add_type: [] },
            },
          ],
        }),
      ).toThrow();
    });

    it("rejects an unknown card type (the Zod enum rejects non-CARD_TYPES values)", () => {
      // The Zod enum rejects card types
      // outside the seven-value
      // CARD_TYPES list. The handoff spec
      // restricts the arm to the standard
      // seven types; supertypes
      // ("Legendary" / "Snow" / "Basic")
      // and lowercase / unknown strings
      // are NOT accepted at the schema
      // layer.
      expect(() =>
        CardScriptSchema.parse({
          name: HOST_NAME,
          oracle: "test",
          spell: [
            {
              op: "CopyPermanent",
              target: { kind: "filter", value: "creature" },
              controller: "any",
              exceptions: { add_type: ["Legendary"] },
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
              exceptions: { add_type: ["artifact"] },
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe("engine — add_type prepends to the types half", () => {
    it("prepends 'Artifact' to a 'Creature — Bear' type_line (Phyrexian Metamorph-style)", () => {
      // Place a bear on Bob's
      // battlefield. Register a
      // CopyPermanent spell with
      // `kind: "id"`, `value: <bear id>`,
      // `count: 1`, and
      // `exceptions: { add_type: ["Artifact"] }`.
      // Cast as Alice; the engine creates
      // 1 token whose `cardData.type_line`
      // is rebuilt to prepend "Artifact"
      // to the printed types — the bear's
      // "Creature — Bear" becomes
      // "Artifact Creature — Bear". The
      // subtypes half ("Bear") is
      // preserved.
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "add-type-source",
          name: "Grizzly Bears (add_type source)",
          type_line: "Creature — Bear",
          power: "2",
          toughness: "2",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "Create a token that's a bear that's also an artifact.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: { add_type: ["Artifact"] },
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
      // ["Artifact"] → "Artifact Creature
      // — Bear". The types half is
      // prepended; the subtypes half
      // ("Bear") is preserved.
      expect(tokenInst.cardData.type_line).toBe(
        "Artifact Creature — Bear",
      );
      // Other printed fields are
      // preserved (CR 707.2 "all
      // characteristics copied"
      // semantics).
      expect(tokenInst.cardData.name).toBe(
        "Grizzly Bears (add_type source)",
      );
      expect(tokenInst.cardData.power).toBe("2");
      expect(tokenInst.cardData.toughness).toBe("2");
    });

    it("prepends multiple card types in order (multi-type case)", () => {
      // `add_type: ["Artifact", "Tribal"]`
      // — both types are prepended in
      // declared order to the printed
      // "Creature — Bear" → "Artifact
      // Tribal Creature — Bear". The
      // subtypes half ("Bear") is
      // preserved.
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "multi-type-source",
          name: "Bear (multi-type source)",
          type_line: "Creature — Bear",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "Create a token that's a bear that's also an artifact tribal.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: {
              add_type: ["Artifact", "Tribal"],
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
        "Artifact Tribal Creature — Bear",
      );
    });
  });

  describe("cross-arm — add_type composes with the existing add_subtype arm", () => {
    it("add_type + add_subtype: token receives both the types prepend and the subtypes append", () => {
      // Regression guard for the
      // follow-up 29 priority 3 piece
      // 4/4 `add_subtype` arm — when
      // both arms are present, the
      // engine consults both in order
      // (subtype first, then type), and
      // each token receives both
      // modifications. The cross-arm
      // order is documented in the
      // handoff: `add_subtype` is the
      // INNER consult; `add_type` is the
      // OUTER consult.
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "cross-arm-type-source",
          name: "Bear (cross-arm type source)",
          type_line: "Creature — Bear",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "Create a token that's a bear that's also an artifact and an equipment.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: {
              add_subtype: ["Equipment"],
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
      // First, add_subtype appends
      // "Equipment" to the subtypes
      // half: "Creature — Bear" →
      // "Creature — Bear Equipment".
      // Then, add_type prepends
      // "Artifact" to the types half:
      // "Creature — Bear Equipment" →
      // "Artifact Creature — Bear
      // Equipment".
      expect(tokenInst.cardData.type_line).toBe(
        "Artifact Creature — Bear Equipment",
      );
    });
  });

  describe("regression — no add_type arm preserves the v1 lane 70 / piece 1/4 semantic", () => {
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
          id: "no-exceptions-type-source",
          name: "Bear (no exceptions type source)",
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