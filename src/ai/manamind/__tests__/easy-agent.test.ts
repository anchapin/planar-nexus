/**
 * Easy manamind opponent (#2557): temperature sampling over the policy
 * priors, matching manamind's `OnnxPolicyAgent`.
 */

import fixture from "./fixtures/simple_v1_replays.json";
import {
  chooseEasyMove,
  EASY_TEMPERATURE,
  samplePriorIndex,
} from "../easy-agent";
import {
  createSimpleGameFromDeal,
  applySimpleMove,
  simpleLegalMoves,
} from "../simple-rules";
import { SIMPLE_V1_ACTIONS } from "../simple-observation";
import type { SimplePolicyModel } from "../simple-model";

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const schema = {
  schema_version: "simple-v1",
  observation_dim: 25,
  actions: [...SIMPLE_V1_ACTIONS],
};

function fakeModel(logits: number[]): SimplePolicyModel & { calls: number } {
  const model = {
    schema,
    calls: 0,
    async evaluate() {
      model.calls++;
      return { logits: Float32Array.from(logits), value: 0.25 };
    },
  };
  return model;
}

describe("samplePriorIndex", () => {
  it("is greedy at temperature 0 and keeps the first maximum", () => {
    expect(samplePriorIndex([0.2, 0.4, 0.4], 0, () => 0.99)).toBe(1);
  });

  it("samples in proportion to the priors at temperature 1", () => {
    const random = seeded(7);
    const counts = [0, 0, 0];
    for (let i = 0; i < 20000; i++) {
      counts[samplePriorIndex([0.6, 0.3, 0.1], 1, random)]++;
    }
    expect(counts[0] / 20000).toBeCloseTo(0.6, 1);
    expect(counts[1] / 20000).toBeCloseTo(0.3, 1);
    expect(counts[2] / 20000).toBeCloseTo(0.1, 1);
  });

  it("sharpens toward the favourite as temperature drops", () => {
    // priors ** 2 = [0.81, 0.01] -> the favourite takes ~98.8%.
    const random = seeded(3);
    let favourite = 0;
    for (let i = 0; i < 5000; i++) {
      if (samplePriorIndex([0.9, 0.1], 0.5, random) === 0) favourite++;
    }
    expect(favourite / 5000).toBeGreaterThan(0.97);
  });

  it("maps the edges of the random draw onto the first and last moves", () => {
    expect(samplePriorIndex([0.5, 0.5], 1, () => 0)).toBe(0);
    expect(samplePriorIndex([0.5, 0.5], 1, () => 0.999999)).toBe(1);
  });
});

describe("chooseEasyMove", () => {
  it("defaults to temperature 1.0", () => {
    expect(EASY_TEMPERATURE).toBe(1.0);
  });

  it("returns a forced move without evaluating the model", async () => {
    const game = (
      fixture as {
        games: Array<{ deal: { hand: string[]; library: string[] }[] }>;
      }
    ).games[0];
    let state = createSimpleGameFromDeal(game.deal);
    // Walk until the mover has exactly one legal move.
    const random = seeded(11);
    for (let i = 0; i < 500 && simpleLegalMoves(state).length !== 1; i++) {
      const legal = simpleLegalMoves(state);
      state = applySimpleMove(
        state,
        legal[Math.floor(random() * legal.length)],
      );
    }
    expect(simpleLegalMoves(state)).toHaveLength(1);
    const model = fakeModel(new Array(SIMPLE_V1_ACTIONS.length).fill(0));
    const decision = await chooseEasyMove(state, model, random);
    expect(model.calls).toBe(0);
    expect(decision.priors).toBeNull();
    expect(decision.move).toEqual(simpleLegalMoves(state)[0]);
  });

  it("uses the model's priors on the fixture's first decision", async () => {
    const game = (
      fixture as unknown as {
        games: Array<{
          deal: { hand: string[]; library: string[] }[];
          steps: Array<{ logits?: number[]; priors?: number[] }>;
        }>;
      }
    ).games[0];
    const step = game.steps[0];
    const state = createSimpleGameFromDeal(game.deal);
    const model = fakeModel(step.logits as number[]);
    const decision = await chooseEasyMove(state, model, () => 0);
    expect(model.calls).toBe(1);
    expect(decision.value).toBe(0.25);
    (step.priors as number[]).forEach((p, i) => {
      expect((decision.priors as number[])[i]).toBeCloseTo(p, 4);
    });
    expect(decision.move).toEqual(simpleLegalMoves(state)[0]);
  });
});
