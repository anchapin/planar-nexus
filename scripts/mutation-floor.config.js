#!/usr/bin/env node
/**
 * Per-module mutation-score floors (issue #1598).
 *
 * Stryker's `thresholds.break` in stryker.config.js is an AGGREGATE gate: it is
 * computed across every allowlisted module combined, so one module can regress
 * silently (e.g. a module at 35% next to four at 80% still clears a break of
 * 50). This config supplies the per-module floor that
 * `scripts/mutation-floor.js` enforces after every full Stryker run (nightly
 * workflow + local `npm run test:mutation`).
 *
 * Floor derivation rule (mirrors scripts/ratchet-coverage.js): floor =
 * floor(measured − 1pt). NEVER set a floor above the module's current measured
 * score or the nightly job fails immediately. Re-measure with
 * `npm run mutate:<module>` before raising an entry by hand.
 *
 * Measured baselines (see stryker.config.js "THRESHOLDS" for provenance):
 *   • src/lib/game-state/layer-system.ts        : 56.65% (PR #1297, CI run
 *     28489517797) → floor 55
 *   • src/lib/game-state/replacement-effects.ts : 77.78% (293 killed / 441
 *     mutants) → floor 76
 *   • src/lib/game-state/spell-casting.ts       : no recorded measurement →
 *     conservative 50 (the current aggregate break) — TO BE RATCHETED after
 *     the first successful nightly run records its score.
 *   • src/lib/game-state/trigger-system.ts      : PENDING measurement (issue
 *     #1395) → conservative 50 — TO BE RATCHETED after the first successful
 *     nightly run records its score.
 *   • src/lib/game-state/state-based-actions.ts : PENDING measurement (issue
 *     #1395) → conservative 50 — TO BE RATCHETED after the first successful
 *     nightly run records its score.
 *   • src/lib/game-state/combat.ts : PENDING measurement (issue #1597) — a
 *     local `npm run mutate:combat` run exceeded 40 min without completing
 *     (839 mutants, 45% static) → conservative 50 (the current aggregate
 *     break) — TO BE RATCHETED after the first successful nightly run
 *     records its score.
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
    "src/lib/game-state/layer-system.ts": 55,
    "src/lib/game-state/replacement-effects.ts": 76,
    // Conservative pending-measurement floors — ratchet upward after the
    // first successful nightly run (issue #1598 follow-up). See header.
    "src/lib/game-state/spell-casting.ts": 50,
    "src/lib/game-state/trigger-system.ts": 50,
    "src/lib/game-state/state-based-actions.ts": 50,
    // Issue #1597: 6th Stryker module. Conservative pending-measurement
    // floor (local single-module run exceeded the time budget) — ratchet
    // upward after the first successful nightly run records its score.
    "src/lib/game-state/combat.ts": 50,
  },
};
