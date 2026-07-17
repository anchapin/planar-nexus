import { describe, it, expect } from "@jest/globals";
import {
  mulberry32,
  createRng,
  shuffle,
  buildSimulationDeck,
  decideKeep,
  defaultLandBounds,
  simulateOpening,
  simulateTurns,
  onCurveCastable,
  runGoldfishSimulation,
  formatGoldfishSummary,
  type SimCard,
} from "../goldfish-simulator";
import type { DeckCard } from "@/app/actions";

/** Build a deck of `lands` land slots + `spells` spell slots for deterministic tests. */
function makeDeckCard(
  name: string,
  cmc: number,
  isLand: boolean,
  count: number,
): DeckCard {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    cmc,
    type_line: isLand ? "Land" : `Creature — ${name}`,
    colors: [],
    color_identity: [],
    legalities: {},
    count,
  } as unknown as DeckCard;
}

function deckOf(lands: number, spells: number, spellCmc = 2): DeckCard[] {
  return [
    makeDeckCard("Mountain", 0, true, lands),
    makeDeckCard("Bear", spellCmc, false, spells),
  ];
}

const describeKeep = describe;

describe("mulberry32 / createRng", () => {
  it("is deterministic for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 5 }, a);
    const seqB = Array.from({ length: 5 }, b);
    expect(seqA).toEqual(seqB);
  });

  it("differs for different seeds", () => {
    const a = Array.from({ length: 5 }, mulberry32(1));
    const b = Array.from({ length: 5 }, mulberry32(2));
    expect(a).not.toEqual(b);
  });

  it("produces values in [0, 1)", () => {
    const rng = mulberry32(12345);
    const samples = Array.from({ length: 100 }, rng);
    expect(samples.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it("createRng falls back to Math.random when no seed", () => {
    expect(createRng()).toBe(Math.random);
    expect(typeof createRng(7)()).toBe("number");
  });
});

describe("shuffle", () => {
  it("returns a permutation without mutating the input", () => {
    const input = [1, 2, 3, 4, 5];
    const copy = input.slice();
    const out = shuffle(input, mulberry32(1));
    expect(input).toEqual(copy);
    expect(out.slice().sort()).toEqual(copy);
  });

  it("is deterministic for a fixed seed", () => {
    const arr = ["a", "b", "c", "d", "e", "f", "g", "h"];
    expect(shuffle(arr, mulberry32(99))).toEqual(shuffle(arr, mulberry32(99)));
  });

  it("preserves all elements", () => {
    const arr = Array.from({ length: 20 }, (_, i) => i);
    const out = shuffle(arr, mulberry32(5));
    expect(out.length).toBe(20);
    expect(new Set(out).size).toBe(20);
  });
});

describe("buildSimulationDeck", () => {
  it("flattens counts into one slot per physical card", () => {
    const deck = deckOf(14, 20);
    const sim = buildSimulationDeck(deck);
    expect(sim.length).toBe(34);
    expect(sim.filter((c) => c.isLand).length).toBe(14);
    expect(sim.filter((c) => !c.isLand).length).toBe(20);
  });

  it("classifies lands by type_line and copies cmc/colors", () => {
    const deck = [
      makeDeckCard("Island", 0, true, 2),
      makeDeckCard("Lightning Bolt", 1, false, 3),
    ];
    const sim = buildSimulationDeck(deck);
    expect(sim[0]).toMatchObject({ name: "Island", isLand: true, cmc: 0 });
    expect(sim[2]).toMatchObject({
      name: "Lightning Bolt",
      isLand: false,
      cmc: 1,
    });
  });

  it("optionally includes the sideboard pool", () => {
    const main = deckOf(2, 2);
    const board = deckOf(1, 1);
    expect(buildSimulationDeck(main, board, false).length).toBe(4);
    expect(buildSimulationDeck(main, board, true).length).toBe(6);
  });

  it("ignores zero/negative counts", () => {
    const weird = [{ ...makeDeckCard("X", 1, false, 0), count: 0 }];
    expect(buildSimulationDeck(weird)).toEqual([]);
  });
});

describeKeep("decideKeep / defaultLandBounds", () => {
  const land = (n: number): SimCard[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `l${i}`,
      name: "L",
      cmc: 0,
      isLand: true,
      typeLine: "Land",
      colors: [],
    }));
  const spell = (n: number): SimCard[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `s${i}`,
      name: "S",
      cmc: 2,
      isLand: false,
      typeLine: "Creature",
      colors: [],
    }));

  it("scales keepable bounds with hand size", () => {
    expect(defaultLandBounds(7)).toEqual({ minLands: 2, maxLands: 5 });
    expect(defaultLandBounds(5)).toEqual({ minLands: 1, maxLands: 4 });
  });

  it("rejects land-starved and land-flooded 7-card hands", () => {
    expect(decideKeep([...land(1), ...spell(6)])).toBe(false);
    expect(decideKeep([...land(0), ...spell(7)])).toBe(false);
    expect(decideKeep([...land(6), ...spell(1)])).toBe(false);
  });

  it("keeps a reasonable 2-land/3-land/4-land 7-card opener", () => {
    expect(decideKeep([...land(2), ...spell(5)])).toBe(true);
    expect(decideKeep([...land(3), ...spell(4)])).toBe(true);
    expect(decideKeep([...land(4), ...spell(3)])).toBe(true);
  });

  it("honors explicit policy overrides", () => {
    const hand = [...land(5), ...spell(2)];
    expect(decideKeep(hand)).toBe(true);
    expect(decideKeep(hand, { maxLands: 4 })).toBe(false);
    expect(decideKeep([...land(2), ...spell(5)], { minLands: 3 })).toBe(false);
  });
});

