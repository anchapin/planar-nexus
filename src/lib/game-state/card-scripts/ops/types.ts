/**
 * Per-op contract (epic #2487, phase 2.3).
 *
 * Each op module under `ops/<OpName>.ts` exports the one-line description
 * the LLM reads when it scripts a card that uses the op. The zod schema
 * for the op still lives in `schema.ts` and the dispatch case in
 * `interpret.ts` (the engine's hot path); this file is a documentation
 * anchor so a new op's only out-of-tree edit is its own module. The
 * `OP_REFERENCE` map the LLM reads comes from `ops/registry.ts`, not
 * from a giant literal in `scripts/card-scripts/draft-lib.ts`, so the
 * "documents every schema op" test (in scripts/card-scripts) cannot drift.
 *
 * Adding a new op today means:
 *   1. Open `ops/<OpName>.ts` and export a `CardOpReference`.
 *   2. Add the import + entry in `ops/registry.ts`.
 *   3. Add the per-op schema to `schema.ts` (one arm of the discriminated
 *      union) and the case to the interpreter's switch.
 *
 * Step 3 still serializes on `schema.ts` and `interpret.ts` today; a future
 * lane can move those into per-op modules too. The work in this phase
 * cuts LLM-doc drift and gives every op a named home, so op PRs stop
 * touching `scripts/card-scripts/draft-lib.ts`.
 */

/** Single line in the LLM's `OP_REFERENCE` map. */
export interface CardOpReference {
  readonly name: string;
  readonly reference: string;
}
