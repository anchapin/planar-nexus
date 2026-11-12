/**
 * anchapin/manamind#44: OpponentHistoryTracker counts only what a real
 * player could see, exactly once per revealed event, bucketed by turn.
 */

import { describe, expect, it } from "@jest/globals";

import {
  historyBucket,
  HISTORY_TURN_BUCKETS,
  OpponentHistoryTracker,
} from "@/ai/simulation/player-history";

import { createCardInstance } from "@/test-utils/factories/game-state";
import type { CardInstance, GameState, PlayerId } from "@/lib/game-state";

const P1: PlayerId = "p1";
const P2: PlayerId = "p2";

type FakeCard = CardInstance;

function card(opts: {
  name: string;
  type: string;
  controller: string;
  faceDown?: boolean;
  tapped?: boolean;
  zone?: "battlefield" | "graveyard" | "hand";
}): FakeCard {
  const c = createCardInstance({
    name: opts.name,
    type_line: opts.type,
    controllerId: opts.controller,
    ownerId: opts.controller,
    isTapped: opts.tapped ?? false,
  });
  c.isFaceDown = opts.faceDown ?? false;
  c.currentZoneKey = opts.zone ? `${opts.controller}-${opts.zone}` : null;
  return c;
}

function makeState(opts: {
  turn: number;
  cards: FakeCard[];
  mana?: Record<string, number>;
  combat?: {
    inCombat: boolean;
    attackers: string[];
    blocks: Record<string, string[]>;
  };
}): GameState {
  const zones = new Map<string, { cardIds: string[] }>();
  for (const player of [P1, P2]) {
    for (const zone of ["battlefield", "graveyard", "hand"]) {
      zones.set(`${player}-${zone}`, { cardIds: [] });
    }
  }
  for (const c of opts.cards) {
    if (c.currentZoneKey) zones.get(c.currentZoneKey)?.cardIds.push(c.id);
  }
  const combat = {
    inCombatPhase: opts.combat?.inCombat ?? false,
    attackers: (opts.combat?.attackers ?? []).map((id) => ({
      cardId: id,
      defenderId: P1,
      isAttackingPlaneswalker: false,
      damageToDeal: 2,
      hasFirstStrike: false,
      hasDoubleStrike: false,
    })),
    blockers: new Map(
      Object.entries(opts.combat?.blocks ?? {}).map(([attacker, ids]) => [
        attacker,
        ids.map((id) => ({
          cardId: id,
          attackerId: attacker,
          damageToDeal: 0,
          blockerOrder: 0,
          hasFirstStrike: false,
          hasDoubleStrike: false,
        })),
      ]),
    ),
    remainingCombatPhases: 0,
  };
  return {
    players: new Map([
      [
        P1,
        {
          id: P1,
          life: 20,
          manaPool: {
            white: 0,
            blue: 0,
            black: 0,
            red: 0,
            green: 0,
            colorless: 0,
            generic: 0,
          },
        },
      ],
      [
        P2,
        {
          id: P2,
          life: 20,
          manaPool: opts.mana ?? {
            white: 0,
            blue: 0,
            black: 0,
            red: 0,
            green: 0,
            colorless: 0,
            generic: 0,
          },
        },
      ],
    ]),
    zones,
    cards: new Map(opts.cards.map((c) => [c.id, c as unknown as never])),
    turn: { turnNumber: opts.turn, activePlayerId: P2 },
    combat,
  } as unknown as GameState;
}

describe("historyBucket", () => {
  it("buckets turns 1-2, 3-4, 5-6, 7+", () => {
    expect(historyBucket(1)).toBe(0);
    expect(historyBucket(2)).toBe(0);
    expect(historyBucket(3)).toBe(1);
    expect(historyBucket(4)).toBe(1);
    expect(historyBucket(5)).toBe(2);
    expect(historyBucket(6)).toBe(2);
    expect(historyBucket(7)).toBe(3);
    expect(historyBucket(40)).toBe(HISTORY_TURN_BUCKETS - 1);
  });
});

