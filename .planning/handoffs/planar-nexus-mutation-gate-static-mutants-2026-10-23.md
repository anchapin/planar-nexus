# Planar Nexus — Mutation Gate: Static-Mutant Root Cause (2026-10-23)

**Source prompt**: `.planning/handoffs/planar-nexus-next-recommended-tasks-2026-10-23.md`
(the file itself lives in the primary checkout at
`/home/alex/Projects/planar-nexus/.planning/handoffs/`, not in this worktree).

Branch: `fix/mutation-gate-static-mutants` @ `1d68185c`, rebased on
`origin/main` @ `dd716e5a` (pushed to origin). The original `planar-nexus`
branch @ `6140465c` carries the same change unrebased; its globs are already
on `main` via the squash-merge of PR #2839.

---

## Task 1 — Verify the mutation gate end-to-end: ✅ VERIFIED (with a new blocker found)

The handoff asked to dispatch `gh workflow run mutation.yml` and confirm every
module instruments a non-zero mutant count with no
`No files found for mutation with the given glob expressions` warning.

**No new dispatch was needed to answer this.** Nightly run
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
  is deployed.
- Issue #2835 is closed — correctly.

**But the gate is still red.** All nine legs were `cancelled` at exactly the
180-minute per-job timeout (`timeout-minutes: 180`).

---

## Root cause (this is the actual finding)

The handoff assumed a timeout is a _capacity_ problem and suggested raising
`timeout-minutes` or splitting `keyword-actions`. **Both are wrong** — Stryker's
own ETA in the run logs says otherwise:

```
layer-system     717/995  tested in 2h56m   → Stryker ETA: remaining ~445 hours
keyword-actions 1766/9473 tested in 2h54m   → Stryker ETA: remaining ~24,430 hours
```

The cause is **static mutants**: mutants located in code that no test covers.
Each one forces a _full test-suite re-run_, because there is no covering test to
narrow it to. Stryker says so itself in every leg's log:

```
Detected 243 static mutants (24% of total) that are estimated to take 99% of
the time running the tests! You might want to enable 'ignoreStatic'.
```

3,469 of 19,368 mutants (18%) account for ~99% of the runtime. Raising the
timeout to 360 minutes does not help — the ETA is ~445 h for the _smallest_
module.

### Fix applied

`stryker.config.js` now sets `ignoreStatic: true` (Stryker 10.0.0 requires
`coverageAnalysis: "perTest"`, which was already set). Verified against
`node_modules/@stryker-mutator/core@10.0.0`:

- pure-static mutants → planned as `EarlyResult` with `status: "Ignored"`,
  `statusReason: 'Static mutant (and "ignoreStatic" was enabled)'` → **never executed**;
- mutants covered by perTest coverage → still run, against their covering tests only.

### The gate must not get weaker — hence the second half of the fix

`Ignored` mutants drop out of the score denominator, so uncovered-code debt
would silently vanish from the gate. `scripts/mutation-floor-lib.js` already
excluded `Ignored` from `COUNTED_STATUSES`, so the scorer was compatible — but
the debt had to move somewhere. Foreman decision (option 2 of 4): **ignoreStatic
plus a separate ratcheting uncovered-mutant budget gate.**

- `computeModuleScores` now also reports `ignored` per file.
- `computeUncoveredByModule` aggregates those counts per module glob.
- `evaluateUncoveredBudgets` fails the gate when a module's uncovered count
  exceeds its budget (`scripts/mutation-floor.config.js` → `uncoveredBudgets`).
  Budgets are seeded with the static counts measured in run `39925581871` and
  may only ever go **down**.
- `defaultUncoveredBudget: 0` — a mutated file no budget glob claims is a
  config gap and fails the gate.
- `scripts/mutation-summary.js` prints an `Uncovered` column so the debt is
  visible in the CI job summary.

---

## Task 2 — Re-baseline the floors: ⏳ PENDING a completed run

Floors in `scripts/mutation-floor.config.js` are still the pre-restructure
numbers. The handoff's derivation rule is `floor(measured_score - 1)`.

Blocked on a run that actually completes: with `ignoreStatic` the scores
_rise_, so the existing (minimum) floors should still pass, but the floors
must be re-derived from the new measurements and tightened.

**How to complete it:**

1. CI run #1 — `gh workflow run mutation.yml --ref fix/mutation-gate-static-mutants -f module=all`
   → run **`39990082229`** (dispatched 2026-10-23 16:50Z) — uploads
   `reports/mutation/mutation.json` as an artifact with `if: always()`, so the
   report survives even if a floor fails.
2. Download the artifact, run `computeModuleScores` over it, and set each floor
   to `floor(measured_score - 1)`.
3. Update the pinned expectations in `tests/mutation-floor.test.ts`
   (the `floor(77.78 - 1) // 76` style assertions).
4. Re-measure the uncovered counts and lower `uncoveredBudgets` to match.
5. Push → CI run #2 must be green.

---

## Task 3 — Other failure causes: ✅ RESOLVED

The only remaining cause was the runtime. Secondary observations worth knowing:

- `combat` is deliberately excluded from `stryker.config.js`'s `mutate` list
  (issues #1989 / #2055) but **is** mutated in CI via
  `npm run mutate:combat` → `--mutate src/lib/game-state/combat/*.ts`.
  It therefore has no `floors` entry and falls back to `defaultFloor`; it does
  have an `uncoveredBudgets` entry (351).
- `oracle-text-parser-abilities` reports **zero** static mutants, so its
  uncovered budget is 0. Its slowness is from _timed-out_ mutants (555 of 598),
  not from static ones.
- `stryker.config.js` and `scripts/` are eslint-ignored (lint shows
  "File ignored" warnings, 0 errors).

---

## Local validation

- `npx jest tests/mutation-floor.test.ts` → **43 passed** (was 36; +7 new).
- `npx tsc --noEmit` → clean.
- `npx eslint` on the touched files → 0 errors.
- Local Stryker run of `state-based-actions` (511 mutants) confirms
  `ignoreStatic` is honoured: the `Detected N static mutants` warning no longer
  appears (Stryker only emits it when `ignoreStatic` is off). The same local
  run then failed its **dry run** with "There were failed tests in the initial
  test run" — that was CPU contention, not a defect: the full Jest suite was
  running concurrently for the test-count ratchet, and the same suite passes
  twice on its own (14,884 passed). CI is the authoritative measurement.
- `node scripts/check-mutation-config.mjs` → OK, and the new check 3b was
  negative-tested (removing a module's budget makes the guard fail).
- `node scripts/mutation-floor.js` was smoke-tested against synthetic reports:
  a module over its uncovered budget fails with exit 1, a module exactly at
  its budget passes, and a below-floor score still fails as before.
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
  conventional.
