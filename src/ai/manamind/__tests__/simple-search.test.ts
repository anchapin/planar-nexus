/**
 * @jest-environment ./src/ai/manamind/__tests__/onnx-node-environment.cjs
 *
 * Gumbel search parity with manamind's Python agent (#2573).
 *
 * `simple_v1_search.json` is recorded by manamind's
 * `scripts/export_host_fixtures.py --search-sims 10,40` with the shipped
 * model (seed0_settle iter 45): six seeded games, and on every third real
 * decision (up to 12 per game) `MCTSAgent(search="gumbel")` was run on the
 * mover's observation at 10 and 40 simulations, the Hard and Expert
 * settings. The port must choose the same move and produce the same
 * completed-Q policy at each of those 72 decisions.
 */

import { readFileSync } from "fs";
import path from "path";
import * as ortNode from "onnxruntime-node";

import fixture from "./fixtures/simple_v1_search.json";
import {
  createSimplePolicyModel,
  type OrtLike,
  type SimplePolicyModel,
} from "../simple-model";
import {
  applySimpleMove,
  createSimpleGameFromDeal,
  HIDDEN_CARD_NAME,
  observeSimpleState,
  simpleLegalMoves,
} from "../simple-rules";
import { gumbelSearch, searchPriors } from "../simple-search";
import { legalPriors, type SimpleModelSchema } from "../simple-observation";

const MODEL_DIR = path.join(process.cwd(), "public/models/manamind/simple-v1");
const ort = ortNode as unknown as OrtLike;
const schema = JSON.parse(
  readFileSync(path.join(MODEL_DIR, "model.schema.json"), "utf8"),
) as SimpleModelSchema;
const modelBytes = new Uint8Array(
  readFileSync(path.join(MODEL_DIR, "model.onnx")),
);

interface SearchRecord {
  sims: number;
  chosen: number;
  policy: number[];
}
interface Step {
  priority: number;
  chosen: number;
  search?: SearchRecord[];
}
interface Game {
  seed: number;
  deal: { hand: string[]; library: string[] }[];
  steps: Step[];
}
const games = (fixture as unknown as { games: Game[] }).games;

let model: SimplePolicyModel;
beforeAll(async () => {
  model = await createSimplePolicyModel(ort, modelBytes, schema);
});

describe("observeSimpleState", () => {
  it("hides both libraries and the opponent's hand, keeping sizes", () => {
    const state = createSimpleGameFromDeal(games[0].deal);
    const seen = observeSimpleState(state, 0);
    expect(seen.players[0].hand).toEqual(state.players[0].hand);
    for (const p of [0, 1] as const) {
      expect(seen.players[p].library).toHaveLength(
        state.players[p].library.length,
      );
      expect(
        seen.players[p].library.every((c) => c.name === HIDDEN_CARD_NAME),
      ).toBe(true);
    }
    expect(seen.players[1].hand).toHaveLength(state.players[1].hand.length);
    expect(seen.players[1].hand.every((c) => c.name === HIDDEN_CARD_NAME)).toBe(
      true,
    );
    // The original is untouched.
    expect(state.players[0].library[0].name).not.toBe(HIDDEN_CARD_NAME);
  });

  it("never offers a hidden card as a move", () => {
    const state = createSimpleGameFromDeal(games[0].deal);
    // Player 0's view, with player 1 (whose hand is hidden) to move.
    const seen = observeSimpleState(state, 0);
    seen.priorityPlayer = 1;
    seen.activePlayer = 1;
    seen.players[1].battlefield = [];
    expect(simpleLegalMoves(seen).map((m) => m.type)).toEqual([
      "pass_priority",
    ]);
  });
});

describe("searchPriors", () => {
  it("is legalPriors with a quarter spread evenly", () => {
    const state = createSimpleGameFromDeal(games[0].deal);
    const legal = simpleLegalMoves(state);
    const logits = schema.actions.map((_, i) => Math.sin(i));
    const base = legalPriors(logits, legal, schema.actions);
    searchPriors(logits, legal, schema.actions).forEach((p, i) =>
      expect(p).toBeCloseTo(0.75 * base[i] + 0.25 / legal.length, 10),
    );
  });
});

describe("gumbelSearch: parity with manamind's MCTSAgent", () => {
  it("covers both settings and positions with more than two moves", () => {
    const records = games.flatMap((g) =>
      g.steps.flatMap((s) => (s.search ?? []).map((r) => ({ s, r }))),
    );
    expect(records.length).toBe(144);
    expect(new Set(records.map(({ r }) => r.sims))).toEqual(new Set([10, 40]));
    expect(records.some(({ r }) => r.policy.length > 2)).toBe(true);
  });

  it.each(games.map((g) => [g.seed, g] as const))(
    "seed %i: same moves and search policy at 10 and 40 simulations",
    async (_seed, game) => {
      let state = createSimpleGameFromDeal(game.deal);
      for (const [i, step] of game.steps.entries()) {
        const legal = simpleLegalMoves(state);
        for (const record of step.search ?? []) {
          const where = `seed ${game.seed} step ${i} sims ${record.sims}`;
          const seen = observeSimpleState(state, state.priorityPlayer);
          const result = await gumbelSearch(seen, model, {
            simulations: record.sims,
          });
          expect({ where, chosen: result.index }).toEqual({
            where,
            chosen: record.chosen,
          });
          expect(result.policy).toHaveLength(legal.length);
          result.policy.forEach((p, j) =>
            expect(Math.abs(p - record.policy[j])).toBeLessThan(1e-5),
          );
        }
        state = applySimpleMove(state, legal[step.chosen]);
      }
    },
    60_000,
  );
});
