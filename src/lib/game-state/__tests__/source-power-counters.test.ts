/**
 * "Put X counters on self, where X is its power" tests
 * (#2594 follow-up, lane 23)
 *
 * The drafter has 1 FDN card wanting this — Heroes' Bane (FDN #639,
 * "{2}{G}: Put X +1/+1 counters on Heroes' Bane, where X is its
 * power."). The lane adds an optional `use_source_power: true`
 * field to `PutCountersSchema` (parallel to `Pump.double_power`),
 * and the engine resolves `amount` to the source's effective power
 * at apply-time (`getEffectivePower(source)`).
 *
 * Only valid with `counter: "+1/+1"` and `target: "self"` (lane 23's
 * v1 limitation): the pattern is "put N counters on yourself, where
 * N is your power". Re-activating Heroes' Bane reads its current
 * (post-layer) power, so the +1/+1 counters compound.
 */
import { describe, it, expect, afterAll, beforeAll } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInitialGameState, startGame } from "../game-state";
import { resolveScriptedAbility } from "../card-scripts/interpret";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
  StackObject,
} from "../types";
import { RAW_CARD_SCRIPTS } from "../card-scripts/cards/index.generated";
import {
  registerCardScripts,
  resetCardScriptsForTests,
} from "../card-scripts/registry";
import { CardScriptSchema } from "../card-scripts/schema";

function makeCard(overrides: Partial<ScryfallCard> & { id: string }): ScryfallCard {
  return {
    id: `mock-${overrides.id}`,
    name: overrides.name ?? "Test Card",
    type_line: overrides.type_line ?? "Creature — Hydra",
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost ?? "",
    cmc: overrides.cmc ?? 0,
    colors: overrides.colors ?? [],
    color_identity: overrides.color_identity ?? [],
    keywords: overrides.keywords ?? [],
    legalities: overrides.legalities ?? { standard: "legal" },
    layout: overrides.layout ?? "normal",
    power: overrides.power,
    toughness: overrides.toughness,
  } as ScryfallCard;
}

interface PlaceOpts {
  card: ScryfallCard;
  controller: PlayerId;
  owner: PlayerId;
  zone: "graveyard" | "hand" | "battlefield";
  cardId: CardInstanceId;
}

function placeOnBattlefield(state: GameState, opts: PlaceOpts): GameState {
  const zoneKey = `${opts.owner}-${opts.zone}`;
  const cards = new Map(state.cards);
  const zones = new Map(state.zones);
  const existing = zones.get(zoneKey)!;
  const inst = {
    id: opts.cardId,
    cardData: opts.card,
    ownerId: opts.owner,
    controllerId: opts.controller,
    currentZoneKey: zoneKey,
    tapped: false,
    counters: new Map(),
    damage: 0,
    summoningSickness: false,
  } as never;
  cards.set(opts.cardId, inst);
  zones.set(zoneKey, {
    ...existing,
    cardIds: [...existing.cardIds, opts.cardId],
  });
  return { ...state, cards, zones };
}