describe("OpponentHistoryTracker", () => {
  it("reads an empty game as all zeros", () => {
    const tracker = new OpponentHistoryTracker(P1);
    const s = tracker.observe(makeState({ turn: 1, cards: [] }));
    expect(s.totals.observations).toBe(1);
    expect(s.totals.landsPlayed).toBe(0);
    expect(s.oppGraveyardSize).toBe(0);
    expect(s.buckets).toHaveLength(HISTORY_TURN_BUCKETS);
    for (const b of s.buckets) expect(b.landsPlayed).toBe(0);
  });

  it("counts a land and a creature in their turn buckets", () => {
    const tracker = new OpponentHistoryTracker(P1);
    const land = card({
      name: "Plains",
      type: "Land",
      controller: P2,
      zone: "battlefield",
    });
    const state1 = makeState({ turn: 2, cards: [land] });
    tracker.observe(state1);

    const bear = card({
      name: "Bear",
      type: "Creature — Bear",
      controller: P2,
      zone: "battlefield",
    });
    const state2 = makeState({ turn: 3, cards: [land, bear] });
    const s2 = tracker.observe(state2);
    expect(s2.buckets[0].landsPlayed).toBe(1);
    expect(s2.buckets[1].creaturesPlayed).toBe(1);
    expect(s2.totals.landsPlayed).toBe(1);
    expect(s2.totals.creaturesPlayed).toBe(1);
  });

  it("counts a dying creature once, moved battlefield to graveyard", () => {
    const tracker = new OpponentHistoryTracker(P1);
    const bear = card({
      name: "Bear",
      type: "Creature — Bear",
      controller: P2,
      zone: "battlefield",
    });
    tracker.observe(makeState({ turn: 1, cards: [bear] }));
    bear.currentZoneKey = `${P2}-graveyard`;
    const s2 = tracker.observe(makeState({ turn: 5, cards: [bear] }));
    expect(s2.buckets[2].creaturesToGraveyard).toBe(1);
    expect(s2.totals.creaturesPlayed).toBe(1);
    expect(s2.totals.creaturesToGraveyard).toBe(1);
    expect(s2.oppGraveyardSize).toBe(1);
  });

  it("does not double count on repeat observations", () => {
    const tracker = new OpponentHistoryTracker(P1);
    const land = card({
      name: "Island",
      type: "Land",
      controller: P2,
      zone: "battlefield",
    });
    const state = makeState({ turn: 1, cards: [land] });
    tracker.observe(state);
    const s2 = tracker.observe(state);
    expect(s2.totals.landsPlayed).toBe(1);
    expect(s2.totals.observations).toBe(2);
  });

  it("hides face-down entries behind the creature count, not the name", () => {
    const tracker = new OpponentHistoryTracker(P1);
    const morph = card({
      name: "Real Name",
      type: "Creature — Bear",
      controller: P2,
      faceDown: true,
      zone: "battlefield",
    });
    const s = tracker.observe(makeState({ turn: 1, cards: [morph] }));
    expect(s.buckets[0].creaturesPlayed).toBe(1);
  });

  it("reads the opponent's mana pool as public information", () => {
    const tracker = new OpponentHistoryTracker(P1);
    const s = tracker.observe(
      makeState({
        turn: 1,
        cards: [],
        mana: {
          white: 0,
          blue: 0,
          black: 0,
          red: 2,
          green: 0,
          colorless: 1,
          generic: 0,
        },
      }),
    );
    expect(s.oppManaPool.R).toBe(2);
    expect(s.oppManaPool.C).toBe(1);
    expect(s.oppManaPool.W).toBe(0);
  });

  it("counts combat commitments by controller", () => {
    const tracker = new OpponentHistoryTracker(P1);
    const oppAttacker = card({
      name: "Goblin",
      type: "Creature — Goblin",
      controller: P2,
      zone: "battlefield",
    });
    const myAttacker = card({
      name: "Bear",
      type: "Creature — Bear",
      controller: P1,
      zone: "battlefield",
    });
    const blockA = card({
      name: "Wall",
      type: "Creature — Wall",
      controller: P2,
      zone: "battlefield",
    });
    const blockB = card({
      name: "Wall 2",
      type: "Creature — Wall",
      controller: P2,
      zone: "battlefield",
    });
    tracker.observe(
      makeState({ turn: 3, cards: [oppAttacker, myAttacker, blockA, blockB] }),
    );
    const s = tracker.observe(
      makeState({
        turn: 3,
        cards: [oppAttacker, myAttacker, blockA, blockB],
        combat: {
          inCombat: true,
          attackers: [oppAttacker.id, myAttacker.id],
          blocks: { [myAttacker.id]: [blockA.id, blockB.id] },
        },
      }),
    );
    expect(s.oppAttackersThisCombat).toBe(1);
    expect(s.oppBlockersThisCombat).toBe(2);
  });

  it("tracks the opponent's hand-size samples per bucket", () => {
    const tracker = new OpponentHistoryTracker(P1);
    const hand1 = [1, 2, 3, 4, 5].map(() =>
      card({ name: "Card", type: "Instant", controller: P2, zone: "hand" }),
    );
    tracker.observe(makeState({ turn: 2, cards: hand1 }));
    const hand2 = [1, 2, 3].map(() =>
      card({ name: "Card", type: "Instant", controller: P2, zone: "hand" }),
    );
    const s2 = tracker.observe(makeState({ turn: 3, cards: hand2 }));
    expect(s2.buckets[0].handSizeSamples).toBe(1);
    expect(s2.buckets[0].handSizeSum).toBe(5);
    expect(s2.buckets[1].handSizeSamples).toBe(1);
    expect(s2.buckets[1].handSizeSum).toBe(3);
  });

  it("throws for a viewer not in the game", () => {
    const tracker = new OpponentHistoryTracker("p3" as PlayerId);
    expect(() => tracker.observe(makeState({ turn: 1, cards: [] }))).toThrow(
      /not in the game/,
    );
  });
});
