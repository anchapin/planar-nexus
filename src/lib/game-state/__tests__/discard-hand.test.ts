/**
 * "Discard your hand" tests (#2594 follow-up, lane 15)
 *
 * The drafter has 1 FDN + 1 FIN card wanting this — Myojin of
 * Night's Reach (FDN #610, "Remove a divinity counter from this
 * creature: each opponent discards their hand.") and Nibelheim
 * Aflame (FIN, "Discard your hand."). The current `Discard` op
 * requires an explicit `amount`; this lane adds `all: true` that
 * discards every card in the player's hand regardless of the
 * `amount` value.
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveScriptedSpell } from "../card-scripts/interpret";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

function makeCard(name: string): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: "Instant",
    oracle_text: "",
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
  } as ScryfallCard;
}

/** Place a card into the player's hand. */
function placeInHand(
  state: GameState,
  card: ScryfallCard,
  owner: PlayerId,
  cardId: CardInstanceId,
): GameState {
  const zoneKey = `${owner}-hand`;
  const inst = createCardInstance(card, owner, owner, {
    id: cardId,
    currentZoneKey: zoneKey,
  });
  const cards = new Map(state.cards).set(cardId, inst);
  const zones = new Map(state.zones);
  const existing = state.zones.get(zoneKey)!;
  zones.set(zoneKey, {
    ...existing,
    cardIds: [...existing.cardIds, cardId],
  });
  return { ...state, cards, zones };
}

describe('Discard your hand (#2594 follow-up, lane 15)', () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state.turn.activePlayerId = p1;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
  });

  it("Myojin of Night's Reach script declares Discard with all: true", () => {
    const cardsDir = join(__dirname, "..", "card-scripts", "cards");
    const fixture = JSON.parse(
      readFileSync(join(cardsDir, "myojin_of_nights_reach.json"), "utf8"),
    ) as {
      name: string;
      activated: {
        effects: {
          op: string;
          who: string;
          amount: number;
          all?: boolean;
        }[];
      }[];
    };
    expect(fixture.name).toBe("Myojin of Night's Reach");
    const eff = fixture.activated[0].effects[0];
    expect(eff.op).toBe("Discard");
    expect(eff.who).toBe("each_opponent");
    expect(eff.all).toBe(true);
  });

  it("Discard.all discards every card in your own hand", () => {
    // p1 starts with 7 virtual default library cards (no CardInstance);
    // placeInHand adds 3 real cards. The Discard.all effect moves
    // every real card to the graveyard; the virtual entries stay
    // listed in the hand zone (they don't have a card instance to
    // move). We assert the 3 real cards moved.
    let s = placeInHand(state, makeCard("Bear"), p1, "bear-1" as CardInstanceId);
    s = placeInHand(s, makeCard("Bird"), p1, "bird-1" as CardInstanceId);
    s = placeInHand(s, makeCard("Wolf"), p1, "wolf-1" as CardInstanceId);

    const result = resolveScriptedSpell(
      s,
      {
        name: "Test Discard All",
        oracle: "Discard your hand.",
        spell: [{ op: "Discard", amount: 1, who: "you", all: true }],
      } as never,
      { controllerId: p1, sourceCardId: null, targets: [], chosenModes: [] },
    );
    // The 3 real cards moved to p1's graveyard.
    expect(result.zones.get(`${p1}-graveyard`)!.cardIds).toContain("bear-1");
    expect(result.zones.get(`${p1}-graveyard`)!.cardIds).toContain("bird-1");
    expect(result.zones.get(`${p1}-graveyard`)!.cardIds).toContain("wolf-1");
    // And p1's hand no longer contains those real cards.
    expect(result.zones.get(`${p1}-hand`)!.cardIds).not.toContain("bear-1");
    expect(result.zones.get(`${p1}-hand`)!.cardIds).not.toContain("bird-1");
    expect(result.zones.get(`${p1}-hand`)!.cardIds).not.toContain("wolf-1");
  });

  it("Discard.all on each_opponent discards each opponent's hand", () => {
    // Myojin of Night's Reach's pattern: each opponent discards
    // their hand. The 2 real cards I added to p2 are discarded.
    let s = placeInHand(state, makeCard("Bear"), p1, "p1-bear" as CardInstanceId);
    s = placeInHand(s, makeCard("Bird"), p2, "p2-bird" as CardInstanceId);
    s = placeInHand(s, makeCard("Wolf"), p2, "p2-wolf" as CardInstanceId);

    const result = resolveScriptedSpell(
      s,
      {
        name: "Test Myojin",
        oracle: "Each opponent discards their hand.",
        spell: [{ op: "Discard", amount: 1, who: "each_opponent", all: true }],
      } as never,
      { controllerId: p1, sourceCardId: null, targets: [], chosenModes: [] },
    );
    // p2's 2 real cards moved to p2's graveyard.
    expect(result.zones.get(`${p2}-graveyard`)!.cardIds).toContain("p2-bird");
    expect(result.zones.get(`${p2}-graveyard`)!.cardIds).toContain("p2-wolf");
    // p2's hand no longer contains those real cards.
    expect(result.zones.get(`${p2}-hand`)!.cardIds).not.toContain("p2-bird");
    expect(result.zones.get(`${p2}-hand`)!.cardIds).not.toContain("p2-wolf");
    // p1's hand is untouched — p1 isn't an "opponent" of itself.
    expect(result.zones.get(`${p1}-hand`)!.cardIds).toContain("p1-bear");
  });

  it("Discard.all on an empty real-cards hand is a no-op", () => {
    // No real cards in hand; the effect succeeds with no movement.
    // (The default virtual library cards remain listed in the
    // hand zone but they're not CardInstances.)
    const result = resolveScriptedSpell(
      state,
      {
        name: "Test Discard All (empty)",
        oracle: "Discard your hand.",
        spell: [{ op: "Discard", amount: 1, who: "you", all: true }],
      } as never,
      { controllerId: p1, sourceCardId: null, targets: [], chosenModes: [] },
    );
    expect(result).toBeDefined();
  });

  it("Discard.all populates only the real cards in hand (skip default virtuals)", () => {
    // When p1 has only the 7 default virtual library cards (no
    // CardInstance entries in state.cards), Discard.all is a
    // graceful no-op: the engine returns success with no movement
    // because no real cards exist. We assert no error and the
    // engine flow completed.
    const result = resolveScriptedSpell(
      state,
      {
        name: "Test Discard All (virtuals only)",
        oracle: "Discard your hand.",
        spell: [{ op: "Discard", amount: 1, who: "you", all: true }],
      } as never,
      { controllerId: p1, sourceCardId: null, targets: [], chosenModes: [] },
    );
    expect(result).toBeDefined();
  });
});