describe("simulateOpening", () => {
  it("keeps a keepable hand with no mulligan", () => {
    const sim = buildSimulationDeck(deckOf(24, 36));
    const opening = simulateOpening(sim, { rng: mulberry32(1) });
    expect(opening.mulligansTaken).toBeGreaterThanOrEqual(0);
    expect(opening.hand.length).toBeLessThanOrEqual(7);
    expect(opening.openingLands).toBe(
      opening.hand.filter((c) => c.isLand).length,
    );
  });

  it("mulligans down to minHandSize when no hand is keepable", () => {
    const sim = buildSimulationDeck(deckOf(24, 36));
    const opening = simulateOpening(sim, {
      rng: mulberry32(1),
      minHandSize: 5,
      mulligan: { minLands: 99, maxLands: 99, minSpells: 99 },
    });
    expect(opening.handSize).toBe(5);
    expect(opening.mulligansTaken).toBe(2);
  });

  it("never mulligans below minHandSize", () => {
    const sim = buildSimulationDeck(deckOf(24, 36));
    const opening = simulateOpening(sim, {
      rng: mulberry32(3),
      minHandSize: 6,
      mulligan: { minLands: 99, maxLands: 99 },
    });
    expect(opening.handSize).toBeGreaterThanOrEqual(6);
  });

  it("exposes the remaining library from the same shuffle", () => {
    const sim = buildSimulationDeck(deckOf(20, 20));
    const opening = simulateOpening(sim, { rng: mulberry32(2) });
    expect(opening.library.length).toBe(sim.length);
    expect(opening.library.slice(0, opening.hand.length)).toEqual(opening.hand);
  });
});

describe("simulateTurns", () => {
  function crafted(
    landInHand: number,
    drawPile: SimCard[],
  ): {
    hand: SimCard[];
    library: SimCard[];
  } {
    const hand: SimCard[] = Array.from({ length: landInHand }, (_, i) => ({
      id: `h${i}`,
      name: "L",
      cmc: 0,
      isLand: true,
      typeLine: "Land",
      colors: [],
    }));
    return { hand, library: [...hand, ...drawPile] };
  }
  const land = (id: string): SimCard => ({
    id,
    name: "L",
    cmc: 0,
    isLand: true,
    typeLine: "Land",
    colors: [],
  });
  const spell = (id: string): SimCard => ({
    id,
    name: "S",
    cmc: 2,
    isLand: false,
    typeLine: "Creature",
    colors: [],
  });

  it("accumulates one land per turn on the play (skips T1 draw)", () => {
    const { hand, library } = crafted(1, [land("d1"), land("d2"), land("d3")]);
    const result = simulateTurns(
      {
        hand,
        library,
        handSize: hand.length,
        mulligansTaken: 0,
        openingLands: 1,
      },
      { turns: 4, onThePlay: true },
    );
    expect(result.landsByTurn).toEqual([1, 2, 3, 4]);
    expect(result.drewCards).toBe(3);
  });

  it("draws on turn 1 when on the draw (one extra land drop vs. on the play)", () => {
    const { hand, library } = crafted(1, [
      land("d1"),
      land("d2"),
      spell("d3"),
      spell("d4"),
    ]);
    const result = simulateTurns(
      {
        hand,
        library,
        handSize: hand.length,
        mulligansTaken: 0,
        openingLands: 1,
      },
      { turns: 4, onThePlay: false },
    );
    expect(result.landsByTurn).toEqual([1, 2, 3, 3]);
    expect(result.drewCards).toBe(4);
  });

  it("stops making land drops once the hand runs out of lands", () => {
    const { hand, library } = crafted(2, [
      spell("d1"),
      spell("d2"),
      spell("d3"),
    ]);
    const result = simulateTurns(
      {
        hand,
        library,
        handSize: hand.length,
        mulligansTaken: 0,
        openingLands: 2,
      },
      { turns: 5, onThePlay: true },
    );
    expect(result.landsByTurn).toEqual([1, 2, 2, 2, 2]);
    expect(result.drewCards).toBe(3);
  });
});

