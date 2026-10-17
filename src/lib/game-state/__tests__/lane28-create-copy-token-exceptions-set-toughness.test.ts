/**
 * Wave 4.8 follow-up 32 priority 1 (lane 28,
 * piece 1/N) — CopyPermanent
 * `exceptions.set_toughness` destructive
 * REPLACE arm.
 *
 * Mirrors `lane28-create-copy-token-exceptions-set-power.test.ts`
 * (priority 3 of follow-up 31 — destructive
 * P-power side). The `set_toughness` arm is the
 * toughness-side complement — each arm consumes
 * its own half of the printed P/T independently.
 * See `docs/card-scripts/wave4.8-followup32-handoff.md`
 * priority 1.
 */
import { describe, it, expect, afterAll, beforeEach } from "@jest/globals";
import { CardScriptSchema, type CardEffect } from "../card-scripts/schema";
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
  "Test Copy Permanent Exceptions Set Toughness (follow-up 32 priority 1)";
const TARGET_NAME = "Test Set Toughness Target Bear";

function makeCard(
  overrides: Partial<ScryfallCard> & { id: string; name: string },
): ScryfallCard {
  return {
    id: `mock-${overrides.id}`,
    name: overrides.name,
    type_line: "Creature — Bear",
    oracle_text: "Test target bear for set_toughness exception",
    mana_cost: overrides.mana_cost ?? "{3}{U}",
    cmc: 4,
    colors: overrides.colors ?? ["U"],
    color_identity: overrides.color_identity ?? ["U"],
    keywords: [],
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

function castScript(
  state: GameState,
  aliceId: PlayerId,
  script: { name: string; oracle: string; spell: unknown[] },
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

describe("Wave 4.8 follow-up 32 priority 1 — CopyPermanent.exceptions.set_toughness arm", () => {
  afterAll(() => {
    resetCardScriptsForTests();
  });

  beforeEach(() => {
    resetCardScriptsForTests();
  });

  describe("schema — CopyPermanent.exceptions.set_toughness parses an integer", () => {
    it("accepts the set_toughness sub-arm with a positive integer", () => {
      const parsed = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "test",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            exceptions: { set_toughness: 5 },
          },
        ],
      });
      const eff = parsed.spell![0] as CardEffect & {
        exceptions?: { set_toughness?: number };
      };
      expect(eff.exceptions).toEqual({ set_toughness: 5 });
    });

    it('accepts a negative integer (Phyrexian Metamorph-style "it has 0/-1")', () => {
      const parsed = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "test",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            exceptions: { set_toughness: -1 },
          },
        ],
      });
      const eff = parsed.spell![0] as CardEffect & {
        exceptions?: { set_toughness?: number };
      };
      expect(eff.exceptions).toEqual({ set_toughness: -1 });
    });

    it("rejects a non-integer value (the Zod layer enforces .int())", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: HOST_NAME,
          oracle: "test",
          spell: [
            {
              op: "CopyPermanent",
              target: { kind: "filter", value: "creature" },
              controller: "any",
              exceptions: { set_toughness: 2.5 },
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe("engine — set_toughness REPLACES `cardData.toughness` and wins over add_toughness", () => {
    it("REPLACES the printed toughness with `String(set_toughness)`", () => {
      const { state, aliceId, bobId } = setupTwoPlayerGame();
      // Target: a Bear with printed 2/2 on Bob's
      // battlefield. The host copies it with
      // `set_toughness: 5`. Final token: 2/5.
      const targetCard = makeCard({
        id: TARGET_NAME,
        name: TARGET_NAME,
      });
      const withTarget = putOnBattlefield(state, bobId, targetCard);

      const result = castScript(withTarget.state, aliceId, {
        name: HOST_NAME,
        oracle: "test",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            exceptions: { set_toughness: 5 },
          },
        ],
      });

      const aliceBf = result.state.zones.get(`${aliceId}-battlefield`);
      expect(aliceBf).toBeDefined();
      // The copy token is on Alice's battlefield
      // with the rebuilt toughness. The HOST spell
      // (the source of the CopyPermanent effect) is
      // stamped under a `card-host-${random}` id and
      // shares the HOST_NAME `cardData.name` — so we
      // filter the HOST card out by `cardData.name`
      // (the legacy `card-host-${HOST_NAME.replace}``
      // string filter in earlier pieces never matched
      // the live id because the engine appends a
      // random suffix after `card-host-`).
      const copyCardIds = (aliceBf?.cardIds ?? []).filter((id) => {
        const card = result.state.cards.get(id);
        return card?.cardData.name !== HOST_NAME;
      });
      expect(copyCardIds.length).toBeGreaterThan(0);
      const tokenId = copyCardIds[copyCardIds.length - 1];
      const token = result.state.cards.get(tokenId);
      expect(token).toBeDefined();
      expect(token!.cardData.toughness).toBe("5");
      // Power untouched (cross-arm independence).
      expect(token!.cardData.power).toBe("2");
    });

    it("PRECEDENCE — `set_toughness` wins over `add_toughness` when both are set", () => {
      const { state, aliceId, bobId } = setupTwoPlayerGame();
      const targetCard = makeCard({
        id: TARGET_NAME,
        name: TARGET_NAME,
      });
      const withTarget = putOnBattlefield(state, bobId, targetCard);

      // Printed toughness 2; `add_toughness: 3`
      // would yield 5; `set_toughness: 9` REPLACES
      // the printed toughness, so final = 9.
      const result = castScript(withTarget.state, aliceId, {
        name: HOST_NAME,
        oracle: "test",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            exceptions: { set_toughness: 9, add_toughness: 3 },
          },
        ],
      });

      const aliceBf = result.state.zones.get(`${aliceId}-battlefield`);
      const copyCardIds = (aliceBf?.cardIds ?? []).filter((id) => {
        const card = result.state.cards.get(id);
        return card?.cardData.name !== HOST_NAME;
      });
      const tokenId = copyCardIds[copyCardIds.length - 1];
      const token = result.state.cards.get(tokenId);
      expect(token!.cardData.toughness).toBe("9");
    });

    it("parallel co-arm — set_power + set_toughness REPLACE both halves of P/T independently", () => {
      const { state, aliceId, bobId } = setupTwoPlayerGame();
      const targetCard = makeCard({
        id: TARGET_NAME,
        name: TARGET_NAME,
      });
      const withTarget = putOnBattlefield(state, bobId, targetCard);

      const result = castScript(withTarget.state, aliceId, {
        name: HOST_NAME,
        oracle: "test",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            exceptions: { set_power: 7, set_toughness: 8 },
          },
        ],
      });

      const aliceBf = result.state.zones.get(`${aliceId}-battlefield`);
      const copyCardIds = (aliceBf?.cardIds ?? []).filter((id) => {
        const card = result.state.cards.get(id);
        return card?.cardData.name !== HOST_NAME;
      });
      const tokenId = copyCardIds[copyCardIds.length - 1];
      const token = result.state.cards.get(tokenId);
      expect(token!.cardData.power).toBe("7");
      expect(token!.cardData.toughness).toBe("8");
    });
  });
});
