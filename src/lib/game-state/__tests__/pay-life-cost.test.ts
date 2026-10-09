/**
 * "Pay N life" as an activated cost (#2594 follow-up, lane 21)
 *
 * The drafter has 2 cards wanting this — Ring of the Lucii
 * (FIN #269, "{2}, {T}, Pay 1 life: Tap target nonland
 * permanent.") and Ovika, Enigma Goliath's ward cost
 * ("Ward — {3}, Pay 3 life", but ward is a keyword, not an
 * activated cost). The lane adds an optional `pay_life` field
 * to the script's `cost` block (parallel to `sacrifice_permanents`)
 * and wires it into the engine's `ParsedActivatedAbility.payLife`
 * so the activation path deducts N from the controller's life.
 *
 * The engine already pays `payLife` in `abilities/activated.ts`
 * (line 412) — that branch was unreachable from scripts because
 * `scriptedActivated()` always emitted `payLife: 0`. The lane
 * closes the gap.
 */
import { describe, it, expect, afterAll, beforeAll } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInitialGameState, startGame } from "../game-state";
import { activateAbility } from "../abilities/activated";
import { getActivatedAbilities } from "../abilities/parse";
import { Phase } from "../types";
import type {
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
    keywords: overrides.legalities ? [] : [],
    legalities: overrides.legalities ?? { standard: "legal" },
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

describe('Pay N life as an activated cost (#2594 follow-up)', () => {
  let state: GameState;
  let p1: PlayerId;

  beforeAll(() => {
    // Register a synthetic scripted permanent that exercises the new
    // cost.pay_life field — a minimal Ring-of-the-Lucii-style ability
    // ("{T}, Pay 1 life: draw a card"). Kept synthetic so the lane's
    // test surface is isolated from Ring of the Lucii's other gaps
    // (AddMana / tap-nonland). The real card is asserted below.
    const synthetic: CardScript = {
      name: "Test Pay Life Cost",
      oracle: "Test: {T}, Pay 1 life: draw a card.",
      activated: [
        {
          text: "Draw a card.",
          cost: { tap: true, sacrifice: false, pay_life: 1 },
          effects: [{ op: "Draw", amount: 1, who: "you" }],
        },
      ],
    } as CardScript;
    registerCardScripts([...RAW_CARD_SCRIPTS, synthetic]);
  });
  afterAll(() => {
    resetCardScriptsForTests();
    registerCardScripts(RAW_CARD_SCRIPTS);
  });

  // Standard 2-player setup, p1 active in precombat main.
  function fresh(): GameState {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1] = Array.from(state.players.keys());
    state.turn.activePlayerId = p1;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    return state;
  }

  it("Ring of the Lucii fixture declares cost.pay_life on its tap ability", () => {
    const cardsDir = join(__dirname, "..", "card-scripts", "cards");
    const fixture = JSON.parse(
      readFileSync(join(cardsDir, "ring_of_the_lucii.json"), "utf8"),
    ) as {
      name: string;
      activated: { text: string; cost: Record<string, unknown> }[];
    };
    expect(fixture.name).toBe("Ring of the Lucii");
    expect(fixture.activated).toHaveLength(2);
    const tapAbility = fixture.activated[1];
    expect(tapAbility.cost.pay_life).toBe(1);
    expect(tapAbility.cost.tap).toBe(true);
    expect(tapAbility.cost.mana).toBe("{2}");
  });

  it("schema parses a scripted card with cost.pay_life into the parsed ability", () => {
    const cardData = makeCard({ id: "roli-1", name: "Ring of the Lucii" });
    const parsed = getActivatedAbilities(cardData);
    expect(parsed).toHaveLength(2);
    const payLife = parsed.find((a) => a.costs.payLife > 0);
    expect(payLife).toBeDefined();
    expect(payLife?.costs.payLife).toBe(1);
    expect(payLife?.costs.tap).toBe(true);
  });

  it("activateAbility with cost.pay_life deducts life from the controller", () => {
    const s0 = fresh();
    const cardData = makeCard({
      id: "pay-life-source",
      name: "Test Pay Life Cost",
      type_line: "Artifact",
    });
    const cardId = "pay-life-source" as CardInstanceId;
    const s = placeOnBattlefield(s0, {
      card: cardData,
      controller: p1,
      owner: p1,
      zone: "battlefield",
      cardId,
    });
    expect(s.players.get(p1)!.life).toBe(20);
    const r = activateAbility(s, p1, cardId, 0, []);
    expect(r.success).toBe(true);
    // pay_life: 1 deducted from 20 → 19 (the engine's payLife branch
    // ran with the wired-up value, not the prior hardcoded 0).
    expect(r.state.players.get(p1)!.life).toBe(19);
  });

  it("activateAbility with cost.pay_life fails when the controller has too little life", () => {
    const s0 = fresh();
    // Drop p1 to 0 life so the activation must fail.
    const players = new Map(s0.players);
    players.set(p1, { ...players.get(p1)!, life: 0 });
    const sLowered = { ...s0, players };
    const cardData = makeCard({
      id: "pay-life-low",
      name: "Test Pay Life Cost",
      type_line: "Artifact",
    });
    const cardId = "pay-life-low" as CardInstanceId;
    const s = placeOnBattlefield(sLowered, {
      card: cardData,
      controller: p1,
      owner: p1,
      zone: "battlefield",
      cardId,
    });
    expect(s.players.get(p1)!.life).toBe(0);
    const r = activateAbility(s, p1, cardId, 0, []);
    expect(r.success).toBe(false);
    // Engine returns "Not enough life" via `canActivate`. Life
    // remains unchanged.
    expect(r.state.players.get(p1)!.life).toBe(0);
  });

  it("Ring of the Lucii's first ability has no pay_life cost (AddMana tap-only)", () => {
    const cardData = makeCard({ id: "roli-mana", name: "Ring of the Lucii" });
    const parsed = getActivatedAbilities(cardData);
    expect(parsed).toHaveLength(2);
    const manaAbility = parsed.find((a) => a.costs.payLife === 0);
    expect(manaAbility).toBeDefined();
    expect(manaAbility?.costs.tap).toBe(true);
    expect(manaAbility?.costs.payLife).toBe(0);
  });
});