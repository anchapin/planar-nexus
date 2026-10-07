/**
 * The four simple-mode opponents (#2573). Search parity with manamind is
 * checked in simple-search.test.ts; this covers how a tier picks its path.
 */

import {
  createSimpleGameFromDeal,
  simpleLegalMoves,
  type SimpleGameState,
} from "../simple-rules";
import type { SimplePolicyModel } from "../simple-model";
import {
  chooseTierMove,
  SIMPLE_TIER_ORDER,
  SIMPLE_TIERS,
} from "../simple-tiers";

const hand = ["Forest", "Forest", "Grizzly Bears", "Hill Giant"];
const library = Array.from({ length: 20 }, () => "Forest");

function fakeModel(): SimplePolicyModel & { evaluate: jest.Mock } {
  return {
    schema: {
      schema_version: "simple-v1",
      observation_dim: 25,
      actions: [],
    },
    evaluate: jest.fn(async () => ({ logits: new Float32Array(23), value: 0 })),
  } as unknown as SimplePolicyModel & { evaluate: jest.Mock };
}

function opening(): SimpleGameState {
  return createSimpleGameFromDeal([
    { hand, library },
    { hand, library },
  ]);
}

describe("SIMPLE_TIERS", () => {
  it("keeps the measured settings from manamind decision #46", () => {
    expect(SIMPLE_TIER_ORDER).toEqual(["easy", "medium", "hard", "expert"]);
    expect(
      SIMPLE_TIER_ORDER.map((t) => [
        SIMPLE_TIERS[t].simulations,
        SIMPLE_TIERS[t].blunderRate,
      ]),
    ).toEqual([
      [0, 0],
      [10, 0.25],
      [10, 0],
      [40, 0],
    ]);
  });
});

describe("chooseTierMove", () => {
  it("plays a forced move without asking the model", async () => {
    const state = opening();
    state.phase = "end";
    const model = fakeModel();
    const legal = simpleLegalMoves(state);
    expect(legal).toHaveLength(1);
    const decision = await chooseTierMove(state, model, "expert");
    expect(decision).toEqual({ move: legal[0], source: "forced" });
    expect(model.evaluate).not.toHaveBeenCalled();
  });

  it("Medium blunders to a uniform random legal move", async () => {
    const state = opening();
    const model = fakeModel();
    const draws = [0.1, 0.99];
    const decision = await chooseTierMove(
      state,
      model,
      "medium",
      () => draws.shift() as number,
    );
    const legal = simpleLegalMoves(state);
    expect(decision).toEqual({
      move: legal[legal.length - 1],
      source: "blunder",
    });
    expect(model.evaluate).not.toHaveBeenCalled();
  });

  it("Medium searches when it doesn't blunder", async () => {
    const model = fakeModel();
    const decision = await chooseTierMove(
      opening(),
      model,
      "medium",
      () => 0.5,
    );
    expect(decision.source).toBe("search");
  });

  it("Easy plays from the policy and Expert searches", async () => {
    const easy = fakeModel();
    expect(
      (await chooseTierMove(opening(), easy, "easy", () => 0.5)).source,
    ).toBe("policy");
    expect(easy.evaluate).toHaveBeenCalledTimes(1);
    const expert = fakeModel();
    expect((await chooseTierMove(opening(), expert, "expert")).source).toBe(
      "search",
    );
    expect(expert.evaluate.mock.calls.length).toBeGreaterThan(1);
  });
});
