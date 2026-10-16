/**
 * Wave 4.8 follow-up 29 priority 2 (lane 28, piece
 * 3/4) (#2614 follow-up):
 * `CopyPermanent.target` `kind: "named_card"`
 * engine consult.
 *
 * Piece 2/4 added the `kind: "named_card"` schema
 * arm as a STUB (parses, no engine consult — the
 * named-card arm fell through to a no-op). Piece
 * 3/4 lands the engine consult: the named-card
 * variant reads
 * `getCardDataByName(value.name)` and creates
 * `count` tokens with the named card's printed
 * `cardData`. The named card is NOT required to be
 * on the battlefield (parallel to the lane 75b
 * `become_copy.named_card` shape). Missing name is
 * a no-op (the source's existing copy-token
 * consult never fires).
 *
 * Three test groups:
 *   1. engine — `kind: "named_card"` resolves
 *      `getCardDataByName(value.name)` and
 *      creates `count` tokens with the named
 *      card's printed `cardData`.
 *   2. engine — `count` field works with the
 *      named-card arm; missing name is a no-op;
 *      case-insensitive name resolution.
 *   3. regression — the `kind: "named_card"`
 *      arm is no longer a stub (the engine
 *      creates tokens when the named card is
 *      in the registry).
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
  registerCardDataForTests,
  resetCardDataForTests,
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
  "Test Copy Permanent Named Card (lane 28 piece 3/4)";

function makeCard(
  overrides: Partial<ScryfallCard> & { id: string; name: string },
): ScryfallCard {
  return {
    id: `mock-${overrides.id}`,
    name: overrides.name,
    type_line: overrides.type_line ?? "Creature — Shapeshifter",
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost ?? "{2}{G}",
    cmc: overrides.cmc ?? 3,
    colors: overrides.colors ?? ["G"],
    color_identity: overrides.color_identity ?? ["G"],
    keywords: overrides.keywords ?? [],
    power: overrides.power ?? "2",
    toughness: overrides.toughness ?? "2",
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
    green: 4 + (options.extraMana ?? 0),
  });
  const cast = castSpell(s, aliceId, cardId);
  if (!cast.success) throw new Error(`cast failed: ${cast.error}`);
  return { state: resolveTopOfStack(cast.state) };
}

describe("Wave 4.8 follow-up 29 priority 2 piece 3/4 — CopyPermanent.kind: 'named_card' consult", () => {
  beforeAll(() => {
    resetCardScriptsForTests();
    resetCardDataForTests();
  });

  afterAll(() => {
    resetCardScriptsForTests();
    resetCardDataForTests();
  });

  beforeEach(() => {
    resetCardScriptsForTests();
    resetCardDataForTests();
  });

  describe("engine — kind: 'named_card' resolves getCardDataByName", () => {
    it("creates a single token with the named card's printed cardData (Self-Reflection)", () => {
      // Register a synthetic cardData for
      // "Self-Reflection bear". Cast a
      // CopyPermanent spell with `kind:
      // "named_card"` and `value.name:
      // "Self-Reflection bear"`. The engine
      // reads the named card's printed
      // `cardData` from the registry and
      // creates a single token on Alice's
      // battlefield (count: 1 default).
      const namedCard = makeCard({
        id: "self-reflection-bear",
        name: "Self-Reflection bear",
        type_line: "Creature — Bear",
        power: "2",
        toughness: "2",
      });
      registerCardDataForTests([namedCard]);
      const setup = setupTwoPlayerGame();
      const s = setup.state;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "Create a token that's a copy of named card.",
        spell: [
          {
            op: "CopyPermanent",
            target: {
              kind: "named_card",
              value: { name: "Self-Reflection bear" },
            },
            controller: "any",
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
      // The single token has the named
      // card's printed `cardData` (CR 707.2
      // "all characteristics copied"
      // semantics).
      expect(tokenInst.cardData.name).toBe("Self-Reflection bear");
      expect(tokenInst.cardData.power).toBe("2");
      expect(tokenInst.cardData.toughness).toBe("2");
      expect(tokenInst.cardData.type_line).toBe("Creature — Bear");
    });

    it("creates 2 tokens with the named card's printed cardData when count: 2", () => {
      const namedCard = makeCard({
        id: "named-count-2-bear",
        name: "Named Count 2 Bear",
        type_line: "Creature — Bear",
      });
      registerCardDataForTests([namedCard]);
      const setup = setupTwoPlayerGame();
      const s = setup.state;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "Create two tokens.",
        spell: [
          {
            op: "CopyPermanent",
            target: {
              kind: "named_card",
              value: { name: "Named Count 2 Bear" },
            },
            controller: "any",
            count: 2,
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
        expect(inst.cardData.name).toBe("Named Count 2 Bear");
      }
    });

    it("no-op when the named card is missing from the registry (missing name is a no-op)", () => {
      // Empty `registerCardDataForTests` — the
      // named card is not in the registry. The
      // engine returns state unchanged.
      registerCardDataForTests([]);
      const setup = setupTwoPlayerGame();
      const s = setup.state;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "Create a copy of a missing named card.",
        spell: [
          {
            op: "CopyPermanent",
            target: {
              kind: "named_card",
              value: { name: "Missing Named Card" },
            },
            controller: "any",
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
      // No tokens — the named card is
      // missing.
      expect(tokenIds).toHaveLength(0);
    });

    it("resolves the named card case-insensitively (parallel to the lane 75b pattern)", () => {
      // `getCardDataByName` normalises the
      // requested name. Register a card with
      // mixed-case name; cast with lowercase
      // variant — the lookup hits.
      const namedCard = makeCard({
        id: "case-bear",
        name: "Case-Insensitive Bear",
        type_line: "Creature — Bear",
      });
      registerCardDataForTests([namedCard]);
      const setup = setupTwoPlayerGame();
      const s = setup.state;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "Create a token (lowercase name).",
        spell: [
          {
            op: "CopyPermanent",
            target: {
              kind: "named_card",
              value: { name: "case-insensitive bear" },
            },
            controller: "any",
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
      expect(tokenInst.cardData.name).toBe("Case-Insensitive Bear");
    });
  });

  describe("regression — kind: 'named_card' is no longer a stub", () => {
    it("creates tokens when the named card IS in the registry (piece 2/4 stub is inert)", () => {
      // Regression guard: piece 2/4's
      // `kind: "named_card"` arm was a STUB
      // (no tokens created). Piece 3/4 lands
      // the engine consult — the named-card
      // arm now creates tokens when the
      // named card is in the registry.
      const namedCard = makeCard({
        id: "regression-bear",
        name: "Regression Bear",
        type_line: "Creature — Bear",
      });
      registerCardDataForTests([namedCard]);
      const setup = setupTwoPlayerGame();
      const s = setup.state;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "Create a token.",
        spell: [
          {
            op: "CopyPermanent",
            target: {
              kind: "named_card",
              value: { name: "Regression Bear" },
            },
            controller: "any",
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
      // Piece 3/4 — the engine creates
      // tokens (no longer inert).
      expect(tokenIds.length).toBeGreaterThan(0);
    });
  });
});