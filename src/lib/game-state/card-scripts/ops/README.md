# card-scripts ops/

One module per op, each exporting the one-line reference string the LLM
sees when it scripts a card that uses the op. The op's zod schema lives in
`../schema.ts` (one arm of the `EffectSchema` discriminated union) and
its dispatch case lives in `../interpret.ts` (the engine's hot path);
moving those into per-op modules is a future refactor — for now, an op
PR touches only:

1. `ops/<OpName>.ts` — new file, exports `CardOpReference`.
2. `ops/registry.ts` — add the import + entry.

The `__tests__/registry.test.ts` guard fails CI if a schema arm exists
without a corresponding reference (or vice versa), so the LLM-facing
docs stay in sync with the engine by default. See `__tests__/registry.test.ts`
for the test that drives this.

Adding a new op today still requires:

- a schema arm in `../schema.ts`
- a `case` in the dispatch table in `../interpret.ts`

Both can land in the same PR as the op module.
