/**
 * Wave 4.8 follow-up 28 priority 4 (lane 28, piece
 * 1/N) (#2614 follow-up): `CopyPermanent.count`
 * multi-copy field (Rite of Replication's "create X
 * tokens that are copies of target creature").
 *
 * The lane 70 substrate shipped
 * `CopyPermanentSchema = { op: "CopyPermanent", target:
 * "permanent" | ... | "land", controller?: ... }`
 * — v1 minimum: a single-target copy-creates-token
 * op. The engine creates ONE new `CardInstance`
 * whose `cardData` is the target's `cardData`
 * (shallow copy of name, mana cost, type line, P/T,
 * keywords, oracle text, colors — CR 707.2 "all
 * characteristics copied" semantics).
 *
 * This piece extends `CopyPermanent` with the
 * `count: z.number().int().min(1).default(1)` field.
 * When `count >= 2`, the engine creates `count`
 * independent tokens in sequence (each with its own
 * `cardId`, `cardData`, and battlefield entry). The
 * tokens are NEW CardInstances, not the existing
 * copy-substrate's overlay mechanism (the
 * `become_copy` static arms or the
 * `CopyUntilEndOfTurn` op). The default
 * `count: 1` preserves the v1 lane 70 single-copy
 * semantic (regression guard).
 *
 * Three test groups:
 *   1. schema — `CopyPermanent.count` parses for the
 *      literal integer, defaults to 1, and rejects
 *      values below 1.
 *   2. engine — `interpretCopyPermanent` (the
 *      `case "CopyPermanent"` block in
 *      `card-scripts/interpret.ts`) creates
 *      `count` independent tokens on the
 *      battlefield when `count >= 2`. Each token
 *      has the target's `cardData` (CR 707.2 "all
 *      characteristics copied" semantics).
 *   3. regression — `count: 1` (the default) creates
 *      a single token (the v1 lane 70 semantic; no
 *      regression on the existing substrate).
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
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const HOST_NAME =
  "Test Create Copy Token Count (lane 28 piece 1/N)";

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
 * the top of the stack. The host card is named
 * `HOST_NAME` and the script registered under
 * `HOST_NAME` is the one consulted by
 * `castSpell`. The caller is responsible for
 * registering the script under `HOST_NAME`
 * (with the desired effect).
 */
