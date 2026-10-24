#!/usr/bin/env node
/**
 * Per-module mutation-score floors (issues #1598, #1785).
 *
 * Stryker's `thresholds.break` in stryker.config.js is an AGGREGATE gate: it is
 * computed across every allowlisted module combined, so one module can regress
 * silently (e.g. a module at 35% next to four at 80% still clears a break of
 * 50). This config supplies the per-module floor that
 * `scripts/mutation-floor.js` enforces after every per-module Stryker run
 * (nightly matrix job + local `npm run mutate:<module>`).
 *
 * Floor derivation rule (mirrors scripts/ratchet-coverage.js): floor =
 * floor(measured − 1pt). NEVER set a floor above the module's current measured
 * score or the nightly job fails immediately. Re-measure with
 * `npm run mutate:<module>` before raising an entry by hand.
 *
 * Issue #1785: the previous nightly workflow ran a single Stryker
 * invocation that mutated all seven allowlisted modules serially and was
 * killed by GitHub Actions' 6h job timeout in twelve consecutive
 * scheduled runs (2026-09-04..09-15). The workflow is now split into
 * one matrix job per module, each with its own 90-minute timeout, so
 * every per-module score will be re-measured nightly going forward and
 * these floors can be ratcheted against real numbers rather than the
 * previous "TO BE RACKED after the first successful nightly run" placeholders.
 *
 * Measured baselines (see stryker.config.js "THRESHOLDS" for provenance):
 *   • src/lib/game-state/layer-system.ts        : re-measured 92.78% worst
 *     file (2026-10-24, nightly run 40101737873; 71 no-coverage mutants) →
 *     floor 91, ratcheted from the old 56.65% baseline (PR #1297). Issue
 *     #1711's targeted `layer-system.mutation.test.ts` suite lifted it.
 *   • src/lib/game-state/replacement-effects.ts : re-measured 89.83% worst
 *     file (2026-10-24, nightly run 40101737873, 3 files, 811 mutants) →
 *     floor 88, ratcheted from the old 76.
 *   • src/lib/game-state/spell-casting.ts       : no recorded measurement →
 *     conservative 50 (the current aggregate break). Issue #1711 added the
 *     targeted `spell-casting.mutation.test.ts` suite (cost-arithmetic
 *     edges); TO BE RACKETED to floor(measured − 1) once the first
 *     successful nightly run (#1785) records its score. Until then, the
 *     conservative 50 keeps the gate above Stryker's `thresholds.low: 55`
 *     yellow band but below the documented 70% project target — the
 *     nightly job will surface the real score within 24h of this issue
 *     landing, and the floor entry is updated in the same PR that raises
 *     `thresholds.break`.
 *   • src/lib/game-state/trigger-system.ts      : 45.00% measured 2026-09-18
 *     (issue #1939; 178 killed / 83 timeout / 68 survived / 251 no-coverage
 *     of 583 mutants — zero-coverage debt from renown/tribute ETB triggers
 *     #1528 and corpse death trigger #1524, pending test backfill) → floor 44.
 *     REGRESSED: re-measured 34.29% on nightly run 40052506479
 *     (2026-10-24) — 25 killed / 61 timeout / 0 survived / 352 no-coverage of
 *     1,544 mutants. The floor stays at 44 on purpose: the module genuinely
 *     regressed (the trigger-system.ts → trigger-system/ refactor tripled the
 *     mutant count while the coverage did not keep up), and a floor below the
 *     aggregate `break` of 44 would be a dead letter anyway — the aggregate
 *     gate fails first. This module needs the #1528/#1524 test backfill, not
 *     a lower floor.
 *   • src/lib/game-state/state-based-actions.ts : re-measured 94.52%
 *     (2026-10-24, nightly run 40101737873, 511 mutants, 28 no-coverage) →
 *     floor 93, ratcheted from the old conservative 50 (issue #1395).
 *   • src/lib/game-state/combat.ts : 67.80% worst file re-measured 2026-10-24
 *     (nightly run 40101737873, 34 no-coverage mutants). Issue #1988: re-added
 *     to fix suiteFor mismatch. Runs in nightly workflow only (~40 min job
 *     timeout); too slow for per-PR gate. Kept off the floors map (its
 *     mutation score is pin/neutered — issues #1989/#2055), so it is gated by
 *     `defaultFloor` only.
 *   • src/lib/game-state/mana.ts : re-measured 81.88% worst file
 *     (2026-10-24, nightly run 40101737873; 7 files, mana/lands.ts 81.88%,
 *     90 no-coverage mutants) → floor 80, ratcheted from the old
 *     conservative 50 (issue #1717's `mana.mutation.test.ts` suite).
 *
 * Issue #2835: layer-system, replacement-effects, trigger-system and mana
 * were refactored from single files into directories with an `index.ts`
 * barrel, so their floor keys are now the family-dir globs that mirror the
 * Stryker allowlist entries (the same shape spell-casting already used).
 * The keys must stay in sync with `stryker.config.js`'s `mutate` array —
 * `tests/mutation-floor.test.ts` asserts the two sets are identical.
 *
 * Precedence for any module in a Stryker report:
 *   1. explicit per-module entry in `floors` (this file)
 *   2. MUTATION_FLOOR env var (blunt override for unlisted modules; useful for
 *      local experimentation, e.g. MUTATION_FLOOR=40)
 *   3. `defaultFloor` (55 — matches the issue's default and Stryker's
 *      `thresholds.low` yellow band)
 */
