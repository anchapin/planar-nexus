/**
 * Per-op registry drift guard (epic #2487, phase 2.3).
 *
 * The OP_REFERENCE map the LLM reads must cover every arm of the schema's
 * discriminated union, and nothing more. This test is the source of truth
 * for "did a new op ship without a docs entry?": if the schema gains an
 * arm without a corresponding `ops/<OpName>.ts` module, the build fails
 * here, not in some silent string-merge drift in the prompt.
 *
 * A new op still requires the schema arm in `schema.ts` and a dispatch
 * case in `interpret.ts`; this test only guards the documentation side.
 */
import { describe, expect, it } from "@jest/globals";
import { EffectSchema } from "../../schema";
import { buildOpReference } from "../registry";

const schemaOps = (): string[] =>
  EffectSchema.options
    .map((o) => (o.shape as { op: { value: string } }).op.value)
    .sort();

describe("card-scripts ops/registry", () => {
  it("covers every op the schema accepts", () => {
    expect(Object.keys(buildOpReference()).sort()).toEqual(schemaOps());
  });

  it("emits non-empty references", () => {
    for (const [name, reference] of Object.entries(buildOpReference())) {
      expect(reference.length).toBeGreaterThan(0);
      // Helpful failure for ops that ended up empty in the registry.
      if (reference.length === 0)
        throw new Error(`op ${name} has an empty reference`);
    }
  });
});
