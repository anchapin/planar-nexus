/**
 * @jest-environment ./src/ai/manamind/__tests__/onnx-node-environment.cjs
 *
 * manamind#87 step 1: self-play records from ForgePointerNet search.
 */

import { readFileSync } from "fs";
import path from "path";
import * as ortNode from "onnxruntime-node";

import {
  createForgePointerModel,
  type ForgeOrtLike,
  type ForgePointerModel,
} from "../forge-pointer-model";
import { playSelfPlayGame } from "../forge-selfplay";
import { trainingDeck } from "@/ai/simulation/training-session";

const MODEL = path.join(__dirname, "fixtures/forge_pointer_v1_seed86.onnx");

let model: ForgePointerModel;
beforeAll(async () => {
  model = await createForgePointerModel(
    ortNode as unknown as ForgeOrtLike,
    readFileSync(MODEL),
  );
});

const play = (seed: number) =>
  playSelfPlayGame(model, {
    seed,
    deckA: trainingDeck("aggro"),
    deckB: trainingDeck("midrange"),
    simulations: 8,
    maxTurns: 6,
  });

describe("playSelfPlayGame", () => {
  it("records a search target shaped like each decision's head", async () => {
    const game = await play(2);
    expect(game.decisions.length).toBeGreaterThan(0);
    expect(game.returns).toHaveLength(game.decisions.length);
    const kinds = new Set<string>();
    for (const [i, d] of game.decisions.entries()) {
      kinds.add(d.t as string);
      expect([0, 1]).toContain(d.seat);
      expect([-1, 0, 1]).toContain(game.returns[i]);
      if (d.t === "priority") {
        const pi = d.pi as number[];
        expect(pi).toHaveLength((d.options ?? []).length + 1);
        expect(pi.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 6);
      } else if (d.t === "attack") {
        const pi = d.pi as number[];
        expect(pi).toHaveLength((d.options ?? []).length);
        for (const v of pi) expect(v).toBeGreaterThanOrEqual(0);
        for (const v of pi) expect(v).toBeLessThanOrEqual(1 + 1e-9);
      } else if (d.t === "block") {
        const pi = d.pi as number[][];
        expect(pi).toHaveLength((d.blockers ?? []).length);
        for (const row of pi) {
          expect(row).toHaveLength((d.attackers ?? []).length + 1);
          expect(row.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 6);
        }
      }
    }
    expect(kinds.has("priority")).toBe(true);
    if (game.winner === null)
      expect(game.returns.every((r) => r === 0)).toBe(true);
  });

  it("is deterministic for a seed", async () => {
    const a = await play(4);
    const b = await play(4);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
