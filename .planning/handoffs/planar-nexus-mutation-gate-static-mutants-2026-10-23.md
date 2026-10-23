# Planar Nexus — Mutation Gate: Static-Mutant Root Cause (2026-10-23)

**Source prompt**: `.planning/handoffs/planar-nexus-next-recommended-tasks-2026-10-23.md`
(the file itself lives in the primary checkout at
`/home/alex/Projects/planar-nexus/.planning/handoffs/`, not in this worktree).

Branch: `fix/mutation-gate-static-mutants` (pushed), based on `origin/main`
@ `dd716e5a`.

---

## Task 1 — Verify the mutation gate end-to-end: ✅ VERIFIED (and the gate is still red)

The handoff asked to dispatch `gh workflow run mutation.yml` and confirm every
module instruments a non-zero mutant count with no
`No files found for mutation with the given glob expressions` warning.

**No dispatch was needed to answer this.** Nightly run
[`39925581871`](https://github.com/anchapin/planar-nexus/actions/runs/39925581871)
(`schedule`, `main` @ `685223a5`, 2026-10-23 08:34Z) already ran _after_ the
stryker-glob fix landed on `main`, and its logs answer the question:

| Module                       | Files | Mutants | Static (uncovered) | Static share |
| ---------------------------- | ----: | ------: | -----------------: | -----------: |
| layer-system                 |     1 |     995 |                243 |          24% |
| combat                       |     4 |     805 |                351 |          44% |
| mana                         |     8 |   1,141 |                368 |          32% |
| spell-casting                |     6 |   3,155 |                639 |          20% |
| trigger-system               |     9 |   1,544 |                 94 |           6% |
| replacement-effects          |     5 |     811 |                 87 |          11% |
| state-based-actions          |     1 |     511 |                190 |          37% |
| keyword-actions              |    76 |   9,473 |              1,497 |          16% |
| oracle-text-parser-abilities |     1 |     935 |                  0 |           0% |
| **Total**                    |   111 |  19,368 |              3,469 |          18% |

- **Zero** `No files found for mutation` warnings. The glob bug is dead.
- Every module instruments real mutants. The fix (PR #2839, `main` @ `dd716e5a`)
  is deployed and issue #2835 was closed correctly.

**But the gate is still red.** All nine legs were `cancelled` at exactly the
180-minute per-job timeout.

---

## Root cause (the actual finding)

The handoff assumed a timeout is a _capacity_ problem and suggested raising
`timeout-minutes` or splitting `keyword-actions`. Raising the timeout alone is
wrong — Stryker's own ETA in the run logs says otherwise:

```
layer-system      717/995  tested in 2h56m  → Stryker ETA: remaining ~445 hours
keyword-actions  1766/9473 tested in 2h54m  → Stryker ETA: remaining ~24,430 hours
```

The cause is **static mutants**: mutants located in code that no test covers.
Each one forces a _full test-suite re-run_ because there is no covering test to
narrow it to. Stryker says so itself in every leg's log:

```
Detected 243 static mutants (24% of total) that are estimated to take 99% of
the time running the tests! You might want to enable 'ignoreStatic'.
```

3,469 of 19,368 mutants (18%) sit in that category.

### Change 1 — `ignoreStatic` (landed)

`stryker.config.js` now sets `ignoreStatic: true` (Stryker 10.0.0 requires
`coverageAnalysis: "perTest"`, already set). Verified against
`node_modules/@stryker-mutator/core@10.0.0`:

- pure-static mutants → planned as `EarlyResult` with `status: "Ignored"`,
  `statusReason: 'Static mutant (and "ignoreStatic" was enabled)'` → **never executed**;
- mutants covered by perTest coverage → still run, against their covering tests only.

### Change 2 — the gate must not get weaker (landed)

`Ignored` mutants drop out of the score denominator, so uncovered-code debt
would silently vanish. Foreman decision (option 2 of 4): **ignoreStatic plus a
separate ratcheting uncovered-mutant budget gate.**

- `computeModuleScores` now also reports `ignored` per file.
- `computeUncoveredByModule` aggregates those counts per module glob.
- `evaluateUncoveredBudgets` fails the gate when a module's uncovered count
  exceeds its budget (`scripts/mutation-floor.config.js` → `uncoveredBudgets`).
  Budgets are seeded with the static counts measured in run `39925581871` and
  may only ever go **down**.
- `defaultUncoveredBudget: 0` — a mutated file no budget glob claims is a
  config gap and fails the gate.
- `scripts/mutation-summary.js` prints an `Uncovered` column.
- `scripts/check-mutation-config.mjs` gained check 3b: every allowlisted module
  needs a budget.

### ⚠️ `ignoreStatic` alone did NOT make the nightly complete

Run **`39990082229`** (dispatched on this branch, 180-minute budget) measured
the real per-module throughput with `ignoreStatic` enabled:

| Module                       | Mutants | Runnable (total − static) | Tested in 180 min | Timed out |                   s/mutant |
| ---------------------------- | ------: | ------------------------: | ----------------: | --------: | -------------------------: |
| state-based-actions          |     511 |                       321 |               453 | 418 (92%) |                       23.8 |
| replacement-effects          |     811 |                       724 |               726 | 657 (90%) |                       14.9 |
| oracle-text-parser-abilities |     935 |                       935 |               482 | 439 (91%) |                       22.4 |
| mana                         |   1,141 |                       773 |               644 | 495 (77%) |                       16.8 |
| layer-system                 |     995 |                       752 |               518 | 350 (68%) |                       20.8 |
| trigger-system               |   1,544 |                     1,450 |               786 | 431 (55%) |                       13.7 |
| spell-casting                |   3,155 |                     2,516 |               982 | 452 (46%) |                       11.0 |
| keyword-actions              |   9,463 |                     7,966 |             1,719 | 310 (18%) |                        6.3 |
| combat                       |     805 |                       454 |                 — |         — | npm-cache flake at 2.5 min |

Two things this settles:

1. **The dominant cost is per-mutant test execution, and 55–92 % of mutants
   hit Stryker's 5-second per-test timeout cap.** The cost is not the mutant
   count alone; it is (number of covering tests) × (timeout). `ignoreStatic`
   removed work from the _tail_ of the queue, which the old runs never reached
   anyway, so it did not move the throughput.
2. **The whole sweep is ~57 runner-hours.** 16,394 runnable mutants at the
   measured rates. Nine legs × 6 h (GitHub's ceiling) = 54 runner-hours. The
   gate is structurally over budget by a little, and by a lot for the two
   heaviest modules.

### Change 3 — raise the job timeout to 360 minutes (landed)

Issue #1785's own acceptance criteria list "raise the timeout" as an accepted
remedy, and 360 min is GitHub-hosted's ceiling. At the measured rates:

| Module                       | Runnable | ETA at measured rate | Fits in 360 min? |
| ---------------------------- | -------: | -------------------- | ---------------- |
| combat                       |      454 | 1.9 h                | ✅               |
| state-based-actions          |      321 | 2.1 h                | ✅               |
| replacement-effects          |      724 | 3.0 h                | ✅               |
| mana                         |      773 | 3.6 h                | ✅               |
| layer-system                 |      752 | 4.3 h                | ✅               |
| trigger-system               |    1,450 | 5.5 h                | ✅ (tight)       |
| oracle-text-parser-abilities |      935 | 5.8 h                | ✅ (tight)       |
| spell-casting                |    2,516 | 7.7 h                | ❌ needs 2 legs  |
| keyword-actions              |    7,966 | 13.9 h               | ❌ needs 4 legs  |

Run **`40015189962`** (dispatched 19:55Z) measures the 360-minute budget.

### Change 4 — npm-cache flake (landed)

The `combat` leg of run `39990082229` died after 2.5 minutes with
`Failed to recover package-lock.json` — the `actions/setup-node` npm tarball
cache restore, a known intermittent failure. Nine matrix legs restoring that
cache in parallel makes it likely. `.github/actions/setup-node-npm-ci` gained a
`npm-cache` input (default `true`, so no other caller changes) and
`mutation.yml` passes `npm-cache: 'false'`; the composite already caches
`node_modules` itself, so the tarball cache bought nothing there.

---

## Task 2 — Re-baseline the floors: ⏳ PENDING a completed run

Floors in `scripts/mutation-floor.config.js` are still the pre-restructure
numbers. The handoff's derivation rule is `floor(measured_score - 1)`.

The artifact upload is `if: always()`, so a completed leg's
`reports/mutation/mutation.json` survives even when the floor step fails.
With the 360-minute budget, seven legs are expected to complete, which is
enough to re-baseline those seven modules.

**How to complete it:**

1. Download the `reports/mutation` artifact from run `40015189962`.
2. Run `computeModuleScores` over it and set each floor to
   `floor(measured_score - 1)`.
3. Update the pinned expectations in `tests/mutation-floor.test.ts`
   (the `floor(77.78 - 1) // 76` style assertions).
4. Re-measure the uncovered counts and lower `uncoveredBudgets` to match.
5. Push → the next run must be green.

---

## Task 3 — Other failure causes: ✅ RESOLVED

- `combat` is deliberately excluded from `stryker.config.js`'s `mutate` list
  (issues #1989 / #2055) but **is** mutated in CI via
  `npm run mutate:combat` → `--mutate src/lib/game-state/combat/*.ts`.
  It therefore has no `floors` entry and falls back to `defaultFloor`; it does
  have an `uncoveredBudgets` entry (351).
- `oracle-text-parser-abilities` reports **zero** static mutants, so its
  uncovered budget is 0. Its slowness is from _timed-out_ mutants (439 of 482),
  not from static ones.
- `stryker.config.js` and `scripts/` are eslint-ignored (lint shows
  "File ignored" warnings, 0 errors).
- ts-jest is already transpile-only (`tsconfig.json` sets
  `isolatedModules: true`), so per-mutant type-checking is not a factor.

---

## Remaining work — split the two heavy modules (next cycle)

`spell-casting` and `keyword-actions` still exceed 360 minutes. Both need to
become several matrix legs. The partition below balances file counts; the
per-leg mutant counts are unknown until the split runs, so re-balance after
the first split run if a leg comes in hot.

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

Enumerate the exact file lists with:

```bash
node -e 'const fs=require("fs");const d="src/lib/game-state/keyword-actions";
for (const f of fs.readdirSync(d).filter(f=>f.endsWith(".ts")).sort()) {
  const c=f[0]; const k = c<="c" ? "a" : c<="f" ? "b" : c<="m" ? "c" : "d";
  console.log(k, f);
}'
```

### Machinery the split needs

1. **`globToRegExp` must support character classes** (`[a-c]`) so
   `moduleFor`/`floorFor` can resolve the per-leg globs. Currently it handles
   only `*` and `**`.
2. **Floors need no change** — the module glob
   `src/lib/game-state/keyword-actions/*.ts` still matches every file, and the
   floor is applied per file, so each split leg is checked against the same
   module floor.
3. **Uncovered budgets need per-leg keys.** With one module-level budget of
   1,497 and four legs, each leg would be checked against 1,497 and the
   aggregate ceiling would silently become ~4 × 1,497. Replace the module key
   with four `[a-c] / [d-f] / [g-m] / [n-z]` keys. Seed them at an equal share
   (≈375 each) for the first split run — at least one group will exceed its
   share, that leg's budget step fails, **but its artifact still uploads**
   (`if: always()`) — then set the exact per-leg counts from those artifacts.
4. **`check-mutation-config.mjs` checks 3b and 6 need reworking.** They assume
   one matrix leg and one budget key per allowlisted module. They should
   instead assert that _every source file matched by the allowlist is claimed
   by some budget glob_ and _is covered by some matrix leg_ — which is a
   stronger check than today's (a missing split leg would otherwise drop
   coverage silently, which is exactly what issue #1785 warns about).
5. **package.json** needs `mutate:spell-casting-a|b` and
   `mutate:keyword-actions-a|b|c|d` scripts, and the workflow matrix +
   `workflow_dispatch` input choices need the new names.

---

## Local validation

- `npx jest tests/mutation-floor.test.ts` → **41 passed**.
- `npx tsc --noEmit` → clean.
- `npx eslint` on the touched files → 0 errors.
- `node scripts/check-mutation-config.mjs` → OK, and the new check 3b was
  negative-tested (removing a module's budget makes the guard fail).
- `node scripts/mutation-floor.js` was smoke-tested against synthetic reports:
  a module over its uncovered budget fails with exit 1, a module exactly at
  its budget passes, and a below-floor score still fails as before.
- `node scripts/check-setup-node-npm-ci-version.mjs` → PASS; the version guard
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
  attribution therefore goes in the commit **body**, keeping the header
  conventional. Allowed types are `feat fix docs style refactor test chore
revert` — `ci(...)` is rejected.
