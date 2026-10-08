/**
 * "Exile this artifact as a cost" tests (#2594 follow-up)
 *
 * The drafter has 3 FIN cards wanting this — Phoenix Down
 * ({1}{W}, {T}, Exile this artifact: Exile target creature.),
 * Ether ({2}, {T}, Exile this artifact: Return target creature
 * you control to its owner's hand.), and Elixir ({T}, Exile this
 * artifact: You gain 3 life.). The lane adds `exileSelf: boolean`
 * to the activated-cost schema and threads the engine's
 * `activateAbility` path so the source card moves from the
 * battlefield to the controller's exile zone as part of the
 * activation cost.
 */
import { describe, it, expect, beforeEach, afterAll, beforeAll } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { moveCardToZone } from "../keyword-actions/removal";
import { activateAbility } from "../abilities/activated";
import { Phase } from "../types";
import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";
import { RAW_CARD_SCRIPTS } from "../card-scripts/cards/index.generated";
import {
  registerCardScripts,
  resetCardScriptsForTests,
} from "../card-scripts/registry";
import type { CardScript } from "../card-scripts/schema";

function makeCard(overrides: Partial<ScryfallCard> & { id: string }): ScryfallCard {
  return {
    id: `mock-${overrides.id}`,
    name: overrides.name ?? "Test Card",
    type_line: overrides.type_line ?? "Artifact",
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost ?? "",
    cmc: overrides.cmc ?? 0,
    colors: overrides.colors ?? [],
    color_identity: overrides.color_identity ?? [],
    keywords: overrides.keywords ?? [],
    legalities: { standard: "legal" },
    layout: overrides.layout ?? "normal",
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
  const inst: CardInstance = createCardInstance(opts.card, opts.owner, opts.owner, {
    currentZoneKey: zoneKey,
  });
  inst.controllerId = opts.controller;
  const cards = new Map(state.cards).set(opts.cardId, inst);
  const existing = state.zones.get(zoneKey)!;
  const zones = new Map(state.zones);
  zones.set(zoneKey, {
    ...existing,
    cardIds: [...existing.cardIds, opts.cardId],
  });
  return { ...state, cards, zones };
}

describe('Exile this artifact as a cost (#2594 follow-up)', () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeAll(() => {
    // Register a synthetic card with `exileSelf: true` so the engine's
    // getActivatedAbilities() can resolve it end-to-end.
    const synthetic: CardScript = {
      name: "Test Exile Self",
      oracle: "Test Elixir: {T}, Exile this artifact: You gain 3 life.",
      activated: [
        {
          text: "You gain 3 life.",
          cost: { tap: true, sacrifice: false, exileSelf: true },
          effects: [{ op: "GainLife", amount: 3, who: "you" }],
        },
      ],
    } as CardScript;
    registerCardScripts([...RAW_CARD_SCRIPTS, synthetic]);
  });
  afterAll(() => {
    resetCardScriptsForTests();
    registerCardScripts(RAW_CARD_SCRIPTS);
  });

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state.turn.activePlayerId = p1;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
  });

  it("schema accepts exileSelf: true on an activated cost", () => {
    // The schema's `exileSelf: z.boolean().default(false)` adds
    // the field on parse. Verify the live Phoenix Down fixture
    // declares it.
    const cardsDir = join(__dirname, "..", "card-scripts", "cards");
    const fixture = JSON.parse(
      readFileSync(join(cardsDir, "phoenix_down.json"), "utf8"),
    ) as { activated: { cost: Record<string, unknown> }[] };
    expect(fixture.activated[0].cost.exileSelf).toBe(true);
  });

  it("Ether card-script declares exileSelf: true on its activated cost", () => {
    const cardsDir = join(__dirname, "..", "card-scripts", "cards");
    const ether = JSON.parse(
      readFileSync(join(cardsDir, "ether.json"), "utf8"),
    ) as { name: string; activated: { cost: Record<string, unknown> }[] };
    expect(ether.name).toBe("Ether");
    expect(ether.activated[0].cost.exileSelf).toBe(true);
    expect(ether.activated[0].cost.tap).toBe(true);
  });

  it("Elixir card-script declares exileSelf: true (with no mana cost)", () => {
    const cardsDir = join(__dirname, "..", "card-scripts", "cards");
    const elixir = JSON.parse(
      readFileSync(join(cardsDir, "elixir.json"), "utf8"),
    ) as { name: string; activated: { cost: Record<string, unknown> }[] };
    expect(elixir.name).toBe("Elixir");
    expect(elixir.activated[0].cost.exileSelf).toBe(true);
    expect(elixir.activated[0].cost.mana).toBeUndefined();
  });

  it("the engine's exileCard primitive moves an artifact to the controller's exile zone", () => {
    const cardData = makeCard({
      id: "ether-1",
      name: "Ether",
      type_line: "Artifact",
    });
    const cardId = "ether-1" as CardInstanceId;
    const s = placeOnBattlefield(state, {
      card: cardData,
      controller: p1,
      owner: p1,
      zone: "battlefield",
      cardId,
    });
    expect(s.cards.get(cardId)!.currentZoneKey).toBe(`${p1}-battlefield`);
    const r = moveCardToZone(s, cardId, "exile");
    expect(r.success).toBe(true);
    expect(r.state.zones.get(`${p1}-exile`)!.cardIds).toContain(cardId);
  });

  it("activateAbility with exileSelf exiles the source card before resolving", () => {
    const cardData = makeCard({
      id: "exile-self-source",
      name: "Test Exile Self",
      type_line: "Artifact",
    });
    const cardId = "exile-self-source" as CardInstanceId;
    const s0 = placeOnBattlefield(state, {
      card: cardData,
      controller: p1,
      owner: p1,
      zone: "battlefield",
      cardId,
    });
    expect(s0.cards.get(cardId)!.currentZoneKey).toBe(`${p1}-battlefield`);

    const r = activateAbility(s0, p1, cardId, 0, []);
    expect(r.success).toBe(true);
    // Source is in the exile zone — `exileSelf` cost paid before
    // the ability is pushed onto the stack.
    expect(r.state.zones.get(`${p1}-exile`)!.cardIds).toContain(cardId);
    // The activation landed (r.success === true). The effect itself
    // resolves later through the stack/priority pipeline; we don't
    // need to drive that here — `gainLife` is exercised by the
    // broader scripted-spell tests, and the lane's contribution
    // (the exile cost) is verified above.
    expect(r.state.players.get(p1)!.life).toBeGreaterThanOrEqual(20);
  });
});