/**
 * Improvise (CR 702.126), issue #2300: Arc Reactor and Ironheart, Clever
 * Champion ("Noncreature spells you cast have improvise.").
 */
import { describe, it, expect } from "@jest/globals";
import { castSpell } from "../spell-casting";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import {
  parseImprovise,
  grantsNoncreatureImprovise,
} from "../oracle-text-parser";
import { Phase } from "../types";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  CardInstance,
} from "../types";
import type { ScryfallCard } from "../types";

const IMPROVISE_REMINDER =
  "Improvise (Your artifacts can help cast this spell. Each artifact you tap after you're done activating mana abilities pays for {1}.)";

function makeCard(
  overrides: Partial<ScryfallCard> & { id: string },
): ScryfallCard {
  return {
    name: "Test Card",
    type_line: "Instant",
    oracle_text: "",
    mana_cost: "{1}",
    cmc: 1,
    colors: [],
    color_identity: [],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
    ...overrides,
  } as ScryfallCard;
}

const arcReactor = (): ScryfallCard =>
  makeCard({
    id: "arc-reactor",
    name: "Arc Reactor",
    type_line: "Artifact",
    oracle_text: `${IMPROVISE_REMINDER}\nThis artifact enters tapped.\n{T}: Add {C}{C}{C}.`,
    mana_cost: "{5}",
    cmc: 5,
  });

const ironheart = (): ScryfallCard =>
  makeCard({
    id: "ironheart",
    name: "Ironheart, Clever Champion",
    type_line: "Legendary Artifact Creature — Human Hero",
    oracle_text: `${IMPROVISE_REMINDER}\nFlying\nNoncreature spells you cast have improvise.`,
    mana_cost: "{4}{U}",
    cmc: 5,
    colors: ["U"],
    color_identity: ["U"],
    power: "3",
    toughness: "3",
  });

const blueSorcery = (): ScryfallCard =>
  makeCard({
    id: "divination",
    name: "Divination",
    type_line: "Sorcery",
    oracle_text: "Draw two cards.",
    mana_cost: "{2}{U}",
    cmc: 3,
    colors: ["U"],
    color_identity: ["U"],
  });

const vanillaCreature = (): ScryfallCard =>
  makeCard({
    id: "bear",
    name: "Bear",
    type_line: "Creature — Bear",
    mana_cost: "{1}{G}",
    cmc: 2,
    colors: ["G"],
    power: "2",
    toughness: "2",
  });

const trinket = (id: string): ScryfallCard =>
  makeCard({ id, name: "Trinket", type_line: "Artifact", mana_cost: "{1}" });

const land = (id: string): ScryfallCard =>
  makeCard({
    id,
    name: "Island",
    type_line: "Basic Land — Island",
    mana_cost: "",
    cmc: 0,
  });

// ---------------------------------------------------------------------------
// Shared state scaffolding
// ---------------------------------------------------------------------------

interface Fixture {
  state: GameState;
  aliceId: PlayerId;
  bobId: PlayerId;
}

function makeFixture(): Fixture {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);

  const ids = Array.from(state.players.keys());
  const aliceId = ids[0];
  const bobId = ids[1];

  state.status = "in_progress";
  state.priorityPlayerId = aliceId;
  state.turn.activePlayerId = aliceId;
  state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
  state.stack = [];
  state.consecutivePasses = 0;
  state.players.forEach((p) =>
    state.players.set(p.id, { ...p, hasPassedPriority: false }),
  );

  return { state, aliceId, bobId };
}

/**
 * Place a permanent on a player's battlefield. Default: untapped, NO summoning
 * sickness (mirrors the prowess fixture — convoke does not interact with
 * summoning sickness per CR 302.6, but tests that care about the flag can
 * pass `summoningSick: true`).
 */
function putOnBattlefield(
  state: GameState,
  playerId: PlayerId,
  cardData: ScryfallCard,
  opts: { tapped?: boolean; summoningSick?: boolean } = {},
): CardInstance {
  const card = createCardInstance(cardData, playerId, playerId);
  card.hasSummoningSickness = opts.summoningSick ?? false;
  card.isTapped = opts.tapped ?? false;
  card.currentZoneKey = `${playerId}-battlefield`;
  state.cards.set(card.id, card);
  const bf = state.zones.get(`${playerId}-battlefield`)!;
  state.zones.set(`${playerId}-battlefield`, {
    ...bf,
    cardIds: [...bf.cardIds, card.id],
  });
  return card;
}

/** Place a card into a player's hand. */
function putInHand(
  state: GameState,
  playerId: PlayerId,
  cardData: ScryfallCard,
): CardInstanceId {
  const card = createCardInstance(cardData, playerId, playerId);
  card.currentZoneKey = `${playerId}-hand`;
  state.cards.set(card.id, card);
  const hand = state.zones.get(`${playerId}-hand`)!;
  state.zones.set(`${playerId}-hand`, {
    ...hand,
    cardIds: [...hand.cardIds, card.id],
  });
  return card.id;
}

