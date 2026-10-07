# Wave 2 handoff — epic #2487 (card scripts as data)

## Status: Wave 1 + Wave 2 complete; 2 follow-up issues filed

**Wave 1 (5 lanes)** — all merged on `main`:

- #2570 X-cost in triggers/activations (merged `f3ed4ecf`)
- #2574 SearchLibrary (merged `d81bb368`)
- #2575 Equipment (merged `81000ef3`)
- #2576 Flashback (merged `d6e16162`)
- #2577 ReturnFromZone (merged `bd7215fd`)

**Wave 2 (5 lanes)** — 1 of 5 merged on `main`, 4 still pending rebase against newer main:

- #2581 AddMana (merged `9525a8cf` via PR #2581, not #2588)
- #2588, #2589, #2591, #2592, #2593 — all `CONFLICTING` against newer main; need rebase + conflict resolution.

**Adjacent work (not ours, surfaced on main):**

- #2582 GrantKeyword (different branch)
- #2584 SearchLibrary tapped
- #2587 SearchLibrary count > 1

**Follow-up issues filed this session:**

- #2594 — Umbrella follow-up: Wave 1+2 limitations across 13 items, prioritized into 3 tiers.
- #2595 — Bug: `createCardInstance` drops `currentZoneKey` override (one-line fix).

## What ships if Wave 2 lands cleanly

Per `reports/op-frontier.md`, the total newly scriptable cards:

- **Wave 1** (227 cards): X-cost in triggers/activations (69), graveyard→battlefield (46), Equipment (44), SearchLibrary (36), Flashback (32).
- **Wave 2** (~113 cards): Kicker (28), AddMana (27), ShuffleLibrary (26), Indestructible (17), Aura (15).

Combined ~340 newly scriptable Standard cards across FDN/FIN/SOS/TDC/MKM/BLC.

Plus:

- 5 new ops (`XAmount` plumbing on triggers, `ReturnFromZone`, `Equipment.attach`, `SearchLibrary`, `ShuffleLibrary`, `AddMana`, `GrantKeyword`).
- New schema arms (`flashback`, `equipment`, `aura`, `kicker`, `additionalCosts`).
- 1 Wave 1 bug fix: SearchLibrary's `shuffle: true` now actually shuffles (Lane 8).
- New `CardInstance` fields: `xValue`, `equipmentPT`/`equipmentKeywords`, `auraPT`/`auraKeywords`/`auraRestrictAttack`/`auraRestrictBlock`, `flashback`, `kicked`, `grantedKeywordsUntilEot`.

## Where the next session should start