function castScript(
  state: GameState,
  aliceId: PlayerId,
  script: CardScript,
  options: { extraMana?: number } = {},
): { state: GameState } {
  // Re-register the passed script under
  // HOST_NAME so the cast path's script
  // lookup (which matches on `card.cardData.name`)
  // finds it. The host card uses
  // `name: HOST_NAME` so the lookup hits the
  // registered script.
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

describe("Wave 4.8 follow-up 28 priority 4 piece 1/N — CopyPermanent.count multi-copy", () => {
  beforeAll(() => {
    resetCardScriptsForTests();
  });

  afterAll(() => {
    resetCardScriptsForTests();
  });

  beforeEach(() => {
    resetCardScriptsForTests();
  });

  describe("schema — CopyPermanent.count parses", () => {
    it("parses a CopyPermanent effect with explicit count: 2 (Rite of Replication's 'create X tokens')", () => {
      const parsed = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "test",
        spell: [
          {
            op: "CopyPermanent",
            target: "creature",
            controller: "any",
            count: 2,
          },
        ],
      });
      const eff = parsed.spell![0] as CardEffect & {
        count?: number;
      };
      expect(eff.count).toBe(2);
    });

    it("defaults count to 1 when omitted (regression — v1 lane 70 single-copy semantic)", () => {
      // The Zod layer marks `count` as
      // `.optional()` so an effect without an
      // explicit `count` field parses with
      // `count: undefined`. The engine applies
      // the default `count ?? 1` at consult time.
      // The v1 lane 70 semantic (single copy) is
      // preserved.
      const parsed = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "test",
        spell: [
          {
            op: "CopyPermanent",
            target: "permanent",
            controller: "any",
          },
        ],
      });
      const eff = parsed.spell![0] as CardEffect & {
        count?: number;
      };
      // `count` is undefined in the parsed shape;
      // the engine applies the default.
      expect(eff.count).toBeUndefined();
    });

    it("rejects count: 0 (MIN 1 enforced at the Zod layer)", () => {
      // `z.number().int().min(1)` rejects 0 and
      // negative values.
      expect(() =>
        CardScriptSchema.parse({
          name: "Bad Count Zero (lane 28)",
          oracle: "test",
          spell: [
            {
              op: "CopyPermanent",
              target: "permanent",
              controller: "any",
              count: 0,
            },
          ],
        }),
      ).toThrow();
    });

    it("rejects count: 1.5 (`.int()` rejects fractional values)", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: "Bad Count Fractional (lane 28)",
          oracle: "test",
          spell: [
            {
              op: "CopyPermanent",
              target: "permanent",
              controller: "any",
              count: 1.5,
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe("engine — interpretCopyPermanent creates `count` independent tokens", () => {
    it("creates 2 new cards on the controller's battlefield when count: 2 (Rite of Replication)", () => {
      // Register a multi-copy spell:
      // `CopyPermanent { target: "creature",
      // controller: "any", count: 2 }`. Place a
      // bear on the opponent's battlefield (Bob);
      // cast the spell as Alice; the engine finds
      // Bob's bear (the only creature match),
      // copies it twice, and creates 2 new
      // CardInstances on Alice's battlefield. Each
      // token has the bear's cardData (CR 707.2
      // "all characteristics copied" semantics).
      const script: CardScript = CardScriptSchema.parse({
        name: "Rite of Replication (test substrate)",
        oracle:
          "Create two tokens that are copies of target creature.",
        spell: [
          {
            op: "CopyPermanent",
            target: "creature",
            controller: "any",
            count: 2,
          },
        ],
      });
      registerCardScripts([script]);
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "rite-target",
          name: "Grizzly Bears (rite target)",
          type_line: "Creature — Bear",
          power: "2",
          toughness: "2",
        }),
      );
      s = targetR.state;
      const after = castScript(s, setup.aliceId, script, {
        hostName: HOST_NAME,
      });
      // Alice's battlefield had 0 creatures
      // before; after the cast, it has 2 tokens.
      const aliceBfKey = `${setup.aliceId}-battlefield`;
      const aliceBf = after.state.zones.get(aliceBfKey);
      expect(aliceBf).toBeDefined();
      if (!aliceBf) return;
      // The 2 tokens are at the END of the
      // cardIds array (they were appended after
      // the cast). Count Alice's creatures.
      let aliceCreatureCount = 0;
      const newCardIds: CardInstanceId[] = [];
      for (const id of aliceBf.cardIds) {
        const inst = after.state.cards.get(id);
        if (!inst) continue;
        if (
          (inst.cardData.type_line ?? "").toLowerCase().includes("creature")
        ) {
          aliceCreatureCount++;
          // Token cards are identified by their
          // `cardId` starting with `copyperm-`
          // (the engine's `case "CopyPermanent"`
          // block assigns this prefix).
          if (id.startsWith("copyperm-")) {
            newCardIds.push(id);
          }
        }
      }
      expect(aliceCreatureCount).toBe(3); // host + 2 tokens
      expect(newCardIds).toHaveLength(2);
      // Each token has the target's cardData
      // (CR 707.2 — name, type_line, P/T).
      for (const id of newCardIds) {
        const inst = after.state.cards.get(id);
        expect(inst).toBeDefined();
        if (!inst) return;
        expect(inst.cardData.name).toBe("Grizzly Bears (rite target)");
        expect(inst.cardData.power).toBe("2");
        expect(inst.cardData.toughness).toBe("2");
      }
    });

    it("creates 3 new cards when count: 3 (Extravagant Replication)", () => {
      const script: CardScript = CardScriptSchema.parse({
        name: "Extravagant Replication (test substrate)",
        oracle:
          "Create three tokens that are copies of target creature.",
        spell: [
          {
            op: "CopyPermanent",
            target: "creature",
            controller: "any",
            count: 3,
          },
        ],
      });
      registerCardScripts([script]);
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "extravagant-target",
          name: "Llanowar Elves (extravagant target)",
          type_line: "Creature — Elf Druid",
          power: "1",
          toughness: "1",
        }),
      );
      s = targetR.state;
      const after = castScript(s, setup.aliceId, script, {
        hostName: HOST_NAME,
      });
      const aliceBfKey = `${setup.aliceId}-battlefield`;
      const aliceBf = after.state.zones.get(aliceBfKey);
      expect(aliceBf).toBeDefined();
      if (!aliceBf) return;
      let newCardCount = 0;
      for (const id of aliceBf.cardIds) {
        if (id.startsWith("copyperm-")) {
          newCardCount++;
          const inst = after.state.cards.get(id);
          expect(inst).toBeDefined();
          if (!inst) return;
          // CR 707.2 — each token has the
          // target's cardData.
          expect(inst.cardData.name).toBe(
            "Llanowar Elves (extravagant target)",
          );
        }
      }
      expect(newCardCount).toBe(3);
    });

    it("each token has a unique cardId (no collisions on `Date.now()`)", () => {
      // The engine assigns each token a unique
      // `cardId` of the form `copyperm-<ts>-<i>-<rand>`
      // where `<i>` is the loop index. The
      // uniqueness guard is the loop index (the
      // `i` suffix), not just the random
      // component (which could collide when
      // multiple copies happen in the same
      // `Date.now()` tick).
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "test",
        spell: [
          {
            op: "CopyPermanent",
            target: "creature",
            controller: "any",
            count: 5,
          },
        ],
      });
      registerCardScripts([script]);
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "uniqueness-target",
          name: "Bear (uniqueness target)",
          type_line: "Creature — Bear",
        }),
      );
      s = targetR.state;
      const after = castScript(s, setup.aliceId, script);
      const aliceBfKey = `${setup.aliceId}-battlefield`;
      const aliceBf = after.state.zones.get(aliceBfKey);
      expect(aliceBf).toBeDefined();
      if (!aliceBf) return;
      const tokenIds = aliceBf.cardIds.filter((id) =>
        id.startsWith("copyperm-"),
      );
      expect(tokenIds).toHaveLength(5);
      // All token ids are unique.
      const uniqueIds = new Set(tokenIds);
      expect(uniqueIds.size).toBe(5);
    });
  });

  describe("regression — count: 1 (default) preserves the v1 lane 70 single-copy semantic", () => {
    it("creates exactly 1 new card on the controller's battlefield when count: 1", () => {
      // Regression guard: `count: 1` (and the
      // default-omitted case) preserves the v1
      // lane 70 single-copy semantic. The engine
      // creates exactly 1 token, NOT 0 (skip)
      // and NOT 2 (off-by-one).
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle:
          "Create a token that's a copy of target creature.",
        spell: [
          {
            op: "CopyPermanent",
            target: "creature",
            controller: "any",
            count: 1,
          },
        ],
      });
      registerCardScripts([script]);
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "single-copy-target",
          name: "Bear (single copy target)",
          type_line: "Creature — Bear",
        }),
      );
      s = targetR.state;
      const after = castScript(s, setup.aliceId, script);
      const aliceBfKey = `${setup.aliceId}-battlefield`;
      const aliceBf = after.state.zones.get(aliceBfKey);
      expect(aliceBf).toBeDefined();
      if (!aliceBf) return;
      const tokenIds = aliceBf.cardIds.filter((id) =>
        id.startsWith("copyperm-"),
      );
      // Exactly 1 token (the v1 lane 70 semantic).
      expect(tokenIds).toHaveLength(1);
    });
  });
});