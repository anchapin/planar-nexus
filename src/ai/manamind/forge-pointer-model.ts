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
}

interface OrtTensorLike {
  data: ArrayLike<number>;
  dims: readonly number[];
}

interface OrtSessionLike {
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
  return {
    async evaluate(decision) {
      const packed = packDecision(decision);
      const feeds: Record<string, unknown> = {};
      for (const name of FORGE_POINTER_INPUTS) {
        const p = packed[name];
        feeds[name] = new ort.Tensor(p.type, p.data, p.dims);
      }
      return unpackOutputs(decision, await session.run(feeds));
    },
  };
}
