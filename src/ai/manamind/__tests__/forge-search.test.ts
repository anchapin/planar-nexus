/**
 * @jest-environment ./src/ai/manamind/__tests__/onnx-node-environment.cjs
 *
 * manamind#86 step 3b: ForgePointerNet under onnxruntime-node, and the
 * Gumbel root search that plays it inside a TrainingSession.
 *
 * `forge_pointer_v1_seed86.onnx` is a random-init ForgePointerNet
 * (torch.manual_seed(86), default sizes) exported by manamind's
 * `forge_pointer_onnx.export`; the outputs fixture holds PyTorch's own
 * numbers for the step-3a decisions, so this checks packing, the graph and
 * the unpacking end to end against Python.
 */

import { readFileSync } from "fs";
import path from "path";
import * as ortNode from "onnxruntime-node";

import packFixture from "./fixtures/forge_pointer_v1_pack.json";
import outputsFixture from "./fixtures/forge_pointer_v1_seed86_outputs.json";
import type { ForgeDecision } from "../forge-pointer-features";
import {
  createForgePointerModel,
  type ForgeOrtLike,
  type ForgePointerModel,
} from "../forge-pointer-model";
import { forgeSearch } from "../forge-search";
import { mulberry32 } from "@/ai/simulation/game-simulator";
import {
  randomAction,
  TrainingSession,
  trainingDeck,
} from "@/ai/simulation/training-session";

const MODEL = path.join(__dirname, "fixtures/forge_pointer_v1_seed86.onnx");
const ort = ortNode as unknown as ForgeOrtLike;

let model: ForgePointerModel;
beforeAll(async () => {
  model = await createForgePointerModel(ort, readFileSync(MODEL));
});

function maxDiff(a: number[] | number[][], b: number[] | number[][]) {
  const x = (a as number[]).flat(2) as number[];
  const y = (b as number[]).flat(2) as number[];
  expect(x.length).toBe(y.length);
  return x.reduce((m, v, i) => Math.max(m, Math.abs(v - y[i])), 0);
}

/** A seeded game, random play for `steps` decisions. */
function midGame(seed: number, steps: number) {
  const session = new TrainingSession();
  session.reset(seed, trainingDeck("aggro"), trainingDeck("midrange"));
  const random = mulberry32(seed);
  let prompt = session.legalChoices();
  for (let i = 0; i < steps && prompt.kind !== "game_over"; i++) {
    prompt = session.step(randomAction(prompt, random));
  }
  return session;
}

describe("forge pointer model", () => {
  it("matches PyTorch on every recorded decision", async () => {
    const want = new Map(outputsFixture.cases.map((c) => [c.name, c]));
    expect(packFixture.cases.length).toBe(outputsFixture.cases.length);
    for (const c of packFixture.cases) {
      const ref = want.get(c.name);
      if (!ref) throw new Error(`no reference for ${c.name}`);
      const got = await model.evaluate(c.decision as ForgeDecision);
      expect(Math.abs(got.value - ref.value)).toBeLessThan(1e-4);
      expect(maxDiff(got.priority, ref.priority)).toBeLessThan(1e-4);
      expect(maxDiff(got.attack, ref.attack)).toBeLessThan(1e-4);
      expect(maxDiff(got.block, ref.block)).toBeLessThan(1e-4);
    }
  });
});

describe("TrainingSession.determinize", () => {
  it("redeals only what the viewer can't see", () => {
    const session = midGame(11, 60);
    const [me, opp] = Array.from(session.state.players.keys());
    const before = session.playerView(me);
    const ids = (p: string, z: string) =>
      session.state.zones.get(`${p}-${z}`)?.cardIds ?? [];
    const oppHand = ids(opp, "hand");
    const handle = session.save();
    let changed = false;
    for (let s = 1; s <= 5 && !changed; s++) {
      session.restore(handle);
      session.determinize(me, mulberry32(s));
      expect(session.playerView(me)).toEqual(before);
      expect(ids(opp, "hand").length).toBe(oppHand.length);
      for (const id of ids(opp, "hand"))
        expect(session.state.cards.get(id)?.currentZoneKey).toBe(`${opp}-hand`);
      changed = ids(opp, "hand").join() !== oppHand.join();
    }
    expect(changed).toBe(true);
    session.restore(handle);
    expect(ids(opp, "hand")).toEqual(oppHand);
  });
});

describe("forgeSearch", () => {
  it("answers prompts with moves the engine accepts and restores the game", async () => {
    const session = midGame(5, 40);
    let prompt = session.legalChoices();
    let searched = 0;
    for (let i = 0; i < 30 && prompt.kind !== "game_over"; i++) {
      const before = session.fingerprint();
      const r = await forgeSearch(session, model, { simulations: 16, seed: i });
      expect(session.fingerprint()).toBe(before);
      expect(r.policy.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 6);
      expect(r.candidates.reduce((s, c) => s + c.prior, 0)).toBeCloseTo(1, 6);
      if (r.candidates.length > 1) {
        searched++;
        // Sequential halving stops once one action is left, as in manamind.
        expect(r.simulations).toBeGreaterThan(0);
        expect(r.simulations).toBeLessThanOrEqual(16);
      }
      prompt = session.step(r.action);
    }
    expect(searched).toBeGreaterThan(0);
  });

  it("is deterministic for a seed", async () => {
    const run = async () => {
      const session = midGame(9, 50);
      const out = [];
      let prompt = session.legalChoices();
      for (let i = 0; i < 10 && prompt.kind !== "game_over"; i++) {
        const r = await forgeSearch(session, model, {
          simulations: 16,
          seed: 3,
        });
        out.push(r.action);
        prompt = session.step(r.action);
      }
      return out;
    };
    expect(await run()).toEqual(await run());
  });
});