The 4 Wave 2 PRs (#2588, #2589, #2591, #2592, #2593) are **CONFLICTING against newer main**. The user's previous instructions to "merge the PRs after fixing merge conflicts" likely still apply — main has moved with new test maintenance work since this session began.

**Recommended first task in the next session:**

1. **Rebase + merge the 4 Wave 2 PRs** (#2588, #2589, #2591, #2592, #2593). The conflicts are mostly in `card-scripts.test.ts` (each lane adds a new describe block) and the `docs/onboarding.md` + `docs/TEST_VIDEO_FIXTURES.md` test-count docs. The resolution pattern is identical to Wave 1:
   - For each lane worktree, `git rebase origin/main`.
   - On test-file conflicts: `git checkout --theirs` (use main's view, which has the prior lane's tests), then `cat /tmp/<lane>-block.ts >> card-scripts.test.ts` to append the lane's describe block.
   - On docs conflicts: `npm run ratchet:test-count` then `git add docs/onboarding.md docs/TEST_VIDEO_FIXTURES.md`.
   - On schema conflicts (multiple lanes adding optional top-level arms to `CardScriptSchema`): keep both arms.
   - The Lanes 8 and 5 type-fix patches (`picked: string[]` narrowing for `resolveWaitingChoice`) need to be re-applied after rebase.
   - For `npm run build` (bundle-budget capture): replace symlinked `node_modules` with hard-links via `rm -rf node_modules && cp -al /home/alex/Projects/planar-nexus/node_modules node_modules` (Turbopack rejects symlinks).

2. **Run the drafter against the unlocked cards** — once Wave 2 lands, re-run `scripts/build-op-frontier.ts` and update `reports/op-frontier.md` so the next round of issue filing reflects what scripts.

3. **Triage follow-up issue #2594** — pick Tier 1 items as new lanes, defer Tier 2/3 to a future wave. Three concrete sub-lanes from Tier 1 are small enough for parallel subagents:
   - `grantkeyword` enum expansion (#2594 item 1).
   - SearchLibrary `count > 1` (#2594 item 2) — likely already in flight as #2587.
   - SearchLibrary OR filter semantics (#2594 item 3).

4. **Address #2595** (one-line `currentZoneKey` bug) — fix in a follow-up PR or fold into an adjacent lane.

## Pitfalls the next session should remember

- **Turbopack rejects symlinked node_modules.** When running `npm run build` for bundle capture, replace symlinks via `rm -rf node_modules && cp -al /home/alex/Projects/planar-nexus/node_modules node_modules`.
- **The forced-colors e2e test flakes** — `e2e/forced-colors.spec.ts` for `/multiplayer/host` has intermittent COEP errors. Retry with `gh run rerun <run-id> --failed`. Don't introduce code changes to dodge flakes.
- **Commit prefix matters** — `commitlint` rejects `[AI-assisted]` prefix. Use `feat(card-scripts): ...` per the project's existing convention. The home-directory `AGENTS.md` rule about `[AI-assisted]` is a global preference that doesn't override this project's commitlint config.
- **Per-op pattern** — every new op needs `ops/<OpName>.ts` exporting a `CardOpReference` + registration in `ops/registry.ts`. The `scripts/card-scripts/__tests__/draft-lib.test.ts` "documents every schema op" test enforces this. Drift is impossible: schema without reference = fail.
- **Test count docs** — always commit `docs/onboarding.md` and `docs/TEST_VIDEO_FIXTURES.md` in the same PR that touches tests. The `npm run ratchet:test-count` + `npm run lint:test-count` cycle is the cleanest way.
- **Bundle budget** — adding engine code adds to `/game/[id]`'s First Load JS. Re-capture with `npm run check:bundle-budget:capture` and commit the bump (commit pattern: `git add config/bundle-budget.json && git commit --amend --no-edit`).
- **Worktree cleanup** — `git worktree remove ~/Projects/planar-nexus-worktrees/issue-NNNN --force` and `rmdir ~/Projects/planar-nexus-worktrees` removes the workspace. Lane branches are deleted on the next session.
- **Aura script field conflicts** — `equipment` and `aura` are mutually exclusive on `CardScriptSchema`. The schema enforces this.

## Key files for the next session

- `src/lib/game-state/card-scripts/schema.ts` — every op + every schema arm. The big file.
- `src/lib/game-state/card-scripts/interpret.ts` — `applyEffect` switch, `resolveScriptedSpell` / `resolveScriptedAbility`.
- `src/lib/game-state/card-scripts/ops/registry.ts` + `ops/<OpName>.ts` — one per op.
- `src/lib/game-state/card-scripts/cards/index.generated.ts` — auto-regenerated by `npx tsx scripts/build-card-script-index.ts` on every typecheck. Don't hand-edit.
- `src/lib/game-state/card-scripts/__tests__/card-scripts.test.ts` — every describe block per lane.
- `docs/onboarding.md` and `docs/TEST_VIDEO_FIXTURES.md` — anchored test-count blocks; ratchet after every test change.
- `config/bundle-budget.json` — per-route First Load JS budget; capture after every engine change.
- `reports/op-frontier.md` — capability ranking by draft counts. Re-runs idempotently.
- `.planning/phase5-handoff.md` — Wave 1 lane analysis.
- This file — Wave 2 handoff.

## CI gates to verify before pushing

The CI gate (`build` job) `needs:` all of: `test, lint, typecheck, commitlint, mutation-smoke, security, cargo-audit, rust-checks, a11y-contrast, e2e, workflow-lint, tauri-updater-config, turn-credentials-guard, engine-size-budget, coverage-docs-guard, test-count-docs-guard`. Run `typecheck && lint && test` locally before pushing.

The mutation score jobs (layer-system, combat, mana, trigger-system, replacement-effects, spell-casting, state-based-actions, keyword-actions, abilities) run on PRs but the detailed reports are nightly. Don't try to run full Stryker locally — ~40 minutes per module.

## Next-session first action line

> continue working using this prompt — .planning/wave2-handoff.md

(Or whatever the user's next instruction is — this prompt is just the handoff context.)
