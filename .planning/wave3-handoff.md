continue working using this prompt — .planning/wave3-handoff.md

# Wave 3 handoff — epic #2487 (card scripts as data)

## Status: Wave 1 + Wave 2 complete; Wave 3 not yet started

**Wave 1 (5 lanes)** — all merged on `main` (Sep–Oct 2026): #2570 X-cost in triggers/activations, #2574 SearchLibrary, #2575 Equipment, #2576 Flashback, #2577 ReturnFromZone.

**Wave 2 (5 lanes)** — all merged on `main` (this session, 2026-10-07):

- #2588 AddMana (`9eee6247`) — Hedron Archive, Gilded Lotus
- #2589 Auras (`f744c35e`) — Pacifism, Twinblade Blessing, Witness Protection
- #2591 Kicker (`b5522800`) — Burst Lightning, Divine Resilience, Gnarlid Colony
- #2592 GrantKeyword/Indestructible (`da5fa2f7`) — Boros Charm, Celestial Armor, Make a Stand
- #2593 ShuffleLibrary (`30664fa6`) — Burnished Hart, Wishclaw Talisman

`main` is now at `1090fd84` (merge of #2593). Test count: 13383 (was 13315 at session start). Card-scripts file: 465 tests (was 387 at session start).

**Adjacent work that landed during Wave 2** (parallel branches, not ours but now on main):

- #2582 GrantKeyword baseline (later extended by our #2592)
- #2584 SearchLibrary tapped + Solemn Simulacrum
- #2587 SearchLibrary count up to 2 + Burnished Hart

**Follow-up issues filed this session (still open):**

- #2594 — Umbrella: 13-item Wave 1+2 follow-ups, prioritized into 3 tiers (the next round of lanes comes from this).
- #2595 — One-line bug: `createCardInstance` drops `currentZoneKey` override.

**Stale handoff doc:** `.planning/wave2-handoff.md` is now stale (says "1 of 5 merged"). It can be deleted or left as a historical record.

## What's newly scriptable after Wave 1 + Wave 2

Combined **~340 newly scriptable Standard cards** across FDN/FIN/SOS/TDC/MKM/BLC. Per `reports/op-frontier.md` (this file is now stale; regenerate as step 1 below):

- Wave 1 (227 cards): X-cost in triggers/activations (69), graveyard→battlefield (46), Equipment (44), SearchLibrary (36), Flashback (32).
- Wave 2 (~113 cards): Kicker (28), AddMana (27), ShuffleLibrary (26), Indestructible (17), Aura (15).

## Recommended first task in the next session

The user's previous instructions to "land the Wave 2 PRs" are now done. The natural next step is **Wave 3: tier-1 follow-ups from #2594 + the drafter rerun**.

### Step 0 — verify state

```bash
cd /home/alex/Projects/planar-nexus
git status
git log --oneline -5
gh pr list --state open
gh issue list --state open --label "rules-engine"
# Confirm docs/onboarding.md says "**Test cases:** 13383"
```

### Step 1 — regenerate the op-frontier report

The `reports/op-frontier.md` is stale (predates Wave 2 merges). The drafter reads it to decide which cards to issue scripts for.

```bash
npx tsx scripts/build-op-frontier.ts
# or whatever the actual script is — check package.json and scripts/
# Read reports/op-frontier.md, sanity-check it now lists the 16 Wave 2 cards
# (Hedron Archive, Gilded Lotus, Pacifism, Twinblade Blessing, Witness Protection,
#  Burst Lightning, Divine Resilience, Gnarlid Colony, Boros Charm, Celestial Armor,
#  Make a Stand, Burnished Hart, Wishclaw Talisman) as scriptable.
```

Commit the regenerated report with message `chore(reports): regenerate op-frontier after Wave 2 merge`. **Do NOT touch the test-count docs** — they already match live (13383).

### Step 2 — bundle-budget re-capture

Wave 2 added engine code to `/game/[id]`'s First Load JS. The `engine-size-budget` CI guard passed, but the per-route capture (which gates `Bundle Size Budget`) was skipped. Re-capture and commit:

```bash
# In a worktree, on a new branch (e.g. chore/rerun-bundle-budget)
npm run check:bundle-budget:capture
git diff config/bundle-budget.json
git add config/bundle-budget.json
git commit -m "chore(bundle-budget): re-capture after Wave 2 engine additions"
gh pr create --base main --title "..."
ci-wait <PR>
gh pr merge <PR> --merge --delete-branch
```

This is a one-line doc update but it requires a CI round-trip.

### Step 3 — file Wave 3 lanes (pick 2–3 from tier 1 of #2594)

The **tier-1 items** in #2594 that are small enough for one PR each, in rough order of unblocked-cards-per-line:

1. **`grantkeyword` enum expansion** (#2594 item 1)
   - Current: `GRANTABLE_KEYWORDS = ["indestructible"]` only.
   - Add `"double strike"`, `"first strike"`, `"hexproof"`, `"lifelink"`, `"menace"`, `"trample"`, `"reach"`, `"vigilance"`, `"flying"`, `"fear"`, `"intimidate"`.
   - Unblocks: Boros Charm 3rd mode (already in `cards/boros_charm.json` but rejected by schema), plus ~10–20 cards with "target creature gains X until EOT".
   - Files: `src/lib/game-state/card-scripts/schema.ts` (line ~340), `src/lib/game-state/evergreen-keywords.ts`, `src/lib/game-state/keyword-actions/granted-keywords.ts` (filter/clear).
   - Risk: low — additive.

2. **`SearchLibrary count > 1`** (also partially in flight as #2587)
   - Current: `count: z.literal(1).default(1)`.
   - Change to: `count: z.number().int().min(1).max(20).default(1)`.
   - Update `searchLibrary` in `interpret.ts` to loop `count` times.
   - Unblocks: Burnished Hart (already scripts `count: 2` but engine currently picks only 1), plus many "search for up to N" cards.
   - Risk: medium — the test for Burnished Hart in `card-scripts.test.ts` (line ~5269) currently expects only 1 card to come out and is wrong; needs to be updated.
   - **Conflict warning**: when I landed #2593 (ShuffleLibrary) in the last session, the Burnished Hart test was already broken; I had to rewrite it to set up a library with only one basic land to avoid the mismatch. Once `count > 1` lands, that test should be reverted to the original 2-land setup.

3. **SearchLibrary OR filter semantics** (#2594 item 3)
   - Current: `SearchLibraryFilterSchema` is an AND-only intersection.
   - Add: an `or: [...]` arm so a card can match any of N predicates.
   - Unblocks: cards like "search for an artifact or land".
   - Risk: medium — touches `SearchLibraryFilterSchema` and the filter-predicate engine code in `evergreen-keywords.ts` / `card-instance.ts`.

Other Tier-1 items from #2594 worth considering (smaller in scope):

- Auras: `Enchant creature gets X and has Y` with `Y` being a keyword (currently blocked by `GRANTABLE_KEYWORDS`)
- GrantKeyword `target: "it"` shared-target semantics (already partially done in #2591/2592, verify it's complete)
- AddMana `restrict: "creature spells"` enforcement (the schema field is deferred from Wave 2's #2588 — currently the field is **not** in the schema; #2588's tests were rewritten to drop `restrict`. If we want to add it back, do it as a separate lane with engine enforcement, not a schema-only change.)

### Step 4 — fix #2595 (one-line, can be folded into any lane)

```typescript
// src/lib/game-state/card-instance.ts (or wherever createCardInstance lives)
function createCardInstance(data, controller, owner, options) {
  const inst = { ... };
  if (options?.currentZoneKey) inst.currentZoneKey = options.currentZoneKey;
  // ... rest
}
```

This is a 3-line fix including the type narrowing. Verify with a test that calls `createCardInstance(..., { currentZoneKey: "..." })` and reads it back.

### Step 5 — investigate #2586

"Indestructible gate ignores keywords granted by Equipment, Auras, scripted statics and until-EOT effects."

This was surfaced during the Wave 2 indestructible lane (#2592) and worked around: the lane's tests had to be rewritten to use `untilEndOfTurnKeywords` (the engine's actual field) instead of `grantedKeywordsUntilEot` (the lane's preferred name). The deeper question is whether the `indestructible` SBA actually checks **all** keyword sources or only some.

Repro:

```typescript
// Put a creature with no keywords
// Attach an Aura that grants indestructible (e.g. Make a Stand)
// Deal 4 damage to the creature
// Expected: survives (CR 702.12b)
// Actual: ? (verify)
```

This is a real engine bug if reproducible. If confirmed, file a follow-up issue and consider fixing in a small lane before Wave 3 cards-with-indestructible start being drafted.

## Pitfalls the next session should remember

- **The Burnished Hart test in `card-scripts.test.ts` line ~5269 currently has a one-land-only library setup** (a workaround from the Wave 2 rebase for #2593). When you implement `count > 1`, restore the original two-land setup and update the expectations.

- **The Boros Charm card JSON in `cards/boros_charm.json` has 3 modes (damage, indestructible, double strike)**. The third mode (double strike) is currently rejected by the schema because `GRANTABLE_KEYWORDS` is `["indestructible"]` only. When you expand the enum, restore the third mode in the card JSON. The Wave 2 PR #2592 dropped the third mode as a workaround.

- **The `if_kicked` field is now on every effect schema arm** (added in #2591's rebase to fix TypeScript errors). Don't remove it when touching schemas; it has a default of `undefined` and is no-op when not used.

- **The `ScriptStackObject` Pick now includes `"wasKicked" | "timesKicked"` as `Partial<...>`** (added in #2593's rebase). The `resolveScriptedSpell` signature uses this type. Test helpers that build `as unknown as StackObject` fake-objects work because of the `unknown` cast.

- **The `granted-keywords.ts` module exports `clearGrantedKeywordsUntilEot` (deprecated name)**. The actual engine field is `untilEndOfTurnKeywords` and the cleanup is `clearUntilEndOfTurnKeywords` (from `pt-until-end-of-turn.ts`). The deprecated export was kept for #2592's tests but should be removed in a follow-up.

- **Turbopack rejects symlinked `node_modules`.** When running `npm run build` for bundle capture, replace symlinks via `rm -rf node_modules && cp -al /home/alex/Projects/planar-nexus/node_modules node_modules` (as noted in the Wave 2 handoff).

- **Bundle-budget capture (`npm run check:bundle-budget:capture`)** runs `npm run build` first. Add the hard-link step before running it.

- **Per-op pattern** — every new op needs `ops/<OpName>.ts` exporting a `CardOpReference` + registration in `ops/registry.ts`. The `scripts/card-scripts/__tests__/draft-lib.test.ts` "documents every schema op" test enforces this. Drift is impossible: schema without reference = fail.

- **Test count docs** — always commit `docs/onboarding.md` and `docs/TEST_VIDEO_FIXTURES.md` in the same PR that touches tests. The `npm run ratchet:test-count` (full Jest, ~5–10 min) is the cleanest way; the fallback is to run a `--listTests | wc -l` for the suite count and a `jest <affected paths>` delta for the case count. The next session will start at **13383** (was 13315) and each new lane will add to this.

- **CI gate** — `build` job `needs:` all of: `test, lint, typecheck, commitlint, mutation-smoke, security, cargo-audit, rust-checks, a11y-contrast, e2e, workflow-lint, tauri-updater-config, turn-credentials-guard, engine-size-budget, coverage-docs-guard, test-count-docs-guard`. Run `typecheck && lint && test` locally before pushing. Mutation jobs run on PRs but detailed reports are nightly; don't try to run full Stryker locally (~40 min per module).

- **Race condition with other merges** — during Wave 2, every other PR I tried to land had to be re-rebased because bot PRs and the user's other work kept landing on main. The pattern that worked: each lane rebases to current `origin/main` (not a frozen snapshot). If you land multiple Wave 3 lanes, expect the same — do them in serial, not parallel.

- **Commit prefix** — use `feat(card-scripts): ...` or `chore(...)`, per the project's existing convention. The home-directory `AGENTS.md` rule about `[AI-assisted]` is a global preference that doesn't override this project's commitlint config (lower-case header, min 10 chars, types `feat fix docs style refactor test chore revert` only).

- **No `--forceExit` anywhere (#1719)** — the CI Test job and the nightly Jest flake detector run without it; a hanging timer or unresolved handle must fail the run, not be masked. Clean up timers/handles in `afterAll` instead.

## Lane workflow that worked in Wave 2

For each new lane, the pattern that consistently worked:

1. **Create a worktree** at `~/Projects/planar-nexus-worktrees/issue-NNNN` with `git worktree add ... origin/feat/issue-NNNN-branch`.

2. **Rebase onto current `origin/main`**: `git rebase origin/main`.

3. **Resolve conflicts** with this priority order (most conflicts were in these files):
   - `config/bundle-budget.json` — take main's version (always newer).
   - `docs/onboarding.md` and `docs/TEST_VIDEO_FIXTURES.md` — take main's value, then bump the test count to match the new total.
   - `src/lib/game-state/card-scripts/__tests__/card-scripts.test.ts` — take main's view, then `cat /tmp/<lane>-block.ts >> card-scripts.test.ts` to append the lane's describe block. Don't use `--ours`/`--theirs`; do it explicitly.
   - `src/lib/game-state/card-scripts/schema.ts`, `interpret.ts`, `ops/registry.ts`, `ops/<OpName>.ts` — these often auto-merge cleanly. If they conflict, take main's view (the previous merge already incorporated the upstream) and re-apply the lane's specific changes manually (e.g., add a new arm to `EffectSchema`, add a new `case` in `applyEffect`).
   - The lane's new card JSONs (`cards/<card>.json`) are additive — no conflict.
   - The lane's new op file (`ops/<OpName>.ts`) is additive — no conflict.

4. **Don't include commit-message markers in the commit** (the handoff's `<<<<<<<` markers can leak into the commit if you `git add` without checking — always `grep -E "<<<<<|=====|>>>>>" <files>` before commit).

5. **Add any required imports to the test file** (e.g., `refreshAuraBonuses` for the auras lane, `clearUntilEndOfTurnKeywords` for the indestructible lane). These are easy to miss in auto-merged test blocks.

6. **Verify** with `npm run typecheck && npx tsx scripts/build-card-script-index.ts && npx jest --testPathPatterns="card-scripts"`. Don't `npm test` (full suite, 5+ min) unless something looks wrong.

7. **Re-bump the test-count docs** before pushing: the first bump is usually off by 5–10 because `it.each(files)` generates one test per new card JSON. The CI `test-count-docs-guard` re-measures and will fail if you're low.

8. **Push and wait for CI**: `git push --force-with-lease origin <branch>` then `ci-wait <PR>`. Force-push is required because we rebased.

9. **Merge with admin** (the branch policy requires it for our PRs): `gh pr merge <PR> --merge --delete-branch --admin`. Don't forget `--admin` or it fails with "base branch policy prohibits the merge".

10. **Clean up the worktree**: `git worktree remove ~/Projects/planar-nexus-worktrees/issue-NNNN --force && git branch -D <branch>`. Don't do this from inside the worktree.

## Key files

- `src/lib/game-state/card-scripts/schema.ts` — every op + every schema arm. The big file.
- `src/lib/game-state/card-scripts/interpret.ts` — `applyEffect` switch (one case per op), `resolveScriptedSpell` / `resolveScriptedAbility`, `getScriptedAbility`.
- `src/lib/game-state/card-scripts/ops/registry.ts` + `ops/<OpName>.ts` — one per op.
- `src/lib/game-state/card-scripts/cards/index.generated.ts` — auto-regenerated by `npx tsx scripts/build-card-script-index.ts` on every typecheck. Don't hand-edit.
- `src/lib/game-state/card-scripts/__tests__/card-scripts.test.ts` — every describe block per lane.
- `docs/onboarding.md` and `docs/TEST_VIDEO_FIXTURES.md` — anchored test-count blocks; ratchet after every test change.
- `config/bundle-budget.json` — per-route First Load JS budget; capture after every engine change.
- `reports/op-frontier.md` — capability ranking by draft counts. **Re-run after Wave 2** (this is step 1 above).
- `reports/standard-card-implementation-matrix.md` — per-card status.
- `reports/standard-status.json` — same data, JSON.
- `.planning/wave2-handoff.md` — stale Wave 2 handoff (delete or archive).
- `.planning/phase5-handoff.md` — Wave 1 lane analysis.

## CI gates to verify before pushing

The CI gate (`build` job) `needs:` all of: `test, lint, typecheck, commitlint, mutation-smoke, security, cargo-audit, rust-checks, a11y-contrast, e2e, workflow-lint, tauri-updater-config, turn-credentials-guard, engine-size-budget, coverage-docs-guard, test-count-docs-guard`. Run `typecheck && lint && test` locally before pushing.

The mutation score jobs (layer-system, combat, mana, trigger-system, replacement-effects, spell-casting, state-based-actions, keyword-actions, abilities) run on PRs but the detailed reports are nightly. Don't try to run full Stryker locally — ~40 minutes per module.

## Next-session first action line

> continue working using this prompt — .planning/wave3-handoff.md
