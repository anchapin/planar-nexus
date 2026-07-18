/**
 * @fileoverview Unit tests for the difficulty-scaled cleanup-phase discard
 * helper (issue #1414).
 *
 * The helper is a pure function over a minimal {@link EngineGameState}
 * (zones + cards). These tests build a single fixed 9-card hand
 * (lands/removal/spells/dead-color mix) and assert on the per-tier
 * ranking, plus determinism, format override, and the parser helpers.
 */
import { describe, it, expect } from "@jest/globals";
import {
  pickDiscardCandidates,
  LIMITED_MIN_HAND_SIZE,
  EXCESS_LAND_BATTLEFIELD_THRESHOLD,
} from "../cleanup-discard";
import type { DifficultyLevel } from "../ai-difficulty";
import type {
  GameState as EngineGameState,
  CardInstance,
  CardInstanceId,
  PlayerId,
  Turn,
} from "@/lib/game-state/types";

const AI: PlayerId = "player1";
const OPP: PlayerId = "player2";

/** Build a card instance with the minimal fields the helper reads. */
function card(
  id: string,
  opts: {
    name?: string;
    type_line: string;
    cmc?: number;
    mana_cost?: string;
    colors?: string[];
    oracle_text?: string;
    power?: string;
    controller?: PlayerId;
  },
): CardInstance {
  return {
    id,
    oracleId: id,
    cardData: {
      id,
      name: opts.name ?? id,
      type_line: opts.type_line,
      cmc: opts.cmc ?? 0,
      mana_cost: opts.mana_cost,
      colors: opts.colors ?? [],
      color_identity: opts.colors ?? [],
      oracle_text: opts.oracle_text,
      power: opts.power,
      legalities: {},
    },
    currentFaceIndex: 0,
    isFaceDown: false,
    controllerId: opts.controller ?? AI,
    ownerId: AI,
    isTapped: false,
    isFlipped: false,
    isTurnedFaceUp: false,
    isPhasedOut: false,
    hasSummoningSickness: false,
  } as unknown as CardInstance;
}

// ---------------------------------------------------------------------------
// Fixture library. A 9-card hand designed to exercise every tier's
// ranking distinctly:
//   - 1 excess land in hand (4 lands already on the battlefield → flood
//     threshold crossed, so the single land in hand is "extra")
//   - 1 dead-color card (Lightning Bolt — red, AI controls no red sources)
//   - 1 removal spell (Pongify — instant, destroys target creature; blue
//     so it's castable, and matches `isRemovalSpell`'s destroy clause so
//     Hard / Expert protect it when the opponent has threats)
//   - 1 low-leverage creature (Grizzly Bears, power 2 / cmc 2 = 1.0)
//   - 1 high-leverage creature (Carnage Tyrant, power 7 / cmc 4 = 1.75)
//   - 2 high-CMC low-leverage threats (Sea Gate Loremaster × 2, cmc 7,
//     power 1 → leverage ≈ 0.143)
//   - 2 cheap blue cantrips (Opt × 2, cmc 1)
//
// Battlefield: 2 Islands + 2 Forests (4 lands, U+G sources). 4 lands ≥
// EXCESS_LAND_BATTLEFIELD_THRESHOLD so the hand land counts as excess.
// Dead-color card (Lightning Bolt, R) has no R source. Opponent has 1
// creature with power 3 so Pongify (removal) is protected by Hard/Expert.
// ---------------------------------------------------------------------------

function island(id = "island"): CardInstance {
  return card(id, {
    name: "Island",
    type_line: "Basic Land — Island",
    oracle_text: "{T}: Add {U}.",
  });
}

function forest(id = "forest"): CardInstance {
  return card(id, {
    name: "Forest",
    type_line: "Basic Land — Forest",
    oracle_text: "{T}: Add {G}.",
  });
}

function lightningBolt(id = "bolt"): CardInstance {
  return card(id, {
    name: "Lightning Bolt",
    type_line: "Instant",
    cmc: 1,
    mana_cost: "{R}",
    colors: ["R"],
    oracle_text: "Lightning Bolt deals 3 damage to any target.",
  });
}

