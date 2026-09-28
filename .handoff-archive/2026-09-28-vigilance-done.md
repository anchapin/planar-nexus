# Session Handoff Checkpoint

**Timestamp:** 2026-09-28T12:47:40Z
**Branch:** `fix/issue-2328-vigilance` (PR #2329 OPEN with auto-merge armed)
**Task:** Epic #2300 (keyword enforcement). **Plan D done — PR #2329 filed for #2328 (vigilance, CR 702.2b), merge conflict against main resolved, E2E flake fixed. Next: let CI clear on #2329; then file & merge Plan E (deathtouch, CR 702.2).**

## 1. Accomplished So Far

- ✅ **PR #2329** (`14a3740a` E2E flake fix, `3d64919a` merge commit, `69305e0` original Plan D commit, squash pending) — closes #2328. Plan D mirrors Plan A/B/C.
- ✅ **Merge conflict resolved** — single conflict in `evergreen-keywords.ts` import block (both #2327 and Plan D added strict imports adjacent to `hasTrampleStrict`); kept both additions.
- ✅ **E2E flake fixed** (commit `14a3740a`) — root cause: free-cast hook's `setState` was wired only to React's `setGameState()` while `getState` returns `gameStateRef.current` (updated via `useEffect` after render). Back-to-back `patchCardOracle → moveCard` saw stale state, and `moveCardToZone` then overwrote the patched `cardData` when `commit()` called `setState(result.state)`. **Fix**: update `gameStateRef.current` synchronously inside the hook's `setState` wrapper, before calling `setGameState`.
- ✅ **New strict helper** `src/lib/game-state/keyword-actions/vigilance.ts` — `hasVigilanceStrict(card)` (parsed-keywords only).
- ✅ **Canonical helper** `evergreen-keywords.hasVigilance` defers to strict first, then `hasKeyword` substring fallback; `tapsWhenAttacking` inherits via `hasVigilance`. CR section comment added.
- ✅ **Three substring sites replaced** with `hasVigilanceStrict`:
  - `combat/queries.ts::canAttack` (lines 65-71)
  - `combat/queries.ts::getAvailableAttackers` (lines 248-256)
  - `combat/declaration.ts::declareAttackers` (lines 141-151)
- ✅ **Tests: +28, total 11832 → 11860 (11853 passed + 7 skipped), suites 575 → 577.** `keyword-vigilance.test.ts` (16) + `combat-vigilance.test.ts` (12).
- ✅ **Test-count doc guard PASSED** post-ratchet (`docs/TEST_VIDEO_FIXTURES.md` + `docs/onboarding.md` updated to 577/11860).
- ✅ **Issue #2328 filed and closed** when PR merges.
- ✅ **Verified locally:** `complex-combat.spec.ts:107` passes 5/5 consecutive runs (was 0/5 before fix). Targeted E2E suites (combat + stack + mechanics + game-flow) pass 24/24. Full Jest: 577 suites, 11853 + 7 skipped = 11860, no regressions.

## 2. Modified Files

**In branch `fix/issue-2328-vigilance`, on top of `origin/main` (commits `69305e00` → `3d64919a` → `14a3740a`):**

- `src/lib/game-state/keyword-actions/vigilance.ts` (new): `hasVigilanceStrict`.
- `src/lib/game-state/evergreen-keywords.ts`: added strict import; `hasVigilance` defers strict-first.
- `src/lib/game-state/combat/queries.ts`: replaced inline substring in `canAttack` and `getAvailableAttackers` with `hasVigilanceStrict`.
- `src/lib/game-state/combat/declaration.ts`: replaced inline substring in `declareAttackers` tap suppression with `hasVigilanceStrict`.
- `src/app/(app)/game/[id]/GameBoardContent.tsx`: synchronous `gameStateRef.current` update in free-cast hook's `setState` wrapper (E2E flake fix).
- `src/lib/game-state/__tests__/keyword-vigilance.test.ts` (new, 16 tests).
- `src/lib/game-state/__tests__/combat-vigilance.test.ts` (new, 12 tests).
- `docs/TEST_VIDEO_FIXTURES.md` (ratcheted to 577/11860).
- `docs/onboarding.md` (ratcheted to 577/11860).
- `package.json`, `package-lock.json`, `src-tauri/Cargo.lock` (inherited from origin/main via merge commit `3d64919a` — dep bumps from #2323 and #2320).

**Working tree (uncommitted, by-design out-of-scope):**

- `.handoff-archive/2026-09-27-combat-cleanup-done.md` — modified (historical drift, NOT this session's change).
- `.foreman/runs/{d5f46558d2d8,e138d3191e9c}/` — pre-existing scratch logs.
- `.handoff-archive/2026-09-28-{plan-c-prep,plan-c-trample-fs-ds-done,hexproof-protection-done}.md` — handoff archives.
- `.handoff-archive/2026-09-27-ward-done.md` — prior archive.
- `AGENTS.md` — auto-managed Next.js agent-rules block (`next dev` adds/removes; commit it to keep the tree clean).

## 3. Current Verification State

- **Typecheck:** PASS (`npx tsc --noEmit`, clean).
- **Lint:** PASS (0 errors, 601 pre-existing warnings — no new warnings).
- **Targeted Jest tests:** PASS (28 new + 28 targeted = all green).
- **Targeted E2E:** PASS (complex-combat 5/5, qr-join-flow, stack-interaction, standard-mechanics, game-flow — 24/24 total).
- **Full Jest suite:** 11853 passed + 7 skipped (11860 total) — pre-existing `use-deck-coach-chat.test.ts` flake hits once on full run, passes on re-run (known flake).
- **CI on PR #2329:** `state=OPEN`, `mergeStateStatus=BLOCKED` (CI rolling), `mergeable=MERGEABLE`, auto-merge armed (`--auto --squash --delete-branch`). All checks re-running on commit `14a3740a` after the E2E flake fix push.
- **Test-count doc guard:** PASS (`scripts/check-test-count-docs.mjs`).
- **QA coverage gate:** OK (`scripts/qa-coverage-gate.js` — 14/13 blocks, 0 todos).

## 4. Immediate Next Step

**Let auto-merge fire on PR #2329. Do NOT poll CI.** Once merged, archive this handoff and start Plan E (deathtouch, CR 702.2).

Concrete actions in order:

1. **First, verify PR #2329 has merged.** Single non-polling check:

   ```
   gh pr view 2329 --json state,mergedAt,mergeCommit
   ```

   If `state == MERGED`, proceed. If `state == OPEN` and CI is still rolling, **STOP — do not re-check the same status. The auto-merge handler is doing the right thing. Wait for the user to ping, or do other Plan E prep work that doesn't depend on the squash landing.**

2. **Post-merge: archive this handoff** by moving it to `.handoff-archive/2026-09-28-vigilance-done.md` (mirrors prior session pattern). Then `git checkout main && git pull`.

3. **Plan E — file the next sub-issue.** Per the PR #2329 body, remaining bare-`hasKeyword` substring-only keywords are `hasFlash` (line 655), `hasDefender` (line 678), `hasDeathtouch` (line 107), `hasShroud` (line 126), `hasIndestructible` (line 164), `hasLifelink` (line 179), `hasPersist` (line 988), `hasMutate` (line 1024), `hasInfect` (line 1118), `hasProwess` (line 1171). **Recommended Plan E target: deathtouch** — most gameplay-critical, has the trample interaction contract already wired in `getExcessTrampleDamage` (issue #2294 was deferred to a follow-up). Survey first:
   ```
   rg -n 'hasDeathtouch|"Deathtouch"|\.toLowerCase\(\)\.includes\("deathtouch' src/lib/game-state -g '*.ts'
   ```
   File a fresh GH issue (next available ~#2330), branch `fix/issue-<n>-deathtouch`, implement strict `keyword-actions/deathtouch.ts` with `hasDeathtouchStrict`, wire the substring sites, add tests, PR.

### Open state references

- Epic: #2300 (keyword enforcement, ~10 keywords left after #2328 lands — mostly lower-priority / fewer call sites).
- Sibling merged PRs: #2312 (flash), #2314 (defender), #2316 (ward), #2318 (combat cleanup), #2322 (hexproof/protection), #2325 (flying/reach/menace), #2327 (trample/first-strike/double-strike).
- PR #2329 (vigilance, OPEN): auto-merge armed, CI rolling on commit `14a3740a`.

### Conventions to preserve

- `keyword-actions/` directory (not `keyword-effects/`).
- Strict variants named `hasXStrict`; `evergreen-keywords.hasX` defers to strict first, then falls back to word-bounded `hasKeyword` substring.
- `moduleNameMapper` regex in `jest.config.js` is scoped (`"^.*/game-state/combat$"`) — does NOT collide with `types/combat.ts`.
- PR body written to file + `--body-file` (not `--body`).
- For deathtouch: it's both a detection keyword AND an effect (CR 702.2c: "Any nonzero amount of damage assigned to a creature by a source with deathtouch is sufficient to destroy it"). The strict helper should mirror `hasFirstStrikeStrict`'s shape (single-word, case-insensitive, word-bound). The trample interaction math is already pinned in `getExcessTrampleDamage` tests (issue #2326).
- Pre-existing flake on `use-deck-coach-chat.test.ts` re-runs once and continues.
- Transient `npm install` EPROTO/SSL errors: re-trigger via empty `chore(ci):` commit.
- Never poll CI. Use the AGENTS.md one-shot `gh pr view <n> --json` and walk away.

## 5. Open Issue Trail

- Closed #2328 — fresh sub-issue filed this session (vigilance) → filed PR #2329.
- Open #2300 — Epic parent.
- Need to file: Plan E sub-issue for deathtouch (recommended) or another remaining keyword (next available ~#2330).

## 6. CI / Workflow Notes

- All previous PRs (Plan A/B/C/D) merged cleanly with the same auto-merge pattern.
- `npm run test:coverage` is **flaky in coverage mode** on the multiplayer/p2p-join test (`use-deck-coach-chat` + `p2p-join/page.test.tsx`) — pre-existing flake unrelated to #2328. Does not block merge; the `npm test` (no coverage) run that ratchets the test-count-doc guard is stable at 11860 / 577.
- Test-count docs ratchet verified: both `docs/TEST_VIDEO_FIXTURES.md` and `docs/onboarding.md` updated and `scripts/check-test-count-docs.mjs` PASSES.

## 7. Gotchas hit during this session

- **Merge conflict in `evergreen-keywords.ts` import block** when #2327 landed first: both PRs added strict imports adjacent to `hasTrampleStrict`. Resolution: keep both additions, drop conflict markers. Single conflict, no other overlap because Plan C (#2327) touched `combat/resolution.ts` (trample/first-strike/double-strike sites) and Plan D (#2328) touched `combat/queries.ts` + `combat/declaration.ts` tap suppression sites — different lines in `combat/declaration.ts`.
- **`getAvailableAttackers` requires a `playerId` argument** (not optional). First test run hit `Received array: []` because I called it without one. The fix was `getAvailableAttackers(state, aliceId)` — the `state` arg alone doesn't imply the player.
- **`commitlint` rejects "setState" in commit header** — the `header-case` rule wants strictly lower-case. Use `setstate` or rephrase to avoid the camelCase. Same for any other camelCase identifier in the header.
- **E2E flake root cause**: the free-cast hook's `setState` was wired only to React's `setGameState()`, while the hook's `getState` returns `gameStateRef.current` (a ref updated via `useEffect` after the React render). Back-to-back hook calls saw stale state, and the subsequent `moveCardToZone` overwrote the patched `cardData` when `commit()` called `setState(result.state)`. **Fix**: update the ref synchronously inside the hook's `setState` wrapper, before calling `setGameState`. Tests `complex-combat.spec.ts:107`, `qr-join-flow.spec.ts:236`, and `stack-interaction.spec.ts:86` were all affected by the same root cause; all now pass locally.
- **Plan E deathtouch scope**: likely 1-2 substring sites (mostly in `isLethalDamage` and any combat resolution helpers), one strict helper, ~20-30 tests (similar to ward / hexproof patterns, smaller than trample because deathtouch has fewer sites). The deathtouch-trample interaction math is already pinned in `getExcessTrampleDamage` tests from #2326.
- **`package-lock.json` / `Cargo.lock` changes** in the merge commit are inherited from origin/main dep-bump PRs (#2323 npm, #2320 rust). No action needed.
