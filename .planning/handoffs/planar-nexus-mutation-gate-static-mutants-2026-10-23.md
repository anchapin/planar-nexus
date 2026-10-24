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

Measured throughput, nightly run `40015189962` (360-minute budget):

| Module                       | Mutants | Runnable (total − static) | Executed in 360 min | Timed out | Status       |
| ---------------------------- | ------: | ------------------------: | ------------------: | --------: | ------------ |
| replacement-effects          |     811 |                       724 |                 810 |       672 | ✅ completed |
| state-based-actions          |     511 |                       321 |                 510 |       469 | ✅ completed |
| combat                       |     805 |                       454 |                 804 |       611 | ✅ completed |
| mana                         |   1,141 |                       773 |               1,099 |       947 | 96%          |
| oracle-text-parser-abilities |     935 |                       935 |                 913 |       870 | 98%          |
| layer-system                 |     995 |                       752 |                 879 |       795 | 88%          |
| trigger-system               |   1,544 |                     1,450 |               1,255 |       898 | 81%          |
| spell-casting                |   3,155 |                     2,516 |               1,478 |       948 | 47%          |
| keyword-actions              |   9,463 |                     7,966 |               2,066 |       498 | 22%          |

Almost every executed mutant _hangs_ rather than failing an assertion — for
layer-system it was 795 of 796.