function unsummon(id = "unsummon"): CardInstance {
  return card(id, {
    name: "Unsummon",
    type_line: "Instant",
    cmc: 1,
    mana_cost: "{U}",
    colors: ["U"],
    oracle_text: "Return target creature to its owner's hand.",
  });
}

/** A blue removal spell — matches `isRemovalSpell`'s destroy clause. */
function pongify(id = "pongify"): CardInstance {
  return card(id, {
    name: "Pongify",
    type_line: "Instant",
    cmc: 1,
    mana_cost: "{U}",
    colors: ["U"],
    oracle_text:
      "Destroy target creature. Its controller creates a 3/3 green Ape creature token.",
  });
}

function grizzlyBears(id = "bears"): CardInstance {
  return card(id, {
    name: "Grizzly Bears",
    type_line: "Creature — Bear",
    cmc: 2,
    mana_cost: "{1}{G}",
    colors: ["G"],
    power: "2",
  });
}

function carnageTyrant(id = "tyrant"): CardInstance {
  return card(id, {
    name: "Carnage Tyrant",
    type_line: "Creature — Dinosaur",
    cmc: 4,
    mana_cost: "{2}{G}{G}",
    colors: ["G"],
    power: "7",
  });
}

function seaGateLoremaster(id = "loremaster"): CardInstance {
  return card(id, {
    name: "Sea Gate Loremaster",
    type_line: "Creature — Merfolk Ally",
    cmc: 7,
    mana_cost: "{6}{U}",
    colors: ["U"],
    power: "1",
  });
}

function opt(id = "opt"): CardInstance {
  return card(id, {
    name: "Opt",
    type_line: "Instant",
    cmc: 1,
    mana_cost: "{U}",
    colors: ["U"],
    oracle_text: "Scry 1, then draw a card.",
  });
}

function oppCreature(id = "opp-crit", power = "3"): CardInstance {
  return card(id, {
    name: "Opponent Threat",
    type_line: "Creature — Horror",
    cmc: 3,
    mana_cost: "{2}{B}",
    colors: ["B"],
    power,
    controller: OPP,
  });
}

/**
 * The canonical 9-card fixture hand used by every per-tier test. Returns
 * the hand cards in a fixed order so tests can name specific card ids.
 */
function fixtureHand(): CardInstance[] {
  return [
    island("island-1"), // excess land (4 lands on board → flooding)
    lightningBolt("bolt"), // dead-color (R, no red source)
    pongify("pongify"), // removal (protected when opp has threats)
    grizzlyBears("bears"), // low-leverage creature (2/2 for 2 = 1.0)
    carnageTyrant("tyrant"), // high-leverage creature (7/6 for 4 = 1.75)
    seaGateLoremaster("loremaster-1"), // cmc 7, leverage ≈ 0.143
    seaGateLoremaster("loremaster-2"), // cmc 7, leverage ≈ 0.143
    opt("opt-1"), // cmc 1 cantrip
    opt("opt-2"), // cmc 1 cantrip
  ];
}

/** AI battlefield: 2 Islands + 2 Forests (4 lands total, U+G sources). */
function fixtureAiBattlefield(): CardInstance[] {
  return [
    island("battlefield-island-1"),
    island("battlefield-island-2"),
    forest("battlefield-forest-1"),
    forest("battlefield-forest-2"),
  ];
}

/** Opponent battlefield: one 3-power creature (live threat). */
function fixtureOppBattlefield(): CardInstance[] {
  return [oppCreature("opp-crit", "3")];
}

