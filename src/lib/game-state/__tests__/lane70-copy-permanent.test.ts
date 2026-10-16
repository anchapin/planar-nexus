/**
 * Wave 4.8 follow-up 5 lane 70 — Copying a permanent
 * (#2614 follow-up).
 *
 * The drafter list (#2614) flags a long tail of recent cards
 * that copy a permanent on the battlefield: Clone, Phantasmal
 * Image, Vesuvan Doppelganger, Sakashima's Will, the
 * "Phyrexian Metamorph" pattern. The v1 minimum adds a
 * `CopyPermanentSchema` (a new op on `EffectSchema`) that
 * creates a new permanent whose characteristics are copied
 * from a target permanent on the battlefield.
 *
 * Schema (card-scripts/schema.ts, EffectSchema):
 *   `CopyPermanentSchema = { op: "CopyPermanent", target:
 *    "permanent" | "creature" | "artifact" | "enchantment" |
 *    "land", controller?: "you" | "opponent" | "any" }` —
 *    v1 minimum is a single target of any kind. Narrower
 *    filters (named-copy, "until end of turn" copy,
 *    Splice-style spell-on-stack copy, etc.) are follow-up
 *    lanes.
 *
 * Engine (card-scripts/interpret.ts#applyEffect):
 *   `case "CopyPermanent"` validates the target is on the
 *   battlefield and (optionally) matches the `controller`
 *   and `target` type filter, then creates a new
 *   `CardInstance` with the source's `cardData` (shallow
 *   copy of name, mana cost, type line, P/T, keywords,
 *   oracle text, colors). The new permanent enters the
 *   battlefield under the spell's controller; the target is
 *   unchanged. v1 supports "all characteristics copied"
 *   semantics (CR 707.2).
 *
 * Test harness pattern: synthetic card script registered via
 * `CardScriptSchema.parse + registerCardScripts` (the lane 49
 * /52/55/59/60/62/63/64/65/66/67/68/69 pattern). The test
 * casts the spell via the engine's `castSpell` + resolution
 * pipeline and inspects the controller's battlefield for the
 * copied permanent.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
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

const HOST_NAME = "Test Copy Permanent (lane 70)";

const COPY_PERMANENT_EFFECT: CardEffect = {
  op: "CopyPermanent",
  target: { kind: "filter", value: "permanent" },
  controller: "any",
};

const SCRIPT: CardScript = CardScriptSchema.parse({
  name: HOST_NAME,
  oracle:
    "You may have Clone enter the battlefield as a copy of any permanent on the battlefield.",
  spell: [COPY_PERMANENT_EFFECT],
});

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
 * Adds a card directly to the named player's battlefield.
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
  // Mark as having entered previously so the copy doesn't
  // suffer from summoning sickness on the source's
  // controller's next turn (the new copy WILL have
  // summoning sickness; this is just about the source).
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
 * Adds a card to Alice's hand and casts it as the spell.
 */
function castScript(
  state: GameState,
  aliceId: PlayerId,
): { state: GameState } {
  const cardDef = makeCard({ id: "host" });
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
  s = addMana(s, aliceId, { blue: 4 });
  const cast = castSpell(s, aliceId, cardId);
  if (!cast.success) throw new Error(`cast failed: ${cast.error}`);
  // The spell lands on the stack; resolveTopOfStack consumes
  // it and runs the script effects. For the lane 70
  // test, the host script has only ONE effect, so the
  // cast path's target slotting means the script's single
  // CopyPermanent effect consumes no targets on its own
  // (target: "permanent" is a controlled-by-engine filter,
  // not a chosen target). The engine still wires a
  // best-effort default: the first permanent on the
  // battlefield the controller owns.
  return { state: resolveTopOfStack(cast.state) };
}

describe("Wave 4.8 follow-up 5 lane 70 — copying a permanent", () => {
  beforeAll(() => {
    resetCardScriptsForTests();
    registerCardScripts([SCRIPT]);
  });

  afterAll(() => {
    resetCardScriptsForTests();
  });

  it("rejects a script with an unknown CopyPermanent target enum", () => {
    // Schema guard: target must be one of the v1 enum values.
    expect(() =>
      CardScriptSchema.parse({
        name: "Bad Copy Permanent target (lane 70)",
        oracle: "test",
        spell: [{ op: "CopyPermanent", target: "bad_value" }],
      }),
    ).toThrow();
  });

  it("rejects a script with an unknown CopyPermanent controller enum", () => {
    // Schema guard: controller must be one of the v1 enum values.
    expect(() =>
      CardScriptSchema.parse({
        name: "Bad Copy Permanent controller (lane 70)",
        oracle: "test",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "permanent" },
            controller: "everyone",
          },
        ],
      }),
    ).toThrow();
  });

  it("accepts the v1 CopyPermanent schema (target: permanent, controller: any)", () => {
    // Sanity check: the script parses and the effect has the
    // expected shape.
    const parsed = CardScriptSchema.parse(SCRIPT);
    expect(parsed.spell?.[0]?.op).toBe("CopyPermanent");
    expect(parsed.spell?.[0]).toMatchObject({
      op: "CopyPermanent",
      target: { kind: "filter", value: "permanent" },
      controller: "any",
    });
  });

  it("creates a new permanent copying the name, types, and P/T of a target", () => {
    // Source: a 2/2 Grizzly Bears on Bob's battlefield. The
    // spell (cast by Alice) should add a NEW permanent to
    // Alice's battlefield whose cardData matches the source's
    // (name, type_line, power, toughness).
    const { state, aliceId, bobId } = setupTwoPlayerGame();
    const sourceCardDef: ScryfallCard = {
      id: "mock-grizzly-bears",
      name: "Grizzly Bears",
      type_line: "Creature — Bear",
      oracle_text: "",
      mana_cost: "{1}{G}",
      cmc: 2,
      colors: ["G"],
      color_identity: ["G"],
      keywords: [],
      power: "2",
      toughness: "2",
      legalities: { standard: "legal" },
      layout: "normal",
    } as ScryfallCard;
    const { state: withSource, cardId: sourceId } = putOnBattlefield(
      state,
      bobId,
      sourceCardDef,
    );

    const result = castScript(withSource, aliceId);

    // The new permanent is on Alice's battlefield. It
    // should have a cardData that matches the source.
    const aliceBattlefield =
      result.state.zones.get(`${aliceId}-battlefield`);
    expect(aliceBattlefield).toBeDefined();
    const newIds = (aliceBattlefield?.cardIds ?? []).filter(
      (id) => id !== sourceId,
    );
    expect(newIds.length).toBeGreaterThanOrEqual(1);
    const copyId = newIds[0];
    const copyInst = result.state.cards.get(copyId);
    expect(copyInst).toBeDefined();
    expect(copyInst?.cardData.name).toBe("Grizzly Bears");
    expect(copyInst?.cardData.type_line).toBe("Creature — Bear");
    expect(copyInst?.cardData.power).toBe("2");
    expect(copyInst?.cardData.toughness).toBe("2");
    expect(copyInst?.controllerId).toBe(aliceId);
    expect(copyInst?.ownerId).toBe(aliceId);
  });
});