describe("use_source_power on PutCounters (#2594 follow-up, lane 23)", () => {
  let state: GameState;
  let p1: PlayerId;

  beforeAll(() => {
    // Heroes' Bane is part of RAW_CARD_SCRIPTS (added by the lane).
    registerCardScripts(RAW_CARD_SCRIPTS);
  });
  afterAll(() => {
    resetCardScriptsForTests();
    registerCardScripts(RAW_CARD_SCRIPTS);
  });

  // Standard 2-player setup, p1 active in precombat main.
  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1] = Array.from(state.players.keys());
    state.turn.activePlayerId = p1;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
  });

  it("Heroes' Bane fixture declares PutCounters.use_source_power: true on self", () => {
    const cardsDir = join(__dirname, "..", "card-scripts", "cards");
    const fixture = JSON.parse(
      readFileSync(join(cardsDir, "heroes_bane.json"), "utf8"),
    ) as {
      name: string;
      activated: {
        text: string;
        effects: {
          op: string;
          counter: string;
          target: string;
          use_source_power?: boolean;
          amount: number | string;
        }[];
      }[];
    };
    expect(fixture.name).toBe("Heroes' Bane");
    expect(fixture.activated).toHaveLength(1);
    const eff = fixture.activated[0].effects[0];
    expect(eff.op).toBe("PutCounters");
    expect(eff.counter).toBe("+1/+1");
    expect(eff.target).toBe("self");
    expect(eff.use_source_power).toBe(true);
  });

  it("schema accepts use_source_power: true with counter '+1/+1' and target 'self'", () => {
    const ok = CardScriptSchema.safeParse({
      name: "X",
      oracle: "x",
      activated: [
        {
          text: "t",
          cost: { mana: "{G}" },
          effects: [
            {
              op: "PutCounters",
              counter: "+1/+1",
              target: "self",
              use_source_power: true,
            },
          ],
        },
      ],
    });
    expect(ok.success).toBe(true);
  });

  it("schema rejects use_source_power with counter 'quest' (lane 23 v1 limitation)", () => {
    const bad = CardScriptSchema.safeParse({
      name: "X",
      oracle: "x",
      activated: [
        {
          text: "t",
          cost: { mana: "{G}" },
          effects: [
            {
              op: "PutCounters",
              counter: "quest",
              target: "self",
              use_source_power: true,
            },
          ],
        },
      ],
    });
    expect(bad.success).toBe(false);
  });

  it("schema rejects use_source_power with target 'creature' (lane 23 v1 limitation)", () => {
    const bad = CardScriptSchema.safeParse({
      name: "X",
      oracle: "x",
      activated: [
        {
          text: "t",
          cost: { mana: "{G}" },
          effects: [
            {
              op: "PutCounters",
              counter: "+1/+1",
              target: "creature",
              controller: "you",
              use_source_power: true,
            },
          ],
        },
      ],
    });
    expect(bad.success).toBe(false);
  });

  it("end-to-end: Heroes' Bane activation adds source's effective power as +1/+1 counters", () => {
    // Heroes' Bane ETBs with 4 +1/+1 counters (CR 614.1c). The lane
    // test focuses on the activation's "use_source_power" path; the
    // ETB counter setup is exercised by the broader scripted-spell
    // tests. Here we hand-place Heroes' Bane with base P/T 0/0 and
    // seed 4 +1/+1 counters, simulating its post-ETB state — so its
    // effective power is 4.
    const cardData = makeCard({
      id: "heroes-bane-1",
      name: "Heroes' Bane",
      power: "0",
      toughness: "0",
    });
    const cardId = "heroes-bane-1" as CardInstanceId;
    let s1 = placeOnBattlefield(state, {
      card: cardData,
      controller: p1,
      owner: p1,
      zone: "battlefield",
      cardId,
    });
    // Seed the post-ETB state with 4 +1/+1 counters, like the real
    // card's `enters with` clause.
    const cards = new Map(s1.cards);
    const placed = cards.get(cardId)!;
    cards.set(cardId, {
      ...placed,
      counters: [{ type: "+1/+1", count: 4 }],
    });
    s1 = { ...s1, cards };
    // Give p1 enough mana to pay {2}{G}.
    const players = new Map(s1.players);
    const p1Player = players.get(p1)!;
    players.set(p1, {
      ...p1Player,
      manaPool: { ...p1Player.manaPool, generic: 3, green: 1 },
    });
    const s2 = { ...s1, players };

    // Push Heroes' Bane's activation onto the stack manually, then
    // resolve via `resolveScriptedAbility` (the lane targets the
    // scripted-effects path; pushing through `activateAbility` would
    // just queue it on the stack without resolving).
    const stackObject: StackObject = {
      id: "heroes-bane-stack",
      type: "ability",
      triggered: false,
      sourceCardId: cardId,
      controllerId: p1,
      name: "Heroes' Bane ability",
      text: "Put X +1/+1 counters on this creature, where X is its power.",
      manaCost: null,
      targets: [],
      chosenModes: [],
      variableValues: new Map(),
      isCopy: false,
      isCountered: false,
      timestamp: 0,
    } as StackObject;
    const s3 = { ...s2, stack: [stackObject] };
    const resolved = resolveScriptedAbility(s3, stackObject);
    expect(resolved).toBeDefined();
    // 4 (existing) + 4 (source's effective power = 4) = 8.
    expect(getCounters(resolved!, cardId)).toBe(8);
  });
});

function getCounters(state: GameState, cardId: CardInstanceId): number {
  const c = state.cards.get(cardId);
  if (!c) return -1;
  return c.counters.find((x) => x.type === "+1/+1")?.count ?? 0;
}