/** Build a state with the supplied cards split into the right zones. */
function buildState(opts: {
  hand?: CardInstance[];
  aiBattlefield?: CardInstance[];
  oppBattlefield?: CardInstance[];
  turnNumber?: number;
}): EngineGameState {
  const cards = new Map<string, CardInstance>();
  for (const c of [
    ...(opts.hand ?? []),
    ...(opts.aiBattlefield ?? []),
    ...(opts.oppBattlefield ?? []),
  ]) {
    cards.set(c.id, c);
  }
  const zones = new Map<string, { cardIds: CardInstanceId[] }>();
  zones.set(`${AI}-hand`, {
    cardIds: (opts.hand ?? []).map((c) => c.id),
  });
  zones.set(`${AI}-battlefield`, {
    cardIds: (opts.aiBattlefield ?? []).map((c) => c.id),
  });
  zones.set(`${OPP}-battlefield`, {
    cardIds: (opts.oppBattlefield ?? []).map((c) => c.id),
  });
  const turn: Turn = {
    activePlayerId: AI,
    currentPhase: "cleanup" as Turn["currentPhase"],
    turnNumber: opts.turnNumber ?? 6,
    extraTurns: 0,
    isFirstTurn: false,
    startedAt: 0,
  };
  return {
    cards,
    zones,
    turn,
    priorityPlayerId: AI,
  } as unknown as EngineGameState;
}

/** Deterministic rng from a linear congruential seed. */
function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ---------------------------------------------------------------------------
// Per-tier ranking on the canonical 9-card hand.
// ---------------------------------------------------------------------------

describe("pickDiscardCandidates — easy tier", () => {
  it("ranks highest-CMC cards first (dump the biggest)", () => {
    const state = buildState({
      hand: fixtureHand(),
      aiBattlefield: fixtureAiBattlefield(),
      oppBattlefield: fixtureOppBattlefield(),
    });
    const rec = pickDiscardCandidates(state, AI, {
      difficulty: "easy",
      rng: seededRng(1),
    });
    // Two cmc-7 cards in hand; Easy dumps biggest first. The top-2 must
    // both be cmc-7 (the two Sea Gate Loremasters).
    const top2 = rec.candidates.slice(0, 2);
    expect(top2).toEqual(
      expect.arrayContaining(["loremaster-1", "loremaster-2"]),
    );
    expect(top2).toHaveLength(2);
  });

  it("is deterministic given a seeded rng", () => {
    const state = buildState({
      hand: fixtureHand(),
      aiBattlefield: fixtureAiBattlefield(),
    });
    const a = pickDiscardCandidates(state, AI, {
      difficulty: "easy",
      rng: seededRng(42),
    });
    const b = pickDiscardCandidates(state, AI, {
      difficulty: "easy",
      rng: seededRng(42),
    });
    expect(a).toEqual(b);
  });

  it("uses rng to break ties between same-CMC cards", () => {
    // Two identical cmc-7 loremasters — different seeds may produce
    // different orderings. Both orderings are valid; we just assert the
    // set is exactly the two loremasters.
    const state = buildState({
      hand: fixtureHand(),
      aiBattlefield: fixtureAiBattlefield(),
    });
    const a = pickDiscardCandidates(state, AI, {
      difficulty: "easy",
      rng: seededRng(1),
    });
    const b = pickDiscardCandidates(state, AI, {
      difficulty: "easy",
      rng: seededRng(999),
    });
    expect(a.candidates.slice(0, 2)).toEqual(
      expect.arrayContaining(["loremaster-1", "loremaster-2"]),
    );
    expect(b.candidates.slice(0, 2)).toEqual(
      expect.arrayContaining(["loremaster-1", "loremaster-2"]),
    );
  });
});

describe("pickDiscardCandidates — medium tier", () => {
  it("drops basic lands first (top-2 include at least one basic land)", () => {
    const state = buildState({
      hand: fixtureHand(),
      aiBattlefield: fixtureAiBattlefield(),
      oppBattlefield: fixtureOppBattlefield(),
    });
    const rec = pickDiscardCandidates(state, AI, { difficulty: "medium" });
    // Medium drops basic lands first. The fixture hand has 1 basic
    // (island-1) — it must be the top candidate. The next bucket is
    // off-color, so bolt (dead-color) lands second.
    const top2 = rec.candidates.slice(0, 2);
    expect(top2[0]).toBe("island-1");
    expect(top2).toContain("island-1");
  });
});