describe("onCurveCastable", () => {
  it("treats N lands by turn N as on-curve for a CMC-N spell", () => {
    expect(onCurveCastable([1, 2, 3, 4], 2)).toBe(true);
    expect(onCurveCastable([1, 1, 2, 3], 2)).toBe(false);
    expect(onCurveCastable([2, 3, 4], 3)).toBe(true);
  });

  it("returns false for CMCs beyond the simulated turn count", () => {
    expect(onCurveCastable([1, 2], 3)).toBe(false);
    expect(onCurveCastable([1, 2], 0)).toBe(false);
  });
});

describe("runGoldfishSimulation", () => {
  const sim = buildSimulationDeck(deckOf(24, 36, 2));

  it("throws when the deck cannot fill an opening hand", () => {
    const tiny = buildSimulationDeck([makeDeckCard("L", 0, true, 3)]);
    expect(() =>
      runGoldfishSimulation(tiny, { seed: 1, iterations: 5 }),
    ).toThrow(/Cannot simulate/);
  });

  it("is fully deterministic for a fixed seed", () => {
    const a = runGoldfishSimulation(sim, { seed: 1234, iterations: 50 });
    const b = runGoldfishSimulation(sim, { seed: 1234, iterations: 50 });
    expect(a.avgOpeningLands).toBe(b.avgOpeningLands);
    expect(a.landHistogram).toEqual(b.landHistogram);
    expect(a.avgLandsByTurn).toEqual(b.avgLandsByTurn);
    expect(a.onCurveCastPercent).toEqual(b.onCurveCastPercent);
    expect(a.sampleHand.map((c) => c.id)).toEqual(
      b.sampleHand.map((c) => c.id),
    );
  });

  it("aggregates land counts, histogram, and mulligan rate correctly", () => {
    const stats = runGoldfishSimulation(sim, { seed: 7, iterations: 200 });
    const histogramTotal = stats.landHistogram.reduce((s, n) => s + n, 0);
    expect(histogramTotal).toBe(200);
    expect(stats.avgOpeningLands).toBeGreaterThan(0);
    expect(stats.avgOpeningLands).toBeLessThan(7);
    expect(stats.mulliganRate).toBeGreaterThanOrEqual(0);
    expect(stats.mulliganRate).toBeLessThanOrEqual(1);
    expect(stats.keepAtSevenRate + stats.mulliganRate).toBeCloseTo(1, 5);
  });

  it("reports avgLandsByTurn as a non-decreasing average curve", () => {
    const stats = runGoldfishSimulation(sim, {
      seed: 9,
      iterations: 100,
      turns: 5,
    });
    expect(stats.avgLandsByTurn.length).toBe(5);
    for (let i = 1; i < stats.avgLandsByTurn.length; i++) {
      expect(stats.avgLandsByTurn[i]).toBeGreaterThanOrEqual(
        stats.avgLandsByTurn[i - 1],
      );
    }
  });

  it("on-curve percentage decreases as CMC increases", () => {
    const stats = runGoldfishSimulation(sim, {
      seed: 11,
      iterations: 200,
      turns: 6,
    });
    const p1 = stats.onCurveCastPercent[1];
    const p4 = stats.onCurveCastPercent[4];
    expect(p1).toBeGreaterThanOrEqual(p4);
    expect(p1).toBeGreaterThan(0);
    expect(p4).toBeLessThanOrEqual(100);
  });

  it("tracks final hand-size distribution and sample hand", () => {
    const stats = runGoldfishSimulation(sim, { seed: 13, iterations: 50 });
    const distributed = stats.finalHandSizeCounts.reduce(
      (s, n) => s + (n ?? 0),
      0,
    );
    expect(distributed).toBe(50);
    expect(stats.sampleHand.length).toBeGreaterThan(0);
  });
});

describe("formatGoldfishSummary", () => {
  it("includes the key metrics in a copyable plain-text block", () => {
    const stats = runGoldfishSimulation(buildSimulationDeck(deckOf(24, 36)), {
      seed: 1,
      iterations: 20,
    });
    const text = formatGoldfishSummary(stats);
    expect(text).toContain("Goldfish simulation");
    expect(text).toContain("Opening lands");
    expect(text).toContain("Mulligan rate");
    expect(text).toContain("On-curve castable");
    expect(text).toContain("histogram");
  });
});
