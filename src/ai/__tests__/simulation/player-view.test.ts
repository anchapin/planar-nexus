/**
 * anchapin/manamind#86: a seat's player-visible view of a TrainingSession
 * game, in the Forge-bridge shape manamind's ForgePointerNet reads.
 */
import { FORGE_PHASE, playerView } from "@/ai/simulation/player-view";
import {
  randomAction,
  TrainingSession,
  trainingDeck,
} from "@/ai/simulation/training-session";
import { Phase, type GameState } from "@/lib/game-state";

const CARD_KEYS = [
  "cmc",
  "cost",
  "creature",
  "land",
  "name",
  "power",
  "sick",
  "tapped",
  "toughness",
  "type",
];

/** Play `steps` random moves from a seeded game; returns the session. */
function midGame(seed: number, steps: number) {
  const session = new TrainingSession();
  const seats = session.reset(
    seed,
    trainingDeck("aggro"),
    trainingDeck("midrange"),
  );
  let rng = seed;
  const next = () => {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return rng / 2 ** 32;
  };
  let prompt = session.legalChoices();
  for (let i = 0; i < steps && prompt.kind !== "game_over"; i++) {
    prompt = session.step(randomAction(prompt, next));
  }
  return { session, seats };
}

/** Deep copy with an opponent's hand and library swapped for other cards. */
function shuffleHidden(state: GameState, opp: string): GameState {
  const zones = new Map(state.zones);
  const hand = zones.get(`${opp}-hand`)!;
  const lib = zones.get(`${opp}-library`)!;
  zones.set(`${opp}-hand`, {
    ...hand,
    cardIds: lib.cardIds.slice(0, hand.cardIds.length),
  });
  zones.set(`${opp}-library`, {
    ...lib,
    cardIds: [...hand.cardIds, ...lib.cardIds.slice(hand.cardIds.length)],
  });
  return { ...state, zones };
}

describe("playerView", () => {
  it("emits the Forge-bridge fields for each seat", () => {
    const { session, seats } = midGame(11, 120);
    const [me, opp] = seats;
    const v = session.playerView(me);
    const w = session.playerView(opp);
    const s = session.state;

    expect(v.turn).toBe(s.turn.turnNumber);
    expect(v.phase).toBe(FORGE_PHASE[s.turn.currentPhase]);
    expect(v.active).toBe(!w.active);
    expect(v.life).toEqual([s.players.get(me)!.life, s.players.get(opp)!.life]);
    expect(w.life).toEqual([v.life[1], v.life[0]]);
    expect(v.opp_hand_size).toBe(w.hand.length);
    expect(v.library).toEqual([w.library[1], w.library[0]]);
    expect(v.opp_graveyard).toEqual(w.graveyard);
    expect(v.battlefield.length + v.opp_battlefield.length).toBeGreaterThan(0);
    for (const card of [...v.hand, ...v.battlefield, ...v.opp_battlefield]) {
      expect(Object.keys(card).sort()).toEqual(CARD_KEYS);
      expect(card.cost.length).toBeGreaterThan(0);
    }
    for (const land of v.battlefield.filter((c) => c.land)) {
      expect(land.cost).toBe("no cost");
      expect(land.sick).toBe(false);
    }
  });

  it("maps every engine phase to a Forge phase name", () => {
    for (const phase of Object.values(Phase)) {
      expect(FORGE_PHASE[phase]).toMatch(/^[A-Z0-9_]+$/);
    }
  });

  it("keeps the opponent's hand and both libraries hidden", () => {
    const { session, seats } = midGame(4, 60);
    const [me, opp] = seats;
    const before = playerView(session.state, me);
    const after = playerView(shuffleHidden(session.state, opp), me);
    expect(after).toEqual(before);
    expect(JSON.stringify(before)).not.toContain(`"${opp}`);
  });
});
