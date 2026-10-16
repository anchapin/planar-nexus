/**
 * Wave 4.8 follow-up 29 priority 3 (lane 28, piece
 * 4/4) (#2614 follow-up):
 * `CopyPermanent.exceptions` arm — the per-copy
 * subtype-addition variant (Phyrexian Metamorph-style
 * "create a token that's a copy of [target] EXCEPT
 * it has additional subtypes").
 *
 * The schema adds an OPTIONAL
 * `exceptions: { add_subtype?: string[] }` arm to
 * `CopyPermanentSchema`. The engine consult rebuilds
 * each copy token's `cardData.type_line` to APPEND
 * the added subtypes to the printed subtypes (the
 * exceptions arm is ADDITIVE — no overwrite). The
 * exceptions are PER-COPY (each token receives the
 * same `add_subtype` list — the exceptions are NOT
 * per-token in v1; a per-token exception array
 * rides follow-up 30).
 *
 * Three test groups:
 *   1. schema — `CopyPermanent.exceptions` parses
 *      the additive `add_subtype` arm; rejects
 *      empty arrays and unknown sub-arm keys.
 *   2. engine — `exceptions.add_subtype` rebuilds
 *      each token's `cardData.type_line` to
 *      include the added subtypes (Phyrexian
 *      Metamorph-style — the source bear gets
 *      +Artifact subtype). Multiple tokens each
 *      receive the same subtype addition.
 *   3. regression — no `exceptions` arm
 *      preserves the v1 lane 70 / piece 1/4
 *      semantic (no type_line rebuild; the
 *      printed type_line is the token's
 *      type_line).
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
  "Test Copy Permanent Exceptions (lane 28 piece 4/4)";

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

describe("Wave 4.8 follow-up 29 priority 3 piece 4/4 — CopyPermanent.exceptions arm", () => {
  beforeAll(() => {
    resetCardScriptsForTests();
  });

  afterAll(() => {
    resetCardScriptsForTests();
  });

  beforeEach(() => {
    resetCardScriptsForTests();
  });

  describe("schema — CopyPermanent.exceptions parses the additive add_subtype arm", () => {
    it("accepts the exceptions arm with a non-empty add_subtype array (Phyrexian Metamorph-style)", () => {
      const parsed = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "test",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            exceptions: {
              add_subtype: ["Artifact"],
            },
          },
        ],
      });
      const eff = parsed.spell![0] as CardEffect & {
        exceptions?: { add_subtype?: string[] };
      };
      expect(eff.exceptions).toEqual({ add_subtype: ["Artifact"] });
    });

    it("accepts an empty exceptions object (the add_subtype arm is OPTIONAL)", () => {
      const parsed = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "test",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            exceptions: {},
          },
        ],
      });
      const eff = parsed.spell![0] as CardEffect & {
        exceptions?: Record<string, unknown>;
      };
      expect(eff.exceptions).toEqual({});
    });

    it("accepts the exceptions arm with multiple added subtypes", () => {
      const parsed = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "test",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            exceptions: {
              add_subtype: ["Artifact", "Equipment"],
            },
          },
        ],
      });
      const eff = parsed.spell![0] as CardEffect & {
        exceptions?: { add_subtype?: string[] };
      };
      expect(eff.exceptions).toEqual({
        add_subtype: ["Artifact", "Equipment"],
      });
    });

    it("rejects an empty add_subtype array (MIN 1 enforced at the Zod layer)", () => {
      // `z.array(z.string().min(1)).min(1)`
      // rejects the empty array (the v1 minimum
      // requires at least one added subtype).
      expect(() =>
        CardScriptSchema.parse({
          name: HOST_NAME,
          oracle: "test",
          spell: [
            {
              op: "CopyPermanent",
              target: { kind: "filter", value: "creature" },
              controller: "any",
              exceptions: { add_subtype: [] },
            },
          ],
        }),
      ).toThrow();
    });

    it("rejects an empty string entry in add_subtype (`.min(1)` per entry)", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: HOST_NAME,
          oracle: "test",
          spell: [
            {
              op: "CopyPermanent",
              target: { kind: "filter", value: "creature" },
              controller: "any",
              exceptions: { add_subtype: [""] },
            },
          ],
        }),
      ).toThrow();
    });

    it("rejects an unknown sub-arm key (the exceptions object is `.strict()`)", () => {
      // `.strict()` on the `exceptions` object
      // rejects unknown sub-arm keys.
      // `add_color` shipped in follow-up 30
      // priority 1; `add_power` shipped in
      // follow-up 30 priority 2;
      // `add_toughness` / `add_type` ride
      // follow-up 30 priorities 3 / 4.
      expect(() =>
        CardScriptSchema.parse({
          name: HOST_NAME,
          oracle: "test",
          spell: [
            {
              op: "CopyPermanent",
              target: { kind: "filter", value: "creature" },
              controller: "any",
              exceptions: { add_toughness: 1 },
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe("engine — exceptions.add_subtype rebuilds each token's cardData.type_line", () => {
    it("appends the added subtype to each copy token's type_line (Phyrexian Metamorph-style)", () => {
      // Place a Bear on Bob's battlefield.
      // Register a CopyPermanent spell with
      // `kind: "id"`, `value: <bear id>`,
      // `count: 1`, and
      // `exceptions: { add_subtype: ["Artifact"] }`.
      // Cast as Alice; the engine creates 1
      // token whose `cardData.type_line` is
      // rebuilt to append "Artifact" to the
      // source's subtypes (the source's
      // type_line is "Creature — Bear";
      // the token's type_line becomes
      // "Creature — Bear Artifact").
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "metamorph-source",
          name: "Grizzly Bears (metamorph source)",
          type_line: "Creature — Bear",
          power: "2",
          toughness: "2",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "Create a token with +Artifact subtype.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: { add_subtype: ["Artifact"] },
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
      // CR 707.2 + exceptions arm — the
      // token's type_line is rebuilt to
      // append "Artifact" to the printed
      // subtypes.
      expect(tokenInst.cardData.type_line).toBe(
        "Creature — Bear Artifact",
      );
      // The other printed fields are
      // preserved (CR 707.2 "all
      // characteristics copied" semantics).
      expect(tokenInst.cardData.name).toBe(
        "Grizzly Bears (metamorph source)",
      );
      expect(tokenInst.cardData.power).toBe("2");
      expect(tokenInst.cardData.toughness).toBe("2");
    });

    it("appends the added subtype to each token when count: 2 (regression guard for piece 1/4's count field)", () => {
      // Verifies the exceptions arm
      // composes with the count field
      // (lane 28 piece 1/4) — each token
      // receives the same subtype addition.
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "metamorph-count-source",
          name: "Bear (metamorph count source)",
          type_line: "Creature — Bear",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "Create 2 tokens with +Artifact subtype.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 2,
            exceptions: { add_subtype: ["Artifact"] },
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
      expect(tokenIds).toHaveLength(2);
      for (const id of tokenIds) {
        const inst = after.state.cards.get(id);
        expect(inst).toBeDefined();
        if (!inst) return;
        expect(inst.cardData.type_line).toBe(
          "Creature — Bear Artifact",
        );
      }
    });

    it("appends multiple added subtypes in order (multiple-subtypes case)", () => {
      // `add_subtype: ["Artifact", "Equipment"]` —
      // both subtypes are appended to the
      // printed subtypes in declared order.
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "multi-subtype-source",
          name: "Bear (multi-subtype source)",
          type_line: "Creature — Bear",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "Create a token with two added subtypes.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "any",
            count: 1,
            exceptions: {
              add_subtype: ["Artifact", "Equipment"],
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
        "Creature — Bear Artifact Equipment",
      );
    });
  });

  describe("regression — no exceptions arm preserves the v1 lane 70 / piece 1/4 semantic", () => {
    it("no exceptions arm: the printed type_line is the token's type_line (no rebuild)", () => {
      // Regression guard: without an
      // `exceptions` arm, the token's
      // type_line is the source's printed
      // type_line (CR 707.2 "all
      // characteristics copied" semantics,
      // unmodified). The exceptions arm is
      // OPTIONAL; the v1 minimum preserves
      // the no-rebuild semantic.
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "no-exceptions-source",
          name: "Bear (no exceptions source)",
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
      // The token's type_line is the
      // printed type_line (no rebuild).
      expect(tokenInst.cardData.type_line).toBe("Creature — Bear");
    });
  });
});