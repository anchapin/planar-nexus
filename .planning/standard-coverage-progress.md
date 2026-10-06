# Planar Nexus — Standard Card Coverage Plan (epic #2487)

Session: speed-up plan from user. Started 2026-10-06.
Working tree started at `c2d8e0fc` on `main`. Node 22, npm ci in 22s.

## Phase 1 — DONE

- New file: `scripts/card-scripts/standard-status.ts` (Scronly fetcher with 24h cache, buckets every Standard card).
- New file: `reports/standard-status.json` (5164 Standard cards bucketed, per-set breakdown).
- Scoreboard:
  - scripted: 173 (3.4%)
  - basic_land: 6 (0.1%)
  - vanilla: 17 (0.3%)
  - keyword_only: 112 (2.2%)
  - unscripted: 4856 (94.0%)
  - **working = 308 / 5164 = 6.0%**
- Per-set top unscripted: FDN 365, FIN 291, FRA 272, TLA 269, LCI 265.
- Cost: $0 (Scronly read-only, cache hit).

## Phase 2 — DONE (3 parts, all on the same PR branch)

### 2.1 Generated index → build output

- `src/lib/game-state/card-scripts/cards/index.generated.ts` removed from the tree and `.gitignore`d.
- `predev`, `prebuild`, `pretest`, `pretypecheck`, `prelint` npm scripts added (all run `npx tsx scripts/build-card-script-index.ts`).
- `.github/workflows/ci.yml`: explicit regen step added to `test` and `typecheck`; the old `Card script index is up to date (#2492)` step in `lint` is gone because it's no longer meaningful (build output, not committed).
- Verified: clean clone with no committed index passes `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run lint` (0 errors). Build emits no errors. `pretest` regenerates before `jest --testPathPatterns=card-scripts`: 5 suites, 308 tests pass.
- Tauri/Next/web gotchas checked: `npm run build` (Next) runs `prebuild` automatically; `npm run dev` (which `playwright.config.ts` invokes via webServer) runs `predev`. Both covered.

### 2.2 Test-count docs merge driver + pre-push hook

- New: `.gitattributes` pins `docs/onboarding.md` and `docs/TEST_VIDEO_FIXTURES.md` to a custom `keepcurrent` merge driver (keeps current side, exits 0).
- New: `scripts/setup-merge-drivers.sh` registers the driver locally; `npm run setup:merge-drivers` runs it once per machine. Idempotent.
- New: `.husky/pre-push` runs `node scripts/check-test-count-docs.mjs` and fails the push when the docs drift away from live Jest. Skipped when neither doc is touched.
- `test-count-docs-guard` CI job is unchanged — still fails on drift.

### 2.3 Per-op reference modules (lean cut)

- New: `src/lib/game-state/card-scripts/ops/types.ts` (`CardOpReference` contract).
- New: `src/lib/game-state/card-scripts/ops/<OpName>.ts` × 21 — one file per op, each exporting the one-line description the LLM reads.
- New: `src/lib/game-state/card-scripts/ops/registry.ts` — `buildOpReference()` assembles the global `OP_REFERENCE` map from the per-op modules.
- `scripts/card-scripts/draft-lib.ts`: `OP_REFERENCE` becomes `buildOpReference()` (the old giant literal is gone). Drift is impossible: if a schema arm exists, the registry entry must too.
- New: `src/lib/game-state/card-scripts/ops/__tests__/registry.test.ts` — guards coverage of the schema's discriminated union and non-empty references. 653 suites / 13170 tests now; new test counts match.
- Schemas stay in `schema.ts`; dispatch stays in `interpret.ts`. A future lane can move those into per-op modules (the registry already has the data shape to do it).

### Verification

- `npm test`: 653 suites, 13163 passed + 7 skipped = 13170. Same count on both `docs/onboarding.md` and `docs/TEST_VIDEO_FIXTURES.md` (ratcheted via `npm run ratchet:test-count`).
- `npm run lint`: 0 errors.
- `npx tsc --noEmit`: clean.
- `npm run build`: clean, 44 static pages.

### Files changed

```
M .github/workflows/ci.yml            # remove redundant --check step, add regen steps to test/typecheck
M .gitignore                          # ignore index.generated.ts
M docs/TEST_VIDEO_FIXTURES.md         # test-count ratchet
M docs/onboarding.md                  # test-count ratchet
M package.json                        # predev/prebuild/pretest/pretypecheck/prelint, setup:merge-drivers
M scripts/card-scripts/draft-lib.ts   # OP_REFERENCE = buildOpReference()
D  src/lib/game-state/card-scripts/cards/index.generated.ts
?? .gitattributes
?? .husky/pre-push
?? scripts/card-scripts/standard-status.ts
?? scripts/setup-merge-drivers.sh
?? src/lib/game-state/card-scripts/ops/                # 21 op modules + registry + types
```

## Phase 3 — STOPPED (waiting on GEMINI_API_KEY)

- `scripts/draft-card-scripts.ts` exists and supports Gemini batch provider.
- Default: `gemini-3.1-flash-lite` batch.
- Drafts land in `src/lib/game-state/card-scripts/cards/`; reports to `docs/card-scripts/drafts/<set>.md`.
- Per the prompt: report expected card count + cost via `--dry-run` first, then a paid run.

## Phase 4 — BLOCKED on Phase 3

- Parse every `docs/card-scripts/drafts/*.md` report, group `needs_new_op` by capability, write `reports/op-frontier.md`.
- Open one issue per op for the top 10, link to board 11 and epic #2487.

## Phase 5 — BLOCKED on Phase 4

- Up to 5 worktrees, one per op.
- Each lane: op module + card JSONs + test-count bump + draft PR.