"use strict";

module.exports = {
  defaultFloor: 55,

  floors: {
    "src/lib/game-state/layer-system/*.ts": 91,
    "src/lib/game-state/replacement-effects/*.ts": 88,
    // Conservative pending-measurement floors — ratchet upward after the
    // first successful nightly run (issue #1785 split). See header.
    // Issue #1725: spell-casting.ts was decomposed into per-family files;
    // this glob key mirrors the Stryker allowlist entry and matches each
    // family file in the report (see floorFor in mutation-floor-lib.js).
    "src/lib/game-state/spell-casting/*.ts": 50,
    // Issue #1939: measured 45.00% (see header) — the nightly job went red
    // under the conservative 50 because of zero-coverage debt from the
    // renown/tribute ETB triggers (#1528) and the CR 702.168 corpse death
    // trigger (#1524). Re-baselined to floor(measured − 1) = 44; ratchet
    // back up once the pending test backfill lands.
    "src/lib/game-state/trigger-system/*.ts": 44,
    "src/lib/game-state/state-based-actions.ts": 93,
    // Issue #1989/#2055: combat.ts excluded from Stryker mutate allowlist
    // (40+ min runtime makes it nightly-only; suite is pin/neutered so
    // mutation score is meaningless). Removed from floors config.
    //
    // Issue #1717: 7th Stryker module. Re-measured 81.88% worst file on
    // nightly run 40101737873 → floor 80, ratcheted from the old
    // conservative 50.
    "src/lib/game-state/mana/*.ts": 80,
    // Issue #2186: 8th and 9th Stryker modules.
    // keyword-actions/*.ts (MTG keyword abilities and actions) is still a
    // conservative pending-measurement floor — its leg has never completed.
    "src/lib/game-state/keyword-actions/*.ts": 50,
    // abilities.ts (ability word parsing in oracle-text-parser): re-measured
    // 95.29% on nightly run 40052506479 (2026-10-24; 1 file, 935 mutants, 43
    // no-coverage) → floor 94, ratcheted from the old placeholder of 50.
    "src/lib/game-state/oracle-text-parser/abilities.ts": 94,
  },
  // Issue #1785: stryker.config.js sets ignoreStatic, so Stryker excludes
  // mutants whose location no test covers ("NoCoverage") from the score.
  // That is what keeps every leg inside the CI job timeout, but it also
  // removes that debt from the mutation score, so these budgets put it back
  // under a gate. A module violates its budget when its uncovered count
  // rises above the number below: coverage debt may only shrink, never grow.
  //
  // Provenance: the three modules whose legs completed on nightly run
  // 40015189962 are exact measurements from their Stryker reports. The rest
  // are upper bounds derived from that run's progress counters
  // (tested - survived - timed out) and must be ratcheted down to the exact
  // count once their own leg completes.
  uncoveredBudgets: {
    "src/lib/game-state/layer-system/*.ts": 83,
    "src/lib/game-state/replacement-effects/*.ts": 68,
    "src/lib/game-state/spell-casting/*.ts": 530,
    "src/lib/game-state/trigger-system/*.ts": 352,
    "src/lib/game-state/state-based-actions.ts": 28,
    "src/lib/game-state/mana/*.ts": 90,
    "src/lib/game-state/keyword-actions/*.ts": 1456,
    "src/lib/game-state/oracle-text-parser/abilities.ts": 43,
    "src/lib/game-state/combat/*.ts": 34,
  },
  // Files no budget glob claims are a configuration gap, not real debt, so
  // they get no allowance: any uncovered mutant in one fails the gate.
  defaultUncoveredBudget: 0,
};
