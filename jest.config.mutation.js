/**
 * Jest config for Stryker mutation runs only — issue #1785.
 *
 * The AI simulation tests carry known-flaky cases. The clearest is
 * `src/ai/__tests__/simulation/expert-agent.test.ts` → "is deterministic for
 * a seed and leaves the game where it was": it plays the same seeded game
 * twice and compares the action stream, and it intermittently diverges.
 * `AGENTS.md` already lists `forge-gate` / `forge-selfplay` / `expert-agent`
 * as known flake noise.
 *
 * Stryker runs the whole suite in its dry run to build the per-test coverage
 * map, so a single flaky failure aborts the whole mutation leg before it
 * produces a report:
 *
 *   - nightly run 40052506479: the `mana` leg died 5 minutes in with
 *     "There were failed tests in the initial test run";
 *   - nightly run 40076898019: the `keyword-actions` and `trigger-system`
 *     legs died the same way.
 *
 * The same flake inside a mutant run would mark mutants it does not actually
 * break as killed, inflating the score — so it has to be out of the mutation
 * run entirely, not just out of the dry run.
 *
 * These tests are not needed to build the mutation coverage map for
 * `src/lib/game-state/**`. Normal `npm test` is unaffected: `jest.config.js`
 * is untouched and still runs them.
 */
const base = require("./jest.config.js");

module.exports = {
  ...base,
  testPathIgnorePatterns: [
    ...(base.testPathIgnorePatterns ?? []),
    // The simulation harness plays full seeded games, so it carries the
    // determinism flake.
    "<rootDir>/src/ai/__tests__/simulation/",
    // The forge tests are the other two known-flaky families AGENTS.md
    // lists. `src/ai/manamind/**` does not depend on `src/lib/game-state/**`,
    // so dropping its tests cannot change the mutation coverage map.
    "<rootDir>/src/ai/manamind/__tests__/",
  ],
};
