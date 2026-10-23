/**
 * manamind's exported ForgePointerNet under onnxruntime (manamind#86).
 *
 * Feeds `packDecision` inputs to `forge_pointer.onnx` (written by manamind's
 * `python -m manamind.models.forge_pointer_onnx`) and slices the padded graph
 * outputs the way manamind's `unpack` does, so callers get exactly the
 * quantities `ForgePointerNet.act` samples from.
 *
 * The runtime is injected (`ForgeOrtLike`) so Node tests and the bench can
 * pass onnxruntime-node and the browser can pass onnxruntime-web.
 */

import {
  FORGE_POINTER_INPUTS,
  packDecision,
  type ForgeDecision,
} from "./forge-pointer-features";

/** manamind `OUTPUT_NAMES`. */
export const FORGE_POINTER_OUTPUTS = [
  "value",
  "priority",
  "attack",
  "block",
] as const;

export interface ForgePointerOutput {
  /** Value for the deciding seat, in [-1, 1]. */
  value: number;
  /** Logits over the priority options, then pass (last). */
  priority: number[];
  /** One attack/no-attack logit per eligible creature. */
  attack: number[];
  /** Per blocker: logits over the attackers, then no block (last). */
  block: number[][];
}

export interface ForgePointerModel {
  evaluate(decision: ForgeDecision): Promise<ForgePointerOutput>;
  /**
   * One net call for `N` decisions, outputs in the same order (issue #2728:
   * the Forge root search scores a halving phase's leaf decisions together
   * instead of awaiting `N` single calls).
   *
   * The exported graphs carry no batch axis — schema v1/v2 declare
   * `hand_x` as `[n_hand, 23]` and `glob` as `[27]`, and the zone pooling
   * (`Mul` by the mask, then `ReduceSum`/`ReduceMax`) reduces over the whole
   * zone axis — so one `session.run` cannot serve several decisions without
   * mixing them. This packs each decision once and issues the `N` forward
   * passes as a single batch of `run` calls, which is the seam a batched
   * export (or a runtime that runs passes off-thread) would fill with one
   * fused pass. The values, and their order, are exactly `evaluate`'s, so a
   * seeded search picks the same actions either way.
   */
  evaluateBatch(
    decisions: readonly ForgeDecision[],
  ): Promise<ForgePointerOutput[]>;
}

interface OrtTensorLike {
  data: ArrayLike<number>;
  dims: readonly number[];
}

interface OrtSessionLike {
  /** Graph input names; a v1 model has no deck inputs (manamind #96). */
  inputNames?: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensorLike>>;
}

/** The slice of the onnxruntime API this module uses. */
export interface ForgeOrtLike {
  InferenceSession: {
    create(model: Uint8Array): Promise<OrtSessionLike>;
  };
  Tensor: new (
    type: "float32" | "int64",
    data: Float32Array | BigInt64Array,
    dims: readonly number[],
  ) => unknown;
}

/** manamind `unpack`: drop the padding rows and columns for `d`. */
export function unpackOutputs(
  d: ForgeDecision,
  outputs: Record<string, OrtTensorLike>,
): ForgePointerOutput {
  const [value, priority, attack, block] = FORGE_POINTER_OUTPUTS.map((k) => {
    const t = outputs[k];
    if (!t) throw new Error(`forge_pointer.onnx gave no "${k}" output`);
    return t;
  });
  const t = d.t;
  const nPri = t === "priority" ? (d.options ?? []).length : 0;
  const nAtt = t === "attack" ? (d.options ?? []).length : 0;
  const nBlk = t === "block" ? (d.blockers ?? []).length : 0;
  const nBatt = t === "block" ? (d.attackers ?? []).length : 0;
  const pri = Array.from(priority.data);
  const width = block.dims[1] ?? 1;
  const blocks: number[][] = [];
  if (nBlk && nBatt) {
    const data = Array.from(block.data);
    for (let b = 0; b < nBlk; b++) {
      const row = data.slice(b * width, (b + 1) * width);
      blocks.push([...row.slice(0, nBatt), row[width - 1]]);
    }
  }
  return {
    value: Number(value.data[0]),
    priority: [...pri.slice(0, nPri), pri[pri.length - 1]],
    attack: Array.from(attack.data).slice(0, nAtt),
    block: blocks,
  };
}

/** Wrap a loaded ORT session around `forge_pointer.onnx` bytes. */
export async function createForgePointerModel(
  ort: ForgeOrtLike,
  modelBytes: Uint8Array,
): Promise<ForgePointerModel> {
  const session = await ort.InferenceSession.create(modelBytes);
  /** One forward pass for one decision (manamind `ForgePointerNet.act`). */
  const run = async (decision: ForgeDecision): Promise<ForgePointerOutput> => {
    const packed = packDecision(decision);
    // A schema-v1 graph has no `own_deck` / `opp_deck` inputs; skip any
    // input the loaded model does not declare so older checkpoints keep
    // running (manamind #96 deck identity, warm-started from v1).
    const declared = session.inputNames;
    const feeds: Record<string, unknown> = {};
    for (const name of FORGE_POINTER_INPUTS) {
      if (declared && !declared.includes(name)) continue;
      const p = packed[name];
      feeds[name] = new ort.Tensor(p.type, p.data, p.dims);
    }
    return unpackOutputs(decision, await session.run(feeds));
  };
  return {
    evaluate: run,
    async evaluateBatch(decisions) {
      // Nothing to fuse in a batch of one (or none): keep it on the single
      // path so its packed tensors are the only live ones.
      if (decisions.length <= 1) {
        return decisions.length === 0 ? [] : [await run(decisions[0])];
      }
      return Promise.all(decisions.map((d) => run(d)));
    },
  };
}