describe("Improvise — parsing (CR 702.126)", () => {
  it("detects printed improvise but not the noncreature grant", () => {
    expect(parseImprovise(arcReactor().oracle_text!).hasImprovise).toBe(true);
    expect(parseImprovise("Flying").hasImprovise).toBe(false);
    expect(
      parseImprovise("Noncreature spells you cast have improvise.")
        .hasImprovise,
    ).toBe(false);
    expect(grantsNoncreatureImprovise(ironheart().oracle_text!)).toBe(true);
    expect(grantsNoncreatureImprovise(arcReactor().oracle_text!)).toBe(false);
  });
});

describe("Improvise — casting", () => {
  it("casts Arc Reactor by tapping five artifacts and no mana", () => {
    const { state, aliceId } = makeFixture();
    const arts = [1, 2, 3, 4, 5].map((i) =>
      putOnBattlefield(state, aliceId, trinket(`t${i}`)),
    );
    const spellId = putInHand(state, aliceId, arcReactor());
    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "improvise",
      improviseArtifacts: arts.map((a) => a.id),
    });
    expect(result.success).toBe(true);
    expect(result.state.zones.get("stack")!.cardIds).toContain(spellId);
    for (const a of arts) {
      expect(result.state.cards.get(a.id)!.isTapped).toBe(true);
    }
  });

  it("combines artifact taps with mana, and a summoning-sick artifact creature can tap", () => {
    const fx = makeFixture();
    let state = fx.state;
    const me = fx.aliceId;
    const sick = putOnBattlefield(state, me, ironheart(), {
      summoningSick: true,
    });
    const t1 = putOnBattlefield(state, me, trinket("t1"));
    const spellId = putInHand(state, me, arcReactor());
    state = addMana(state, me, { colorless: 3 });
    const result = castSpell(state, me, spellId, [], [], 0, false, {
      type: "improvise",
      improviseArtifacts: [sick.id, t1.id],
    });
    expect(result.success).toBe(true);
    expect(result.state.cards.get(sick.id)!.isTapped).toBe(true);
    expect(result.state.cards.get(t1.id)!.isTapped).toBe(true);
  });

  it("rejects non-artifacts, tapped artifacts, and more taps than generic mana", () => {
    const { state, aliceId } = makeFixture();
    const isl = putOnBattlefield(state, aliceId, land("isl"));
    const tapped = putOnBattlefield(state, aliceId, trinket("tt"), {
      tapped: true,
    });
    const spellId = putInHand(state, aliceId, arcReactor());
    const cast = (arts: CardInstanceId[]) =>
      castSpell(state, aliceId, spellId, [], [], 0, false, {
        type: "improvise",
        improviseArtifacts: arts,
      });
    expect(cast([isl.id]).error).toMatch(/not an artifact/);
    expect(cast([tapped.id]).error).toMatch(/already tapped/);
    const six = [1, 2, 3, 4, 5, 6].map(
      (i) => putOnBattlefield(state, aliceId, trinket(`x${i}`)).id,
    );
    expect(cast(six).error).toMatch(/more artifacts declared/);
  });

  it("Ironheart gives a noncreature spell improvise for its generic mana only", () => {
    const fx = makeFixture();
    let state = fx.state;
    const aliceId = fx.aliceId;
    putOnBattlefield(state, aliceId, ironheart());
    const t1 = putOnBattlefield(state, aliceId, trinket("t1"));
    const t2 = putOnBattlefield(state, aliceId, trinket("t2"));
    const spellId = putInHand(state, aliceId, blueSorcery());
    state = addMana(state, aliceId, { blue: 1 });
    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "improvise",
      improviseArtifacts: [t1.id, t2.id],
    });
    expect(result.success).toBe(true);
    expect(result.state.cards.get(t1.id)!.isTapped).toBe(true);
    expect(result.state.cards.get(t2.id)!.isTapped).toBe(true);
  });

  it("does not grant improvise to creature spells or without Ironheart", () => {
    const { state, aliceId } = makeFixture();
    const t1 = putOnBattlefield(state, aliceId, trinket("t1"));
    const sorceryId = putInHand(state, aliceId, blueSorcery());
    expect(
      castSpell(state, aliceId, sorceryId, [], [], 0, false, {
        type: "improvise",
        improviseArtifacts: [t1.id],
      }).error,
    ).toMatch(/doesn't have improvise/);
    putOnBattlefield(state, aliceId, ironheart());
    const bearId = putInHand(state, aliceId, vanillaCreature());
    expect(
      castSpell(state, aliceId, bearId, [], [], 0, false, {
        type: "improvise",
        improviseArtifacts: [t1.id],
      }).error,
    ).toMatch(/doesn't have improvise/);
  });
});
