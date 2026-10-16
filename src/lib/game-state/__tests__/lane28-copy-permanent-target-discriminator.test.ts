/**
 * Wave 4.8 follow-up 29 priority 1 (lane 28, piece
 * 2/4) (#2614 follow-up):
 * `CopyPermanent.target` discriminator — the
 * `target` field is restructured from a flat enum
 * (`"permanent" | "creature" | "artifact" |
 * "enchantment" | "land"`) to a discriminated
 * union with three arms:
 *   - `{ kind: "filter", value: <enum> }` — the
 *     existing v1 minimum (the engine auto-picks
 *     the first matching permanent APNAP).
 *   - `{ kind: "id", value: <CardInstanceId> }`
 *     — the explicit named target on the
 *     battlefield (the engine reads the named
 *     target's `cardData` directly without the
 *     filter consult; the controller filter is
 *     still applied; a missing target is a no-op
 *     per the lane 70 substrate's auto-pick
 *     fallback).
 *   - `{ kind: "named_card", value: { name:
 *     <string> } }` — the named-card variant
 *     (STUB in piece 2/4 — schema parses, engine
 *     consult lands in piece 3/4).
 *
 * Three test groups:
 *   1. schema — the `target` field accepts all
 *      three discriminator shapes; rejects
 *      unknown `kind` values.
 *   2. engine — `kind: "id"` resolves the named
 *      target directly; the `count` field works
 *      with the discriminator; the named-card
 *      stub is inert (a no-op).
 *   3. regression — the `kind: "filter"` arm
 *      preserves the v1 lane 70 single-target
 *      auto-pick semantic (no regression on the
 *      existing substrate).
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
  "Test Copy Permanent Target Discriminator (lane 28 piece 2/4)";

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

describe("Wave 4.8 follow-up 29 priority 1 piece 2/4 — CopyPermanent.target discriminator", () => {
  beforeAll(() => {
    resetCardScriptsForTests();
  });

  afterAll(() => {
    resetCardScriptsForTests();
  });

  beforeEach(() => {
    resetCardScriptsForTests();
  });

  describe("schema — CopyPermanent.target accepts the discriminator union", () => {
    it("accepts the kind: 'filter' arm (the existing v1 enum filter)", () => {
      const parsed = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "test",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
            controller: "any",
            count: 1,
          },
        ],
      });
      const eff = parsed.spell![0] as CardEffect;
      expect(eff.target).toEqual({ kind: "filter", value: "creature" });
    });

    it("accepts the kind: 'id' arm (the explicit named target on the battlefield)", () => {
      const parsed = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "test",
        spell: [
          {
            op: "CopyPermanent",
            target: {
              kind: "id",
              value: "card-some-source-on-battlefield",
            },
            controller: "any",
            count: 1,
          },
        ],
      });
      const eff = parsed.spell![0] as CardEffect;
      expect(eff.target).toEqual({
        kind: "id",
        value: "card-some-source-on-battlefield",
      });
    });

    it("accepts the kind: 'named_card' arm (the stub for piece 3/4)", () => {
      // The named-card arm is a STUB in piece
      // 2/4 (parses, no engine consult — the
      // engine consult lands in piece 3/4). The
      // schema union accepts all three arms so
      // the discriminator is in place when
      // piece 3/4 lands.
      const parsed = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "test",
        spell: [
          {
            op: "CopyPermanent",
            target: {
              kind: "named_card",
              value: { name: "Grizzly Bears" },
            },
            controller: "any",
            count: 1,
          },
        ],
      });
      const eff = parsed.spell![0] as CardEffect;
      expect(eff.target).toEqual({
        kind: "named_card",
        value: { name: "Grizzly Bears" },
      });
    });

    it("rejects an unknown kind value (the discriminator rejects non-enum `kind`s)", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: HOST_NAME,
          oracle: "test",
          spell: [
            {
              op: "CopyPermanent",
              target: {
                kind: "garbage",
                value: "anything",
              },
              controller: "any",
            },
          ],
        }),
      ).toThrow();
    });

    it("rejects the kind: 'filter' arm with an unknown enum value", () => {
      // The `filter` arm's `value` is the legacy
      // enum — a bad enum value is rejected by
      // the union's `z.enum(...)` validator.
      expect(() =>
        CardScriptSchema.parse({
          name: HOST_NAME,
          oracle: "test",
          spell: [
            {
              op: "CopyPermanent",
              target: {
                kind: "filter",
                value: "bad_value",
              },
              controller: "any",
            },
          ],
        }),
      ).toThrow();
    });

    it("rejects the kind: 'id' arm with an empty string value", () => {
      // `z.string().min(1)` rejects the empty
      // string (a `CardInstanceId` must be
      // non-empty).
      expect(() =>
        CardScriptSchema.parse({
          name: HOST_NAME,
          oracle: "test",
          spell: [
            {
              op: "CopyPermanent",
              target: {
                kind: "id",
                value: "",
              },
              controller: "any",
            },
          ],
        }),
      ).toThrow();
    });

    it("rejects the kind: 'named_card' arm with an empty name", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: HOST_NAME,
          oracle: "test",
          spell: [
            {
              op: "CopyPermanent",
              target: {
                kind: "named_card",
                value: { name: "" },
              },
              controller: "any",
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe("engine — kind: 'id' resolves the named target directly", () => {
    it("creates a copy of the named target (kind: 'id') on the controller's battlefield", () => {
      // Place a Bear on Bob's battlefield;
      // register a CopyPermanent spell with
      // `target: { kind: "id", value: <bear
      // id> }`. Cast as Alice; the engine reads
      // the bear's `cardData` directly from
      // `state.cards.get(value)` and creates a
      // single token (count: 1 default).
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "disc-id-target",
          name: "Grizzly Bears (disc id target)",
          type_line: "Creature — Bear",
          power: "2",
          toughness: "2",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle:
          "Create a token that's a copy of target creature (named target).",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
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
      // The single token has the named
      // source's cardData (CR 707.2 "all
      // characteristics copied" semantics).
      const tokenInst = after.state.cards.get(tokenIds[0]);
      expect(tokenInst).toBeDefined();
      if (!tokenInst) return;
      expect(tokenInst.cardData.name).toBe(
        "Grizzly Bears (disc id target)",
      );
      expect(tokenInst.cardData.power).toBe("2");
      expect(tokenInst.cardData.toughness).toBe("2");
    });

    it("creates 2 copies of the named target when count: 2 + kind: 'id'", () => {
      // Verifies the count field works with
      // the discriminator — the lane 28 piece
      // 1/4 count field is preserved on the
      // new kind: 'id' arm.
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "disc-id-target-count",
          name: "Llanowar Elves (disc id target count)",
          type_line: "Creature — Elf Druid",
          power: "1",
          toughness: "1",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "Create two copies.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
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
    });

    it("no-op when kind: 'id' references a missing target (no error, no token created)", () => {
      // Lane 70 substrate's auto-pick fallback:
      // a missing target is a no-op. The
      // engine validates the target is on the
      // battlefield; a missing target returns
      // the state unchanged.
      const setup = setupTwoPlayerGame();
      const s = setup.state;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "Create a copy of a missing target.",
        spell: [
          {
            op: "CopyPermanent",
            target: {
              kind: "id",
              value: "card-not-on-battlefield",
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
      // No tokens created (the named target is
      // missing).
      const tokenIds = aliceBf.cardIds.filter((id) =>
        id.startsWith("copyperm-"),
      );
      expect(tokenIds).toHaveLength(0);
    });

    it("filters by controller: 'you' when the named target is on the opponent's battlefield", () => {
      // The `controller: "you"` filter
      // applies to the named target — a
      // named target on Bob's battlefield is
      // filtered out when the spell's
      // controller is Alice.
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "disc-id-controller-target",
          name: "Bear (controller filter test)",
          type_line: "Creature — Bear",
        }),
      );
      s = targetR.state;
      const namedTargetId = targetR.cardId;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "Create a copy of target creature you control.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "id", value: namedTargetId },
            controller: "you",
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
      // No tokens — the named target is on
      // Bob's battlefield, not Alice's.
      expect(tokenIds).toHaveLength(0);
    });

    it("named-card stub is inert in piece 2/4 (no token created — piece 3/4 lands the consult)", () => {
      // The kind: 'named_card' arm is a STUB
      // in piece 2/4 — the schema union has
      // all three arms; the engine consults
      // two (filter + id) in piece 2/4.
      // Verifies the named-card arm is inert
      // until piece 3/4.
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
              value: { name: "Grizzly Bears" },
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
      // No tokens — the named-card stub is
      // intentionally inert until piece 3/4
      // lands the engine consult.
      expect(tokenIds).toHaveLength(0);
    });
  });

  describe("regression — kind: 'filter' preserves the v1 lane 70 auto-pick semantic", () => {
    it("auto-picks the first matching permanent APNAP-ordered when kind: 'filter'", () => {
      // Regression guard: the kind: 'filter'
      // arm preserves the v1 lane 70
      // auto-pick semantic (the existing
      // substrate). The engine finds the
      // first matching permanent on the
      // battlefield (APNAP-ordered).
      const setup = setupTwoPlayerGame();
      let s = setup.state;
      const targetR = putOnBattlefield(
        s,
        setup.bobId,
        makeCard({
          id: "disc-filter-target",
          name: "Bear (disc filter target)",
          type_line: "Creature — Bear",
          power: "2",
          toughness: "2",
        }),
      );
      s = targetR.state;
      const script: CardScript = CardScriptSchema.parse({
        name: HOST_NAME,
        oracle: "Create a copy of target creature.",
        spell: [
          {
            op: "CopyPermanent",
            target: { kind: "filter", value: "creature" },
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
      expect(tokenInst.cardData.name).toBe("Bear (disc filter target)");
    });
  });
});