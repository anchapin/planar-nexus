# Planar Nexus — Mutation Gate: Diagnosis, Fixes, and Remaining Work (2026-10-23)

**Source prompt**: `.planning/handoffs/planar-nexus-next-recommended-tasks-2026-10-23.md`
(the file itself lives in the primary checkout at
`/home/alex/Projects/planar-nexus/.planning/handoffs/`, not in this worktree).

Branch: `fix/mutation-gate-static-mutants` (pushed), based on `origin/main`
@ `dd716e5a`.

---

## Task 1 — Verify the mutation gate end-to-end: ✅ VERIFIED

The handoff asked to dispatch `gh workflow run mutation.yml` and confirm every
module instruments a non-zero mutant count with no
`No files found for mutation with the given glob expressions` warning.

**No dispatch was needed to answer this.** Nightly run
[`39925581871`](https://github.com/anchapin/planar-nexus/actions/runs/39925581871)
(`schedule`, `main` @ `685223a5`) already ran _after_ the stryker-glob fix
landed on `main`:

| Module                       |   Files |    Mutants | Static (uncovered) | Static share |
| ---------------------------- | ------: | ---------: | -----------------: | -----------: |
| layer-system                 |       1 |        995 |                243 |          24% |
| combat                       |       4 |        805 |                351 |          44% |
| mana                         |       8 |      1,141 |                368 |          32% |
| spell-casting                |       6 |      3,155 |                639 |          20% |
| trigger-system               |       9 |      1,544 |                 94 |           6% |
| replacement-effects          |       5 |        811 |                 87 |          11% |
| state-based-actions          |       1 |        511 |                190 |          37% |
| keyword-actions              |      76 |      9,473 |              1,497 |          16% |
| oracle-text-parser-abilities |       1 |        935 |                  0 |           0% |
| **Total**                    | **111** | **19,368** |          **3,469** |      **18%** |

**Zero** `No files found for mutation` warnings — the glob bug is dead, the fix
(PR #2839) is deployed, and issue #2835 was closed correctly.

**But the gate is still red**: all nine legs were cancelled at the 180-minute
job timeout.

---

## Root cause

The handoff assumed a timeout is a _capacity_ problem and suggested raising
`timeout-minutes` or splitting `keyword-actions`. Measured, the real cost is
**per-mutant test execution**: 55–92% of mutants hit Stryker's 5-second
per-test timeout cap, and each mutant's covering test set runs in full.

Measured throughput, nightly run `40015189962` (360-minute budget,
`ignoreStatic` on):

| Module                       | Mutants | Runnable (total − static) | Executed in 360 min | Timed out | s/mutant | Status       |
| ---------------------------- | ------: | ------------------------: | ------------------: | --------: | -------: | ------------ |
| replacement-effects          |     811 |                       724 |                 810 |       672 |     26.7 | ✅ completed |
| state-based-actions          |     511 |                       321 |                 510 |       469 |     42.3 | ✅ completed |
| combat                       |     805 |                       454 |                 804 |       611 |     26.9 | ✅ completed |
| mana                         |   1,141 |                       773 |               1,099 |       947 |     19.7 | 96%          |
| oracle-text-parser-abilities |     935 |                       935 |                 913 |       870 |     23.7 | 98%          |
| layer-system                 |     995 |                       752 |                 879 |       795 |     24.6 | 88%          |
| trigger-system               |   1,544 |                     1,450 |               1,255 |       898 |     17.2 | 81%          |
| spell-casting                |   3,155 |                     2,516 |               1,478 |       948 |     14.6 | 47%          |
| keyword-actions              |   9,463 |                     7,966 |               2,066 |       498 |     10.5 | 22%          |

(The `s/mutant` column is 360 min ÷ mutants executed; the "timed out" counts
are from Stryker's own progress counter. Almost every executed mutant _hangs_
rather than failing an assertion — for layer-system it was 795 of 796.)

Total work: ~16,394 runnable mutants × ~20 s ≈ **57 runner-hours**, against
9 legs × 6 h (GitHub's ceiling) = 54 runner-hours. The gate is structurally
over budget, and the two heaviest modules are over by 2–4×.

### `ignoreStatic` is a no-op — do not rely on it

The hypothesis was that static (uncovered-code) mutants force a full test-suite
re-run each and were ~99% of the runtime. `ignoreStatic: true` was enabled and
the three legs that completed under it prove it changes nothing:

- replacement-effects reported **811** mutants — identical to the pre-change
  total — with **zero** mutants at status `Ignored`;
- state-based-actions reported **511**, combat **805** — also identical.

So `ignoreStatic` neither skips mutants nor changes the score. The
uncovered-code debt is reported by Stryker as status **`NoCoverage`**, and
those mutants _are_ counted against the score. The uncovered-code budget gate
was therefore re-based from `Ignored` onto `NoCoverage`, which is the metric
Stryker actually reports.

### Lowering Stryker's per-test timeout is score-unsafe

The obvious lever is `timeout` (Stryker default 5000 ms): with ~90% of mutants
hanging, halving it would roughly halve the runtime. Measured the 14,884
legitimate tests of the suite:

```
max 16,812 ms | p99 314 ms | p99.9 3,508 ms | p99.99 12,391 ms
29 tests > 2,000 ms, 47 tests > 1,000 ms
```

A timeout below ~2 s would classify 29 legitimate slow tests as mutant
detections, inflating the score. **Do not lower it** without a per-module
score comparison. (At 5,000 ms — the current setting — 9 legitimate tests
already exceed the cap, so this inflation exists today and the floors are
re-derived from the same measurement basis for that reason.)

---

## Changes landed

1. **`stryker.config.js`** — `ignoreStatic: true`. Kept because it is what
   Stryker recommends and it costs nothing, but see above: it is a no-op.
2. **`scripts/mutation-floor-lib.js`** — `computeModuleScores` reports
   `noCoverage` per file; new `moduleFor`, `computeUncoveredByModule` and
   `evaluateUncoveredBudgets` aggregate uncovered-code mutants per module and
   fail the gate when a module exceeds its budget.
3. **`scripts/mutation-floor.config.js`** — `uncoveredBudgets` per module (a
   ceiling on uncovered-code debt that may only go down) plus the re-baselined
   floors.
4. **`scripts/mutation-floor.js`** — the gate now reports score-floor violations
   _and_ uncovered-budget violations.
5. **`scripts/check-mutation-config.mjs`** — check 3b: every allowlisted module
   needs an uncovered-code budget, so a new module cannot silently drop its
   coverage debt out of the gate.
6. **`.github/workflows/mutation.yml`** — `timeout-minutes: 180` → `360`.
7. **`.github/actions/setup-node-npm-ci`** — new `npm-cache` input (default
   `true`); the nightly passes `'false'`. The `actions/setup-node` npm tarball
   cache is a known intermittent failure point — it killed the combat leg of
   run `39990082229` after 2.5 minutes with `Failed to recover
package-lock.json`. The composite already caches `node_modules` itself.

---

## Task 2 — Re-baseline the floors: ✅ DONE for the three measured modules

Floors are derived with the handoff's rule `floor(measured_score - 1)`, where
the measured score is the **worst file** in the module (the floor is applied
per file). Measured from the `mutation.json` artifacts of run `40015189962`:

| Module              | Worst file score |           Old floor | **New floor** | No-coverage mutants |
| ------------------- | ---------------: | ------------------: | ------------: | ------------------: |
| replacement-effects |           85.59% |                  76 |        **84** |                  68 |
| state-based-actions |           93.74% |                  50 |        **92** |                  28 |
| combat              |           77.16% | 55 (`defaultFloor`) |            55 |                  29 |

`state-based-actions` moves off its "PENDING measurement" placeholder of 50
(issue #1395). `combat` is deliberately left on `defaultFloor`: it is outside
the stryker allowlist (issues #1989 / #2055 — "the suite is pin/neutered so
mutation score is meaningless"), so a tight floor there would gate on a score
the repo has already declared meaningless.

The uncovered-code budgets for the other six modules are **upper bounds**
derived from run `40015189962`'s progress counters
(`tested − survived − timed out`): layer-system 83, mana 149, trigger-system
357, spell-casting 530, keyword-actions 1,456, oracle 43. They must be
ratcheted down to the exact count once each module's leg completes.

Validated locally by running the gate against all three real Stryker reports:
all three pass (`exit=0`).

---

## Task 3 — Other failure causes: ✅ RESOLVED

- `combat` is excluded from `stryker.config.js`'s `mutate` list (issues #1989 /
  #2055) but **is** mutated in CI via `npm run mutate:combat`. It therefore has
  no `floors` entry and falls back to `defaultFloor`.
- `oracle-text-parser-abilities` reports **zero** static mutants; its slowness
  is timeout-driven.
- `stryker.config.js` and `scripts/` are eslint-ignored (0 errors).
- ts-jest is already transpile-only (`tsconfig.json` sets
  `isolatedModules: true`), so per-mutant type-checking is not a factor.
- Stryker's jest adapter runs Jest `runInBand`, so `STRYKER_CONCURRENCY: 4`
  already maps 1:1 onto the runner's 4 vCPUs.

---

## Remaining work — split the heavy modules, and decide on the two single-file ones

### Split needed (mechanical)

**`spell-casting`** (6 files) → 2 legs of 3:

| Leg               | Files                                         |
| ----------------- | --------------------------------------------- |
| `spell-casting-a` | `affinity.ts`, `board-sweepers.ts`, `cast.ts` |
| `spell-casting-b` | `choices.ts`, `resolve.ts`, `targeting.ts`    |

**`keyword-actions`** (76 files) → 4 legs by first letter:

| Leg                 | Glob                                           | Files | ETA at 10.5 s/mutant |
| ------------------- | ---------------------------------------------- | ----: | -------------------- |
| `keyword-actions-a` | `src/lib/game-state/keyword-actions/[a-c]*.ts` |    16 | 4.7 h                |
| `keyword-actions-b` | `src/lib/game-state/keyword-actions/[d-f]*.ts` |    22 | 6.4 h                |
| `keyword-actions-c` | `src/lib/game-state/keyword-actions/[g-m]*.ts` |    15 | 4.4 h                |
| `keyword-actions-d` | `src/lib/game-state/keyword-actions/[n-z]*.ts` |    23 | 6.7 h                |

Both need re-balancing by _mutant_ count once the split runs — the ETA column
assumes mutants are spread evenly across files, which they are not (see the
`files` vs `mutants` columns of the first table: `layer-system` has one file
and 995 mutants, `mana` has eight and 1,141).

Machinery the split needs:

1. **`globToRegExp` must support character classes** (`[a-c]`) so
   `moduleFor` / `floorFor` resolve the per-leg globs. It handles only `*`
   and `**` today.
2. **Floors need no change** — the module glob
   `src/lib/game-state/keyword-actions/*.ts` still matches every file, and the
   floor is applied per file, so each split leg is checked against the same
   module floor.
3. **Uncovered-code budgets need per-leg keys.** With one module-level budget
   and four legs, each leg would be checked against the module's budget and
   the aggregate ceiling would silently multiply by four. Replace the module
   key with the four `[a-c] / [d-f] / [g-m] / [n-z]` keys, seeded at an equal
   share for the first split run and then ratcheted to the exact per-leg
   counts from that run's artifacts (a budget step that fails still uploads
   its artifact — the upload is `if: always()`).
4. **`check-mutation-config.mjs` checks 3b and 6 need reworking.** They assume
   one matrix leg and one budget key per allowlisted module. They should
   instead assert that _every source file matched by the allowlist is claimed
   by some budget glob_ and _is covered by some matrix leg_ — a stronger check
   than today's, because a missing split leg would otherwise drop coverage
   silently, which is exactly what issue #1785 warns about.
5. **package.json** needs `mutate:spell-casting-a|b` and
   `mutate:keyword-actions-a|b|c|d`, and the workflow matrix +
   `workflow_dispatch` choices need the new names.

### Decision needed — the two single-file modules

`layer-system` (1 file, 995 mutants, 88% done in 360 min) and
`oracle-text-parser-abilities` (1 file, 935 mutants, 98% done) **cannot be
split** — a single file cannot be partitioned across matrix legs. They are
both minutes from finishing, but 360 min is GitHub's ceiling. Options:

- **(a) Lower Stryker's per-test timeout** (e.g. 5000 → 2500 ms). Would make
  both fit comfortably and every other leg far faster. Score-unsafe for the
  29 legitimate tests over 2 s — but the inflation is bounded by each
  module's surviving-mutant count (20 for replacement-effects, 49 for combat,
  0 for state-based-actions), and the floors get re-derived from the same
  measurement. **This is the highest-leverage option and needs a decision on
  whether the small inflation is acceptable.**
- **(b) Accept that they never complete** and gate them at a lower frequency
  (e.g. a separate weekly workflow with a longer per-leg budget). Costs
  another workflow and another artifact to collect.
- **(c) Reduce the mutant count** for those modules (e.g. mutate a subset of
  functions). Changes what the score means.

---

## Local validation

- `npx jest tests/mutation-floor.test.ts` → **41 passed**.
- `npx tsc --noEmit` → clean.
- `npx eslint` on the touched files → 0 errors.
- `node scripts/check-mutation-config.mjs` → OK; check 3b was negative-tested
  (removing a module's budget makes the guard fail).
- `node scripts/mutation-floor.js` smoke-tested against synthetic reports
  (over-budget fails, exactly-at-budget passes, below-floor still fails) **and
  against all three real Stryker reports** (all pass).
- `node scripts/check-setup-node-npm-ci-version.mjs` → PASS; version guard
  test (17 cases) passes.
- `npm run ratchet:test-count` → `suites=860, tests=14891 (14884 passed + 7
skipped), snapshots=3` — the doc bump ships in the same commit as the tests.

---

## Constraints observed

- `scripts/check-turn-credentials.mjs` fails on generated HTML reports —
  `reports/mutation/` and `.stryker-tmp/` are gitignored and must be cleaned up
  after local runs.
- The test-count docs (`docs/onboarding.md`) are ratcheted; the doc bump for
  the +7 test cases must land in the same commit as the test change.
- `commitlint` (`type-empty`, `subject-empty`, `header-case: lower-case`)
  **rejects** an `[AI-assisted] (opencode) …` header prefix — the convention
  used by the local commit `6140465c` would fail the CI `commitlint` job. The
  attribution therefore goes in the commit **body**. Allowed types are
  `feat fix docs style refactor test chore revert` — `ci(...)` is rejected.
