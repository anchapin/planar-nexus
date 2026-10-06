/**
 * @jest-environment ./src/ai/manamind/__tests__/onnx-node-environment.cjs
 *
 * The exported manamind policy under onnxruntime-web (#2557).
 *
 * Runs the shipped `public/models/manamind/simple-v1/model.onnx` through
 * onnxruntime-node (same API as onnxruntime-web; Jest's VM can't load the
 * web build's WASM module without --experimental-vm-modules) and checks the
 * logits against the ones manamind's Python host recorded in the replay
 * fixture. Also plays the Easy opponent against a uniform random player. The
 * in-browser WASM check is a Playwright follow-up.
 */

import { readFileSync } from "fs";
import path from "path";
import * as ortNode from "onnxruntime-node";

import fixture from "./fixtures/simple_v1_replays.json";
import { chooseEasyMove } from "../easy-agent";
import {
  _resetSimplePolicyModelForTests,
  createSimplePolicyModel,
  loadSimplePolicyModel,
  type OrtLike,
  type SimplePolicyModel,
} from "../simple-model";
import {
  applySimpleMove,
  createSimpleGame,
  createSimpleGameFromDeal,
  isSimpleGameOver,
  simpleLegalMoves,
  simpleWinner,
} from "../simple-rules";
import {
  legalPriors,
  simpleObservation,
  type SimpleModelSchema,
} from "../simple-observation";

const MODEL_DIR = path.join(process.cwd(), "public/models/manamind/simple-v1");
const ort = ortNode as unknown as OrtLike;
const schema = JSON.parse(
  readFileSync(path.join(MODEL_DIR, "model.schema.json"), "utf8"),
) as SimpleModelSchema;
const modelBytes = new Uint8Array(
  readFileSync(path.join(MODEL_DIR, "model.onnx")),
);

interface Step {
  legal: unknown[];
  chosen: number;
  logits?: number[];
  priors?: number[];
}
const games = (
  fixture as unknown as {
    games: Array<{
      deal: { hand: string[]; library: string[] }[];
      steps: Step[];
    }>;
  }
).games;

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

let model: SimplePolicyModel;

beforeAll(async () => {
  model = await createSimplePolicyModel(ort, modelBytes, schema);
}, 30000);

describe("exported simple-v1 policy", () => {
  it("is the model the fixture was recorded with", () => {
    expect((fixture as { model: string }).model).toBe(
      "models/simple-v1/seed0_settle_iter045",
    );
    expect(schema.schema_version).toBe("simple-v1");
  });

  it("reproduces the Python host's logits and priors", async () => {
    let checked = 0;
    let maxDiff = 0;
    for (const game of games) {
      let state = createSimpleGameFromDeal(game.deal);
      for (const step of game.steps) {
        const legal = simpleLegalMoves(state);
        if (step.logits) {
          const { logits } = await model.evaluate(simpleObservation(state));
          step.logits.forEach((z, i) => {
            maxDiff = Math.max(maxDiff, Math.abs(logits[i] - z));
          });
          const priors = legalPriors(logits, legal, schema.actions);
          (step.priors as number[]).forEach((p, i) => {
            expect(priors[i]).toBeCloseTo(p, 4);
          });
          checked++;
        }
        state = applySimpleMove(state, legal[step.chosen]);
      }
    }
    expect(checked).toBeGreaterThan(200);
    expect(maxDiff).toBeLessThan(1e-4);
  }, 60000);

  it("refuses a schema version it does not know", async () => {
    await expect(
      createSimplePolicyModel(ort, modelBytes, {
        ...schema,
        schema_version: "simple-v2",
      }),
    ).rejects.toThrow(/unsupported manamind schema_version/);
  });

  it("rejects an observation of the wrong length", async () => {
    await expect(model.evaluate(new Float32Array(24))).rejects.toThrow(
      /expected 25 observation values/,
    );
  });

  it("beats a random player most of the time as the Easy opponent", async () => {
    const random = seeded(2557);
    const gamesToPlay = 40;
    let score = 0;
    for (let g = 0; g < gamesToPlay; g++) {
      const easySeat = g % 2;
      let state = createSimpleGame(random);
      for (let i = 0; i < 2000 && !isSimpleGameOver(state); i++) {
        const legal = simpleLegalMoves(state);
        const move =
          state.priorityPlayer === easySeat
            ? (await chooseEasyMove(state, model, random)).move
            : legal[Math.floor(random() * legal.length)];
        state = applySimpleMove(state, move);
      }
      const winner = simpleWinner(state);
      score += winner === null ? 0.5 : winner === easySeat ? 1 : 0;
    }
    // Python measured .70 (28/40) for this policy at temperature 1.0.
    expect(score / gamesToPlay).toBeGreaterThan(0.5);
  }, 120000);
});

describe("loadSimplePolicyModel", () => {
  afterEach(() => _resetSimplePolicyModelForTests());

  function fakeFetch(schemaBody: unknown, calls: string[]): typeof fetch {
    return (async (url: string) => {
      calls.push(String(url));
      if (String(url).endsWith(".json")) {
        return { ok: true, status: 200, json: async () => schemaBody };
      }
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => modelBytes.slice().buffer,
      };
    }) as unknown as typeof fetch;
  }

  it("fetches schema and model once and caches the result", async () => {
    const calls: string[] = [];
    const loadOrt = jest.fn(async () => ort);
    const opts = { fetchImpl: fakeFetch(schema, calls), loadOrt };
    const a = await loadSimplePolicyModel(opts);
    const b = await loadSimplePolicyModel(opts);
    expect(a).toBe(b);
    expect(loadOrt).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      "/models/manamind/simple-v1/model.schema.json",
      "/models/manamind/simple-v1/model.onnx",
    ]);
  });

  it("checks the schema before downloading the model or runtime", async () => {
    const calls: string[] = [];
    const loadOrt = jest.fn(async () => ort);
    await expect(
      loadSimplePolicyModel({
        fetchImpl: fakeFetch({ ...schema, schema_version: "other" }, calls),
        loadOrt,
      }),
    ).rejects.toThrow(/unsupported/);
    expect(calls).toHaveLength(1);
    expect(loadOrt).not.toHaveBeenCalled();
  });

  it("retries after a failed load", async () => {
    const failing = (async () => ({
      ok: false,
      status: 503,
    })) as unknown as typeof fetch;
    await expect(loadSimplePolicyModel({ fetchImpl: failing })).rejects.toThrow(
      /503/,
    );
    const calls: string[] = [];
    await expect(
      loadSimplePolicyModel({
        fetchImpl: fakeFetch(schema, calls),
        loadOrt: async () => ort,
      }),
    ).resolves.toBeDefined();
  });
});