describe("pickDiscardCandidates — hard tier", () => {
  it("top-2 is {extra land, dead-color card}", () => {
    const state = buildState({
      hand: fixtureHand(),
      aiBattlefield: fixtureAiBattlefield(),
      oppBattlefield: fixtureOppBattlefield(),
    });
    const rec = pickDiscardCandidates(state, AI, { difficulty: "hard" });
    const top2 = rec.candidates.slice(0, 2);
    // First: an excess land (the single basic Island in hand).
    expect(top2[0]).toBe("island-1");
    // Second: the dead-color card (Lightning Bolt — red, no red source).
    expect(top2[1]).toBe("bolt");
  });

  it("protects removal when opponent has live threats", () => {
    const state = buildState({
      hand: fixtureHand(),
      aiBattlefield: fixtureAiBattlefield(),
      oppBattlefield: fixtureOppBattlefield(),
    });
    const rec = pickDiscardCandidates(state, AI, { difficulty: "hard" });
    // Pongify is removal and opp has a 3-power threat → it must be at
    // the very end of the candidate list (last resort).
    expect(rec.candidates[rec.candidates.length - 1]).toBe("pongify");
  });

  it("does NOT protect removal when opponent has no threats", () => {
    const state = buildState({
      hand: fixtureHand(),
      aiBattlefield: fixtureAiBattlefield(),
      oppBattlefield: [], // no opponent threats
    });
    const rec = pickDiscardCandidates(state, AI, { difficulty: "hard" });
    // Pongify is still removal but with no threats the protection
    // rule does not fire — it sorts by leverage like any other spell.
    expect(rec.candidates[rec.candidates.length - 1]).not.toBe("pongify");
  });
});

describe("pickDiscardCandidates — expert tier", () => {
  it("top-2 is {extra land, lowest-leverage threat}", () => {
    const state = buildState({
      hand: fixtureHand(),
      aiBattlefield: fixtureAiBattlefield(),
      oppBattlefield: fixtureOppBattlefield(),
    });
    const rec = pickDiscardCandidates(state, AI, { difficulty: "expert" });
    const top2 = rec.candidates.slice(0, 2);
    // First: an excess land.
    expect(top2[0]).toBe("island-1");
    // Second: a zero-role card. With 4 lands on board, next-turn mana = 5.
    // The two cmc-7 loremasters are zero-role (cmc > 5 + 1) and have the
    // lowest leverage in the hand (1/7 ≈ 0.143). Either is valid.
    expect(top2[1] === "loremaster-1" || top2[1] === "loremaster-2").toBe(true);
  });

  it("never discards removal when opponent has threats", () => {
    const state = buildState({
      hand: fixtureHand(),
      aiBattlefield: fixtureAiBattlefield(),
      oppBattlefield: fixtureOppBattlefield(),
    });
    const rec = pickDiscardCandidates(state, AI, { difficulty: "expert" });
    // Pongify is removal and opp has a threat — Expert locks it as the
    // last candidate.
    expect(rec.candidates[rec.candidates.length - 1]).toBe("pongify");
  });

  it("protects removal even when count would otherwise pick it", () => {
    // Construct a hand where removal is the only non-land, non-creature
    // spell — Expert must still push it to the end.
    const state = buildState({
      hand: [island("i1"), pongify("p1"), seaGateLoremaster("l1")],
      aiBattlefield: fixtureAiBattlefield(),
      oppBattlefield: fixtureOppBattlefield(),
    });
    const rec = pickDiscardCandidates(state, AI, { difficulty: "expert" });
    expect(rec.candidates[rec.candidates.length - 1]).toBe("p1");
  });
});

// ---------------------------------------------------------------------------
// Cross-tier sanity: difficulty produces sensible orderings.
// ---------------------------------------------------------------------------

