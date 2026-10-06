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

## Phase 3 — IN PROGRESS (one set drafted, smoke test scaffolding landed)

### 3.4 safety nets — landed in PR #2555 (chore/phase2-no-conflict-hotspots)

- `src/lib/game-state/card-scripts/__tests__/drafted-scripts.test.ts` — 4 data-driven guards:
  1. Smoke test: every scripted card resolves without throwing on minimal state.
  2. Empty-effect-list check.
  3. Modal sanity (every `modes` has ≥2 options and `choose < options.length`).
  4. Text-vs-numbers guard: digits 2-10 in the script appear in the oracle text as either digits or words; skips 0/1 because P/T 1/1 and discard-1 are too often spelled out.
- Test count: 653 → 654 suites, 13170 → 13174 tests. Docs ratchet'd.

### 3.1 first run — FDN landed in PR #2556 (feat/draft-fdn-batch-1)

- 396 cards queued (517 FDN − 50 already scripted − 121 skipped).
- Gemini 3.1 Flash-Lite batch (the bake-off winner).
- 34 drafted, 356 needs_new_op, 6 invalid schema (not written).
- **28 land in the PR** after 10% hand-check removed 6 cards with known schema gaps:
  - heroic_reinforcements: dropped haste keyword
  - empyrean_eagle: "other flying creatures" filter not in static schema
  - youthful_valkyrie: "another angel" subtype filter not in etb schema
  - slagstorm: "each player" (both) damage not expressible
  - make_your_move: OR-target (artifact or 4+ power creature) not expressible
  - firespitter_whelp: "noncreature or dragon" trigger condition not expressible
- Token usage: ~26K input / ~3K output for 396 cards. Cost: ~$0.13.
- **Smoke test + schema validation + text-vs-numbers: all green** on the 201 scripts.
- Scoreboard: 308/5164 (6.0%) → 342/5164 (6.6%).

### Spend to date

- ~$0.13 of $50 budget (0.3%).
- Per-card cost: $0.0003 (matches bake-off projection of $0.18/1k cards).

### Observations for Phase 4

- 356/396 = 90% of FDN came back as `needs_new_op`. The bake-off projected 65% gold accuracy; the real rate here is much lower because:
  1. The model is over-conservative: it says "needs_new_op" for things the schema covers (e.g. "creatures you control get +2/+2" is fully StaticSchema).
  2. FDN includes many complex Commander-tier cards with ward, kicker, equipment, multi-target.
- A re-prompt with stronger "you can express this with the schema below" instructions would likely halve the false-cries. That's a Phase 5 lane.
- Phase 4's frontier list will be derived from `docs/card-scripts/drafts/*.md`.

## Phase 4 — DONE (frontier + 10 issues filed)

Aggregated seven draft reports (`blb`, `card-list`, `fdn`, `fin`, `mkm`, `sos`, `tdc`) and grouped the LLM's per-card `needs_new_op` reasons by capability. Wrote `reports/op-frontier.md` and `scripts/build-op-frontier.ts` (re-runs with `npx tsx scripts/build-op-frontier.ts`).

Top 10 capabilities by card-unlock count (combined across sets):

| #   | Capability                                 | Cards | Issue |
| --- | ------------------------------------------ | ----: | ----- |
| 1   | X-cost in triggered/activated effects      |    69 | #2559 |
| 2   | Return card from graveyard to battlefield  |    46 | #2560 |
| 3   | Equipment (attach, equip, equipped static) |    44 | #2561 |
| 4   | Search library                             |    36 | #2562 |
| 5   | Flashback cost                             |    32 | #2563 |
| 6   | Kicker / additional cost                   |    28 | #2564 |
| 7   | Add mana                                   |    27 | #2565 |
| 8   | Shuffle library                            |    26 | #2566 |
| 9   | Indestructible keyword                     |    17 | #2567 |
| 10  | Aura enchantment                           |    15 | #2568 |

Each issue body has CR references, the first 5 cards it unlocks, and a brief spec of what the op should do. They are the inputs for Phase 5 worktrees; that lane is held until #2555 (scaffold) and #2556 (FDN) merge into main.
