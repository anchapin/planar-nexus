# Backend Result — Issue #1594: Shared priority-check helper

## Status

**DONE** — committed & pushed. No PR created (per instructions).

## Summary

Extracted the 11 duplicated `state.priorityPlayerId !== playerId` guards (enumerated in issue #1594) into one shared positive-form predicate `isPriorityPlayer(state, playerId)` in the new module `src/lib/game-state/priority-guard.ts`. All call-site failure semantics preserved exactly: `passPriority` still throws; check-style sites still return their own `{ canCast: false, reason }` / `{ success: false, state }` / `false` results. The helper uses `===` (positive form); sites negate with `!`, which is logically identical to the old `!==` (incl. the `null`-priority boundary).

## Files changed

- `src/lib/game-state/priority-guard.ts` — **new**: `isPriorityPlayer` helper (type-only import from `./types`; zero runtime deps → no circular-import risk)
- `src/lib/game-state/__tests__/priority-guard.test.ts` — **new**: 4 unit tests (priority match, mismatch, `null` priority, strict-equality non-coercion)
- `src/lib/game-state/index.ts` — barrel `export * from "./priority-guard"`
- `src/lib/game-state/game-state.ts` — 1 site (`passPriority`, still throws)
- `src/lib/game-state/mutate.ts` — 1 site (`canCastWithMutate`)
- `src/lib/game-state/prototype.ts` — 1 site (`canCastAsPrototype`)
- `src/lib/game-state/spell-casting.ts` — 1 site (`canCastSpell`)
- `src/lib/game-state/mana.ts` — 2 sites (`canPlayLand`, `activateManaAbility`)
- `src/lib/game-state/keyword-actions.ts` — 3 sites (`foretellCard`, `canCycleCard` [still returns false], `cycleCard`)
- `src/lib/game-state/abilities.ts` — 2 sites (`canActivateAbility`, `canActivateLoyaltyAbility`)

**Call sites replaced: 11 / 11** (acceptance regex `state\.priorityPlayerId !== playerId` in `src/lib/game-state/` now matches **0** lines; was 11).

## Acceptance criteria checklist (from issue)

- [x] Inline-check count drops 11 → 0 (verified via `rg`)
- [x] Previously-throwing site still throws; false-returning site (`canCycleCard`) still returns false — bodies untouched in diff, only the `if` condition swapped
- [x] Full rules-engine suite passes post-refactor, identical to baseline
- [x] Helper has its own unit tests (4/4 passing)

## Verification evidence

- **Baseline** (pre-refactor): `npx jest src/lib/game-state` → exit 0; **132 suites passed, 3032 passed, 4 skipped**
- **After**: exit 0; **133 suites passed, 3036 passed, 4 skipped** — delta is exactly the new helper test file; zero regressions
- `npm run typecheck` → exit 0
- `npm run lint` → exit 0 (0 errors; 615 pre-existing warnings, non-gating)
- Pre-handover checks: `git status --porcelain | grep -v .agents/results` empty; last commit subject references #1594

## Mutation-testing note (out-of-scope follow-up)

Stryker allowlist (`stryker.config.js`) contains `spell-casting.ts` among migrated modules. The surrounding `if`-statement mutants stay in `spell-casting.ts` and are killed by the same tests as before; only the equality-operator mutant (`!==`↔`===`) moved into `priority-guard.ts`, which is **not** on the allowlist — so `mutate:spell-casting` sees no new _surviving_ mutants (its mutant population shrinks by one; no survivor can be introduced by this extraction). The helper is now directly mutation-tested by its own unit suite; adding `priority-guard.ts` to the stryker allowlist is a candidate follow-up (config policy: add module-by-module once coverage ≥70%).

## Out-of-scope observations (documented, not changed)

- `validation-service.ts:155` uses the positive form `state.priorityPlayerId === action.playerId` and `:186/:621` use `!== action.playerId` — different variable (not among the issue's 11; the issue's acceptance regex excludes them). Candidate follow-up to route through the helper.
- `auto-pass-priority.ts:71` compares `state.priorityPlayerId !== ctx.humanPlayerId` — same situation.

## Blockers

None.

## Git

- Branch: `fix/issue-1594-priority-check-helper`
- Commit: see `git log -1` (header: `refactor: resolve #1594 — extract shared priority-check helper for 11 duplicated guards`)
- Pushed to `origin` with `--force-with-lease`. No PR (per instructions).
