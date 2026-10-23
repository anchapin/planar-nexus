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
 *   • src/lib/game-state/layer-system.ts        : 56.65% (PR #1297, CI run
 *     28489517797) → floor 55. Issue #1711 added the targeted
 *     `layer-system.mutation.test.ts` suite to lift the baseline toward 70%;
 *     the floor is ratcheted to floor(new measured − 1) once the next
 *     successful nightly run (#1785) re-measures it.
 *   • src/lib/game-state/replacement-effects.ts : 77.78% (293 killed / 441
 *     mutants) → floor 76
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
 *   • src/lib/game-state/state-based-actions.ts : PENDING measurement (issue
 *     #1395) → conservative 50 — TO BE RACKETED to floor(measured − 1) once
 *     the first successful nightly run (#1785) records its score.
 *   • src/lib/game-state/combat.ts : 45.00% measured (839 mutants, 45% static).
 *     Issue #1988: re-added to fix suiteFor mismatch. Runs in nightly
 *     workflow only (~40 min job timeout); too slow for per-PR gate.
 *   • src/lib/game-state/mana.ts : PENDING measurement (issue #1717, 7th
 *     Stryker module). Issue #1717 added the targeted
 *     `mana.mutation.test.ts` suite (canAffordMana boundaries, spendMana
 *     generic-payment cascade, land-play timing, mana-ability parsing and
 *     activation conditions) → conservative 50 (the current aggregate
 *     break) — TO BE RACKETED to floor(measured − 1) once the first
 *     successful nightly run (#1785) records its score.
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
    "src/lib/game-state/layer-system/*.ts": 55,
    "src/lib/game-state/replacement-effects/*.ts": 76,
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
    "src/lib/game-state/state-based-actions.ts": 50,
    // Issue #1989/#2055: combat.ts excluded from Stryker mutate allowlist
    // (40+ min runtime makes it nightly-only; suite is pin/neutered so
    // mutation score is meaningless). Removed from floors config.
    //
    // Issue #1717: 7th Stryker module. Conservative pending-measurement
    // floor — ratchet to floor(measured − 1) once the first successful
    // nightly run (#1785) records its score.
    "src/lib/game-state/mana/*.ts": 50,
    // Issue #2186: 8th and 9th Stryker modules. Conservative pending-
    // measurement floors for keyword-actions/*.ts (MTG keyword abilities and
    // actions) and abilities.ts (ability word parsing in oracle-text-parser).
    // Ratchet to floor(measured − 1) once the first successful nightly run
    // records its score.
    "src/lib/game-state/keyword-actions/*.ts": 50,
    "src/lib/game-state/oracle-text-parser/abilities.ts": 50,
  },
  // Issue #1785: stryker.config.js sets ignoreStatic, so Stryker skips the
  // mutants that no test covers instead of re-running the whole suite for
  // each one. That is what keeps every leg inside the 180-minute CI job
  // timeout, but it also removes that debt from the mutation score.
  //
  // These budgets put the debt back under a gate. Each value is the count
  // Stryker reported as static in nightly run 39925581871 (main@685223a5),
  // i.e. the exact number of mutants that would have been reported as
  // status "Ignored". A module violates its budget when its uncovered count
  // rises above the number below: coverage debt may only shrink, never grow.
  //
  // Re-measure and lower these (never raise them) when coverage improves.
  uncoveredBudgets: {
    "src/lib/game-state/layer-system/*.ts": 243,
    "src/lib/game-state/replacement-effects/*.ts": 87,
    "src/lib/game-state/spell-casting/*.ts": 639,
    "src/lib/game-state/trigger-system/*.ts": 94,
    "src/lib/game-state/state-based-actions.ts": 190,
    "src/lib/game-state/mana/*.ts": 368,
    "src/lib/game-state/keyword-actions/*.ts": 1497,
    "src/lib/game-state/oracle-text-parser/abilities.ts": 0,
    "src/lib/game-state/combat/*.ts": 351,
  },
  // Files no budget glob claims are a configuration gap, not real debt, so
  // they get no allowance: any uncovered mutant in one fails the gate.
  defaultUncoveredBudget: 0,
};