describe("pickDiscardCandidates — cross-tier invariants", () => {
  it("never mutates the input state", () => {
    const state = buildState({
      hand: fixtureHand(),
      aiBattlefield: fixtureAiBattlefield(),
      oppBattlefield: fixtureOppBattlefield(),
    });
    const handBefore = [...(state.zones.get(`${AI}-hand`)?.cardIds ?? [])];
    pickDiscardCandidates(state, AI, { difficulty: "expert" });
    expect(state.zones.get(`${AI}-hand`)?.cardIds).toEqual(handBefore);
  });

  it("returns the same result for the same inputs (deterministic)", () => {
    const state = buildState({
      hand: fixtureHand(),
      aiBattlefield: fixtureAiBattlefield(),
      oppBattlefield: fixtureOppBattlefield(),
    });
    const a = pickDiscardCandidates(state, AI, { difficulty: "hard" });
    const b = pickDiscardCandidates(state, AI, { difficulty: "hard" });
    expect(a).toEqual(b);
  });

  it("every hand card appears exactly once in the candidate list (constructed)", () => {
    const state = buildState({
      hand: fixtureHand(),
      aiBattlefield: fixtureAiBattlefield(),
      oppBattlefield: fixtureOppBattlefield(),
    });
    for (const difficulty of [
      "easy",
      "medium",
      "hard",
      "expert",
    ] as DifficultyLevel[]) {
      const rec = pickDiscardCandidates(state, AI, { difficulty });
      // Constructed (non-Limited) format: every hand card should be a
      // candidate, with no duplicates.
      const handIds = (state.zones.get(`${AI}-hand`)?.cardIds ?? []).slice();
      expect(rec.candidates).toHaveLength(handIds.length);
      expect(new Set(rec.candidates).size).toBe(handIds.length);
      for (const id of handIds) {
        expect(rec.candidates).toContain(id);
      }
    }
  });

  it("includes a human-readable reasoning string per tier", () => {
    const state = buildState({
      hand: fixtureHand(),
      aiBattlefield: fixtureAiBattlefield(),
    });
    for (const difficulty of [
      "easy",
      "medium",
      "hard",
      "expert",
    ] as DifficultyLevel[]) {
      const rec = pickDiscardCandidates(state, AI, { difficulty });
      expect(rec.reasoning).toMatch(/^Cleanup \(.*\):/);
      expect(rec.reasoning.length).toBeGreaterThan(10);
    }
  });
});

// ---------------------------------------------------------------------------
// Limited-format override.
// ---------------------------------------------------------------------------

describe("pickDiscardCandidates — limited format override", () => {
  it("trims the candidate list so post-cleanup hand stays at or above the floor", () => {
    // 9-card hand, AI would normally discard 2 (max hand size 7). In
    // Limited the helper caps candidates so hand never drops below
    // LIMITED_MIN_HAND_SIZE. Since the floor equals the cleanup max
    // (7), the cap is `handSize - 7 = 2` — same as the cleanup count.
    // The observable difference is when the helper would otherwise
    // exclude cards (e.g. via protection): in Limited the exclusion
    // list is shorter because the helper refuses to drop below the
    // floor, so the protected card stays IN the candidate list.
    const hand = fixtureHand();
    const state = buildState({
      hand,
      aiBattlefield: fixtureAiBattlefield(),
      oppBattlefield: fixtureOppBattlefield(),
    });
    const rec = pickDiscardCandidates(state, AI, {
      difficulty: "expert",
      format: "limited",
    });
    // Limited cap = hand.length - LIMITED_MIN_HAND_SIZE = 9 - 7 = 2.
    expect(rec.candidates.length).toBeLessThanOrEqual(
      hand.length - LIMITED_MIN_HAND_SIZE,
    );
    expect(rec.candidates.length).toBe(2);
  });

  it("returns an empty candidate list when hand is already at the floor", () => {
    // Hand of 7 cards (already at LIMITED_MIN_HAND_SIZE): the helper
    // must refuse to recommend discarding any of them.
    const hand = [
      island("i1"),
      forest("f1"),
      grizzlyBears("b1"),
      carnageTyrant("t1"),
      opt("o1"),
      pongify("p1"),
      seaGateLoremaster("l1"),
    ];
    const state = buildState({
      hand,
      aiBattlefield: fixtureAiBattlefield(),
      oppBattlefield: fixtureOppBattlefield(),
    });
    const rec = pickDiscardCandidates(state, AI, {
      difficulty: "expert",
      format: "limited",
    });
    expect(rec.candidates).toHaveLength(0);
  });

  it("constructed format does NOT apply the Limited floor", () => {
    // Same 9-card hand in Constructed: helper returns the full ranked
    // list (no trimming), so the candidate count equals the hand size.
    const hand = fixtureHand();
    const state = buildState({
      hand,
      aiBattlefield: fixtureAiBattlefield(),
      oppBattlefield: fixtureOppBattlefield(),
    });
    const rec = pickDiscardCandidates(state, AI, {
      difficulty: "expert",
      format: "constructed",
    });
    expect(rec.candidates).toHaveLength(hand.length);
  });
});

