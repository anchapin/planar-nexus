/**
 * manamind#96: compare two checkpoints' root priors on the same position.
 */

import { comparePriors, summarizePriors } from "../prior-compare";

const c = (index: number, prior: number) => ({ action: { index }, prior });

describe("prior compare", () => {
  it("scores identical priors as the same", () => {
    const p = [c(0, 0.7), c(1, 0.2), c(2, 0.1)];
    const r = comparePriors({
      kind: "priority",
      candidateToAct: true,
      a: p,
      b: p,
    });
    expect(r.agree).toBe(true);
    expect(r.tv).toBeCloseTo(0, 9);
    expect(r.top3Overlap).toBe(1);
    expect(r.entropyA).toBeCloseTo(r.entropyB, 9);
    expect(r.top1A).toBeCloseTo(0.7, 9);
    expect(r.bOnTopA).toBeCloseTo(0.7, 9);
  });

  it("measures a flatter prior with a different top action", () => {
    const r = comparePriors({
      kind: "attack",
      candidateToAct: false,
      a: [c(0, 0.9), c(1, 0.1)],
      b: [c(0, 0.3), c(1, 0.35), c(2, 0.35)],
    });
    expect(r.actions).toBe(3);
    expect(r.agree).toBe(false);
    expect(r.entropyB).toBeGreaterThan(r.entropyA);
    expect(r.bOnTopA).toBeCloseTo(0.3, 9);
    // |0.9-0.3| + |0.1-0.35| + |0-0.35| = 1.2, halved.
    expect(r.tv).toBeCloseTo(0.6, 9);
    expect(r.top3Overlap).toBeCloseTo(2 / 3, 9);
  });

  it("summarizes per kind and skips single-action positions", () => {
    const one = [c(0, 1)];
    const two = [c(0, 0.5), c(1, 0.5)];
    const rows = [
      comparePriors({ kind: "priority", candidateToAct: true, a: one, b: one }),
      comparePriors({ kind: "priority", candidateToAct: true, a: two, b: two }),
      comparePriors({ kind: "block", candidateToAct: false, a: two, b: two }),
    ];
    const s = summarizePriors(rows);
    expect(s.map((x) => [x.kind, x.positions])).toEqual([
      ["all", 2],
      ["priority", 1],
      ["block", 1],
    ]);
    expect(s[0].agree).toBe(1);
    expect(summarizePriors([])).toEqual([
      expect.objectContaining({ kind: "all", positions: 0 }),
    ]);
  });
});
