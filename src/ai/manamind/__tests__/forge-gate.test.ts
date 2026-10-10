/**
 * @jest-environment ./src/ai/manamind/__tests__/onnx-node-environment.cjs
 *
 * manamind#87 step 3: head-to-head gate between two checkpoints.
 */

import { readFileSync } from "fs";
import path from "path";
import * as ortNode from "onnxruntime-node";

import {
  createForgePointerModel,
  type ForgeOrtLike,
  type ForgePointerModel,
} from "../forge-pointer-model";
import {
  gateSummary,
  playGateGame,
  wilson,
  type GateGame,
} from "../forge-gate";
import { trainingDeck } from "@/ai/simulation/training-session";

const MODEL = path.join(__dirname, "fixtures/forge_pointer_v1_seed86.onnx");

let model: ForgePointerModel;
beforeAll(async () => {
  model = await createForgePointerModel(
    ortNode as unknown as ForgeOrtLike,
    readFileSync(MODEL),
  );
});

const game = (result: GateGame["result"]): GateGame => ({
  seed: 1,
  candidateSeat: 0,
  result,
  reason: "x",
  turns: 1,
});

describe("forge gate", () => {
  it("scores draws as half and promotes at the threshold", () => {
    const s = gateSummary(
      [game("win"), game("win"), game("draw"), game("loss")],
      0.6,
    );
    expect(s).toMatchObject({ games: 4, wins: 2, losses: 1, draws: 1 });
    expect(s.score).toBeCloseTo(0.625, 6);
    expect(s.promote).toBe(true);
    expect(gateSummary([game("win"), game("loss")], 0.55).promote).toBe(false);
    expect(gateSummary([], 0.55).promote).toBe(false);
    const [lo, hi] = wilson(0.5, 100);
    expect(lo).toBeCloseTo(0.404, 3);
    expect(hi).toBeCloseTo(0.596, 3);
    expect(wilson(0, 0)).toEqual([0, 0]);
  });

  it("reports the result from the candidate's seat", async () => {
    const opts = {
      seed: 3,
      deckA: trainingDeck("aggro"),
      deckB: trainingDeck("midrange"),
      simulations: 8,
      maxTurns: 6,
    };
    const a = await playGateGame(model, model, { ...opts, candidateSeat: 0 });
    const b = await playGateGame(model, model, { ...opts, candidateSeat: 1 });
    // Same model on both seats: moving the candidate flips the result.
    const flip = { win: "loss", loss: "win", draw: "draw" } as const;
    expect(b.result).toBe(flip[a.result]);
    expect(a.turns).toBeGreaterThan(0);
  });

  it("gives the baseline its own search budget", async () => {
    const opts = {
      seed: 5,
      deckA: trainingDeck("aggro"),
      deckB: trainingDeck("midrange"),
      candidateSeat: 0 as const,
      simulations: 8,
      maxTurns: 6,
    };
    const same = await playGateGame(model, model, opts);
    const raw = await playGateGame(model, model, {
      ...opts,
      baselineSimulations: 0,
    });
    for (const g of [same, raw]) {
      expect(["win", "loss", "draw"]).toContain(g.result);
      expect(g.candidateSeat).toBe(0);
    }
    const again = await playGateGame(model, model, {
      ...opts,
      baselineSimulations: 8,
    });
    expect(JSON.stringify(again)).toBe(JSON.stringify(same));
  });

  it("plays Gumbel picks deterministically", async () => {
    const opts = {
      seed: 7,
      deckA: trainingDeck("aggro"),
      deckB: trainingDeck("midrange"),
      candidateSeat: 1 as const,
      simulations: 8,
      maxTurns: 6,
      pick: "gumbel" as const,
    };
    const a = await playGateGame(model, model, opts);
    const b = await playGateGame(model, model, opts);
    expect(["win", "loss", "draw"]).toContain(a.result);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("is deterministic for a seed", async () => {
    const opts = {
      seed: 5,
      deckA: trainingDeck("aggro"),
      deckB: trainingDeck("midrange"),
      candidateSeat: 1 as const,
      simulations: 8,
      maxTurns: 6,
    };
    const a = await playGateGame(model, model, opts);
    const b = await playGateGame(model, model, opts);
    expect(b).toEqual(a);
  });
});
