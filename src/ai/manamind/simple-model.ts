/**
 * Loads the exported manamind policy for the simple ruleset (#2557).
 *
 * The model (`public/models/manamind/simple-v1/model.onnx`, ~310 KB) and
 * onnxruntime-web are only fetched the first time a simple-mode opponent
 * needs them, the same lazy pattern as the synergy embedding manager (#1813).
 * The runtime is injected through `OrtLike` so tests can run the real model
 * with onnxruntime-web's Node build or substitute a fake.
 */

import {
  assertSupportedSchema,
  SIMPLE_OBSERVATION_DIM,
  type SimpleModelSchema,
} from "./simple-observation";

export const SIMPLE_MODEL_BASE_URL = "/models/manamind/simple-v1";

export interface SimplePolicyOutput {
  /** One logit per entry in `schema.actions`. */
  logits: Float32Array;
  /** Value head for the player with priority, in [-1, 1]. */
  value: number;
}

export interface SimplePolicyModel {
  schema: SimpleModelSchema;
  evaluate(observation: Float32Array): Promise<SimplePolicyOutput>;
}

interface OrtTensorLike {
  data: ArrayLike<number>;
}

interface OrtSessionLike {
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensorLike>>;
}

/** The slice of the onnxruntime API this module uses. */
export interface OrtLike {
  InferenceSession: {
    create(model: Uint8Array): Promise<OrtSessionLike>;
  };
  Tensor: new (
    type: "float32",
    data: Float32Array,
    dims: readonly number[],
  ) => unknown;
}

export async function createSimplePolicyModel(
  ort: OrtLike,
  modelBytes: Uint8Array,
  schema: SimpleModelSchema,
): Promise<SimplePolicyModel> {
  assertSupportedSchema(schema);
  const session = await ort.InferenceSession.create(modelBytes);
  return {
    schema,
    async evaluate(observation) {
      if (observation.length !== SIMPLE_OBSERVATION_DIM) {
        throw new Error(
          `expected ${SIMPLE_OBSERVATION_DIM} observation values, got ${observation.length}`,
        );
      }
      const out = await session.run({
        observation: new ort.Tensor("float32", observation, [
          1,
          SIMPLE_OBSERVATION_DIM,
        ]),
      });
      return {
        logits: Float32Array.from(out.policy_logits.data),
        value: Number(out.value.data[0]),
      };
    },
  };
}

export interface LoadSimplePolicyOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  loadOrt?: () => Promise<OrtLike>;
}

async function defaultLoadOrt(): Promise<OrtLike> {
  const mod = (await import(
    /* webpackChunkName: "onnxruntime-web" */ "onnxruntime-web"
  )) as unknown as OrtLike & { default?: OrtLike };
  return mod.default ?? mod;
}

let cached: Promise<SimplePolicyModel> | null = null;

/**
 * The shared policy, loaded once. A failed load is not cached, so the next
 * call retries (for example after the user comes back online).
 */
export function loadSimplePolicyModel(
  options: LoadSimplePolicyOptions = {},
): Promise<SimplePolicyModel> {
  if (cached) return cached;
  const baseUrl = options.baseUrl ?? SIMPLE_MODEL_BASE_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const loadOrt = options.loadOrt ?? defaultLoadOrt;
  cached = (async () => {
    const schemaRes = await fetchImpl(`${baseUrl}/model.schema.json`);
    if (!schemaRes.ok) {
      throw new Error(`manamind schema fetch failed: ${schemaRes.status}`);
    }
    const schema = (await schemaRes.json()) as SimpleModelSchema;
    // Check the schema before paying for the model and runtime downloads.
    assertSupportedSchema(schema);
    const [modelRes, ort] = await Promise.all([
      fetchImpl(`${baseUrl}/model.onnx`),
      loadOrt(),
    ]);
    if (!modelRes.ok) {
      throw new Error(`manamind model fetch failed: ${modelRes.status}`);
    }
    const bytes = new Uint8Array(await modelRes.arrayBuffer());
    return createSimplePolicyModel(ort, bytes, schema);
  })();
  cached.catch(() => {
    cached = null;
  });
  return cached;
}

/** Test hook: forget the cached model. */
export function _resetSimplePolicyModelForTests(): void {
  cached = null;
}