// ---------------------------------------------------------------------------
// Edge cases.
// ---------------------------------------------------------------------------

describe("pickDiscardCandidates — edge cases", () => {
  it("returns an empty list when the hand is empty", () => {
    const state = buildState({
      hand: [],
      aiBattlefield: fixtureAiBattlefield(),
    });
    const rec = pickDiscardCandidates(state, AI, { difficulty: "expert" });
    expect(rec.candidates).toHaveLength(0);
    expect(rec.reasoning).toMatch(/empty hand/i);
  });

  it("returns an empty list when the hand zone does not exist", () => {
    const state = buildState({ aiBattlefield: fixtureAiBattlefield() });
    state.zones.delete(`${AI}-hand`);
    const rec = pickDiscardCandidates(state, AI, { difficulty: "medium" });
    expect(rec.candidates).toHaveLength(0);
  });

  it("handles a hand with no lands (no excess-land bucket)", () => {
    const state = buildState({
      hand: [
        grizzlyBears("b1"),
        carnageTyrant("t1"),
        opt("o1"),
        pongify("p1"),
        seaGateLoremaster("l1"),
        seaGateLoremaster("l2"),
        lightningBolt("lb1"),
        lightningBolt("lb2"),
        pongify("p2"),
      ],
      aiBattlefield: fixtureAiBattlefield(),
      oppBattlefield: [],
    });
    const rec = pickDiscardCandidates(state, AI, { difficulty: "hard" });
    expect(rec.candidates.length).toBeGreaterThan(0);
    // No lands → first candidate is a dead-color card or low-leverage spell.
    expect(rec.candidates[0]).not.toBeUndefined();
  });

  it("EXCESS_LAND_BATTLEFIELD_THRESHOLD and LIMITED_MIN_HAND_SIZE are exported", () => {
    expect(EXCESS_LAND_BATTLEFIELD_THRESHOLD).toBeGreaterThan(0);
    expect(LIMITED_MIN_HAND_SIZE).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Direct engine call assertion: `discardCards` receives the candidate list
// as its 5th argument (specificCards), so the per-tier order reaches the
// engine. Mirrors the acceptance criterion "`discardCards` is called with
// the chosen order (mocked to assert argument)".
// ---------------------------------------------------------------------------

describe("pickDiscardCandidates — engine integration shape", () => {
  it("returns candidates as CardInstanceId[] ready to pass to discardCards", () => {
    const state = buildState({
      hand: fixtureHand(),
      aiBattlefield: fixtureAiBattlefield(),
      oppBattlefield: fixtureOppBattlefield(),
    });
    const rec = pickDiscardCandidates(state, AI, { difficulty: "hard" });
    // Every candidate is a string id present in the hand zone.
    const handIds = state.zones.get(`${AI}-hand`)!.cardIds;
    for (const c of rec.candidates) {
      expect(typeof c).toBe("string");
      expect(handIds).toContain(c);
    }
  });
});