Total work: ~16,394 runnable mutants ≈ **57 runner-hours**, against 9 legs × 6 h
(GitHub's ceiling) = 54 runner-hours. The gate is structurally over budget,
and the two heaviest modules are over by 2–4×.

### `ignoreStatic` is a no-op — do not rely on it

`ignoreStatic: true` was enabled and the legs that completed under it prove it
changes nothing: replacement-effects reported **811** mutants — identical to the
pre-change total — with **zero** mutants at status `Ignored`; state-based-actions
reported 511 and combat 805, also identical. So `ignoreStatic` neither skips
mutants nor changes the score. The uncovered-code debt is reported by Stryker
as status **`NoCoverage`**, and those mutants already count against the score.
The uncovered-code budget gate was therefore re-based from `Ignored` onto
`NoCoverage` — the metric Stryker actually reports.

### Lowering Stryker's per-test timeout is score-unsafe

The obvious lever is `timeout` (Stryker default 5000 ms): with ~90% of mutants
hanging, halving it would roughly halve the runtime. Measured the 14,884
legitimate tests of the suite:

```
max 16,812 ms | p99 314 ms | p99.9 3,508 ms | p99.99 12,391 ms
29 tests > 2,000 ms, 47 tests > 1,000 ms
```

A timeout below ~2 s would classify 29 legitimate slow tests as mutant
detections and inflate the score. **Do not lower it** without a per-module
score comparison. (At 5,000 ms — the current setting — 9 legitimate tests
already exceed the cap, so that inflation exists today and every floor is
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
package-lock.json`. The composite already caches `node_modules` itself, and
   its retry step recovered the cache on run `40052506479`.

---

## Task 2 — Re-baseline the floors: ✅ DONE for the five measured modules

Floors use the handoff's rule `floor(measured_score − 1)`, where the measured
score is the **worst file** in the module (the floor is applied per file).
Measured from the `mutation.json` artifacts of runs `40015189962` and
`40052506479`:

| Module                       | Worst file score |           Old floor |      **New floor** | No-coverage | Measured        |
| ---------------------------- | ---------------: | ------------------: | -----------------: | ----------: | --------------- |
| replacement-effects          |           85.59% |                  76 |             **84** |          68 | run 40015189962 |
| state-based-actions          |           93.74% |                  50 |             **92** |          28 | run 40015189962 |
| oracle-text-parser-abilities |           95.29% |                  50 |             **94** |          43 | run 40052506479 |
| combat                       |           77.16% | 55 (`defaultFloor`) |                 55 |          29 | run 40015189962 |
| trigger-system               |           34.29% |                  44 | **44 (unchanged)** |         352 | run 40052506479 |

`state-based-actions` is off its "PENDING measurement" placeholder of 50
(issue #1395), and `oracle-text-parser-abilities` off its placeholder of 50
(issue #2186). `combat` is deliberately left on `defaultFloor`: it is outside
the stryker allowlist (issues #1989 / #2055 — "the suite is pin/neutered so
mutation score is meaningless"), so a tight floor there would gate on a score
the repo has already declared meaningless.

### trigger-system regressed — the floor deliberately does not move

Its floor of 44 came from a **2026-09-18 measurement of 45.00%**
(issue #1939; 178 killed / 83 timeout / 68 survived / 251 no-coverage of 583
mutants). The 2026-10-24 measurement is **34.29%** (25 killed / 61 timeout /
0 survived / 352 no-coverage of **1,544** mutants) — the `trigger-system.ts` →
`trigger-system/` refactor tripled the mutant count while the coverage did not
keep up.

Lowering the floor to 33 would be wrong twice over: it would hide a real
coverage regression, and a floor below the aggregate `break` threshold of 44 is
a **dead letter** (the aggregate gate fails the run first) — the repo's own
guard test `keeps every floor at or above the aggregate break` enforces this.
The floor stays at 44; the module needs the **#1528 / #1524 test backfill**
(renown/tribute ETB triggers, corpse death trigger) that the config comment
already points at.

The uncovered-code budgets for the modules whose legs have never completed are
upper bounds derived from the run's progress counters
(`tested − survived − timed out`): layer-system 83, mana 149, spell-casting
530, keyword-actions 1,456. They must be ratcheted down to the exact count
once each module's leg completes.

Validated locally by running the gate against all five real Stryker reports:
all five pass (`exit=0`).

---

## Task 3 — Other failure causes: ✅ RESOLVED

- **`combat`** is excluded from `stryker.config.js`'s `mutate` list (issues
  #1989 / #2055) but **is** mutated in CI via `npm run mutate:combat`. It
  therefore has no `floors` entry and falls back to `defaultFloor`.
- **`oracle-text-parser-abilities`** reports **zero** static mutants; its
  slowness is timeout-driven.
- **`stryker.config.js`** and **`scripts/`** are eslint-ignored (0 errors).
- **ts-jest** is already transpile-only (`tsconfig.json` sets
  `isolatedModules: true`), so per-mutant type-checking is not a factor.
- **Stryker's jest adapter runs Jest `runInBand`**, so `STRYKER_CONCURRENCY: 4`
  already maps 1:1 onto the runner's 4 vCPUs.
- **⚠️ A known-flaky test can kill a whole leg.** On run `40052506479` the
  `mana` leg died after 5 minutes with
  `There were failed tests in the initial test run` → the failing test is
  `src/ai/__tests__/simulation/expert-agent.test.ts:37`
  _"expertAction is deterministic for a seed"_ — the exact test the repo's
  `AGENTS.md` already lists as known flake noise. Stryker's dry run executes
  the whole suite, so one flaky AI/simulation test takes out the leg's report
  and nothing else. **This needs fixing before the nightly can be trusted.**

---

## Remaining work

### 1. Keep the flaky simulation tests out of the mutation dry run (blocking)

`src/ai/__tests__/simulation/expert-agent.test.ts` (and the other AI
simulation tests) are not needed to build the mutation coverage map for
`src/lib/game-state/**`, and one flake in them kills a 6-hour leg. The clean
fix is a **Stryker-only jest config** — e.g. `jest.config.mutation.js`
extending `jest.config.js` with
`testPathIgnorePatterns: ["src/ai/__tests__/simulation/"]` — referenced from
`stryker.config.js`'s `jest.configFile`, so normal `npm test` keeps running
them. **Check the coverage impact first**: those tests exercise the engine, so
excluding them could raise the no-coverage counts and change the measured
scores. The honest way to check is to re-run one completed module with and
without the exclusion and compare `noCoverage` (replacement-effects:
currently 68/811 mutants).

### 2. Split the heavy modules (mechanical)

**`spell-casting`** (6 files) → 2 legs of 3:

| Leg               | Files                                         |
| ----------------- | --------------------------------------------- |
| `spell-casting-a` | `affinity.ts`, `board-sweepers.ts`, `cast.ts` |
| `spell-casting-b` | `choices.ts`, `resolve.ts`, `targeting.ts`    |

**`keyword-actions`** (76 files) → 4 legs by first letter:

| Leg                 | Glob                                           | Files |
| ------------------- | ---------------------------------------------- | ----: |
| `keyword-actions-a` | `src/lib/game-state/keyword-actions/[a-c]*.ts` |    16 |
| `keyword-actions-b` | `src/lib/game-state/keyword-actions/[d-f]*.ts` |    22 |
| `keyword-actions-c` | `src/lib/game-state/keyword-actions/[g-m]*.ts` |    15 |
| `keyword-actions-d` | `src/lib/game-state/keyword-actions/[n-z]*.ts` |    23 |

**`mana`** (8 files) → 2 legs of 4, if the flaky test is fixed: it reached
96% (1,099 of 1,141) in 360 minutes, so a split clears it comfortably.

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
5. **package.json** needs the new `mutate:*` scripts, and the workflow matrix
   - `workflow_dispatch` choices need the new names.

### 3. `layer-system` — the one module that cannot be split

`layer-system` is a **single file** with 995 mutants, and reached 879 of them
(88%) in 360 minutes. A single file cannot be partitioned across matrix legs,
and 360 minutes is GitHub's ceiling. Options:

- **(a) Lower Stryker's per-test timeout** (e.g. 5000 → 2500 ms). Would make
  it fit comfortably and every other leg far faster. Score-unsafe for the 29
  legitimate tests over 2 s — but the inflation is bounded by each module's
  surviving-mutant count (20 for replacement-effects, 49 for combat, 0 for
  state-based-actions), and the floors get re-derived from the same
  measurement. **Highest leverage; needs a decision on whether the small
  inflation is acceptable.**
- **(b) Gate it at a lower frequency** (a separate weekly workflow with a
  longer per-leg budget). Costs another workflow and artifact to collect.
- **(c) Reduce the mutant count** for that module. Changes what the score means.

### 4. `trigger-system` — needs tests, not a floor change

See above: 45.00% → 34.29% is a real regression. The **#1528 / #1524 test
backfill** is the fix.

---

## Local validation

- `npx jest tests/mutation-floor.test.ts` → **41 passed**.
- `npx tsc --noEmit` → clean.
- `npx eslint` on the touched files → 0 errors.
- `node scripts/check-mutation-config.mjs` → OK; check 3b was negative-tested
  (removing a module's budget makes the guard fail).
- `node scripts/mutation-floor.js` smoke-tested against synthetic reports
  (over-budget fails, exactly-at-budget passes, below-floor still fails) **and
  against all five real Stryker reports** (all pass).
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
