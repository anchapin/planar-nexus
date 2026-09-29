# Session Handoff Checkpoint

**Timestamp:** 2026-09-28T03:30:00Z
**Branch:** `fix/issue-2326-trample-first-strike-double-strike` (PR #2327 OPEN with auto-merge armed)
**Task:** Continue Epic #2300 (keyword enforcement). **Plan C done — PR #2327 filed for #2326 (trample/first-strike/double-strike, CR 702.3/702.4/702.7). Next: wait for CI to clear; then Plan D — file & merge a fresh PR for the next sub-issue in the queue (vigilance is the natural follow-up).**

## 1. Accomplished So Far

- ✅ **PR #2327** (`91f5c6ab`, squash pending) filed — closes #2326. Fixed three real bugs (inline substring oracle-text fallbacks for `hasFirstStrike` / `hasDoubleStrike` / `hasTrample` in `combat/declaration.ts` and `combat/resolution.ts`). Mirrors the Plan A/B pattern exactly.
- ✅ **Three new strict keyword-actions modules** (`src/lib/game-state/keyword-actions/{first-strike,double-strike,trample}.ts`). Each exports `hasXStrict(card)` returning boolean by consulting ONLY the parsed `keywords` array (case-insensitive, whitespace-trimmed, word-bound), identical to `hasFlyingStrict` / `hasReachStrict` / `hasMenaceStrict`.
- ✅ **Three canonical helpers updated** (`src/lib/game-state/evergreen-keywords.ts`): `hasFirstStrike` / `hasDoubleStrike` / `hasTrample` now defer to strict first, then fall back to `hasKeyword` substring (back-compat for cards with missing keyword tags). CR section comments added.
- ✅ **Inline substring fallbacks replaced** in `combat/declaration.ts` (attacker + blocker first-strike/double-strike) and `combat/resolution.ts` (`attackerHasTrample` inline + blocker first-strike/double-strike substring). Explicit comment blocks explaining WHY this is the right replacement.
- ✅ **Important contract pin (resolution.ts blocker first-strike):** the new wiring is `blocker.hasFirstStrike || hasFirstStrike(blockerCard)`. The `blocker.hasFirstStrike` shape flag (set at declaration time) is still consulted so a blocker whose keyword was granted by a continuous effect after declaration is correctly identified via the strict check on the current `blockerCard` (which carries the granted keyword post-layer).
- ✅ **Test count: 11780 → 11832 (+52 new tests). Suites: 571 → 575 (+4 new suites).**
- ✅ **Test-count doc guard PASSED** post-update (`docs/TEST_VIDEO_FIXTURES.md` + `docs/onboarding.md` ratcheted to 575/11832). `scripts/check-test-count-docs.mjs` ✅ PASS, `scripts/qa-coverage-gate.js` ✅ OK.
- ✅ **CI status on PR #2327 at handoff time:** `state=OPEN`, `mergeStateStatus=BLOCKED`. Auto-merge armed (`--auto --squash --delete-branch`); will fire when all required checks pass.
- ✅ **Typecheck:** PASS (`npx tsc --noEmit`, clean).
- ✅ **Lint:** PASS (0 errors, 601 pre-existing warnings — no new warnings from this PR).
- ✅ **Targeted tests:** PASS (52 new + 575 targeted = all green; 14 suites matched).
- ✅ **Full suite:** 11825 passed + 7 skipped (11832 total) on the most recent `npm test`. 0 failures.

## 2. Modified Files

**In branch `fix/issue-2326-trample-first-strike-double-strike` (commit `91f5c6ab`, in PR #2327):**

- `src/lib/game-state/keyword-actions/first-strike.ts` (new): `hasFirstStrikeStrict` — parsed-keywords only.
- `src/lib/game-state/keyword-actions/double-strike.ts` (new): `hasDoubleStrikeStrict` — parsed-keywords only.
- `src/lib/game-state/keyword-actions/trample.ts` (new): `hasTrampleStrict` — parsed-keywords only.
- `src/lib/game-state/evergreen-keywords.ts` (modified): added strict imports; `hasFirstStrike` / `hasDoubleStrike` / `hasTrample` defer to strict first, then `hasKeyword` substring fallback. CR section comments updated.
- `src/lib/game-state/combat/declaration.ts` (modified): replaced inline substring `oracle_text?.toLowerCase().includes("first strike"/"double strike")` in attacker + blocker shapes with `hasFirstStrike` / `hasDoubleStrike` calls. Explicit comment block explaining the strict-first / substring-fallback deferral.
- `src/lib/game-state/combat/resolution.ts` (modified): replaced inline substring `oracle_text?.toLowerCase().includes("trample"/"first strike"/"double strike")` in `attackerHasTrample` (line 88-90) and blocker first-strike/double-strike detection (lines 456-467) with strict helper calls. Explicit comment block explaining the post-layer grant-detection contract.
- `src/lib/game-state/__tests__/keyword-first-strike.test.ts` (new, ~15 tests): strict contract + flavor-word / grant-effect false-positive regressions + word-bound contract.
- `src/lib/game-state/__tests__/keyword-double-strike.test.ts` (new, ~13 tests): same shape.
- `src/lib/game-state/__tests__/keyword-trample.test.ts` (new, ~13 tests): strict contract + `getExcessTrampleDamage` accessor + deathtouch-trample math pins (CR 702.2b–d) + flavor-word regressions.
- `src/lib/game-state/__tests__/combat-trample.test.ts` (new, ~11 tests): end-to-end combat assertions for trample math (single blocker, multi-blocker, deathtouch interactions) plus strict-path pins for first-strike / double-strike damage-step ordering.
- `docs/TEST_VIDEO_FIXTURES.md` (ratcheted to 575 suites / 11832 tests / 11825 passed + 7 skipped).
- `docs/onboarding.md` (ratcheted to 575 / 11832).

**Working tree (uncommitted, unrelated / optional cleanup):**

- `.handoff-archive/2026-09-27-combat-cleanup-done.md` — modified (historical content drift, NOT this session's change; safe to ignore — do NOT include in any commit for #2326 follow-ups).
- `.foreman/runs/{d5f46558d2d8,e138d3191e9c}/` — pre-existing scratch logs.
- `.handoff-archive/2026-09-28-{plan-c-prep,hexproof-protection-done}.md` — handoff archives.
- `.handoff-archive/2026-09-27-ward-done.md` — prior archive.

## 3. Current Verification State

- **Typecheck:** PASS.
- **Lint:** PASS (0 errors, 601 pre-existing warnings).
- **Targeted tests:** PASS (52 new + 575 targeted = all green; 14 suites matched).
- **Full suite:** 11825 passed + 7 skipped (11832 total) on the most recent `npm test`.
- **CI on PR #2327 (handoff-time read):** `state=OPEN`, `mergeStateStatus=BLOCKED`. Auto-merge armed (`--auto --squash --delete-branch`); will fire when all required checks pass. **Do NOT re-poll this status.**
- **Test-count doc guard:** PASSED locally (`scripts/check-test-count-docs.mjs`).
- **QA coverage gate:** OK (`scripts/qa-coverage-gate.js` — 14/13 blocks present, 0 todos).

## 4. Immediate Next Step

**Resume PR #2327 CI to green. Do NOT poll; let auto-merge fire. Once merged, Plan D — vigilance.**

Concrete actions in order:

1. **First, verify PR #2327 has merged.** Single non-polling check:

   ```
   gh pr view 2327 --json state,mergedAt,mergeCommit
   ```

   If `state == MERGED`, proceed. If `state == OPEN` and CI is still rolling, **STOP — do not re-check the same status. The auto-merge handler is doing the right thing. Wait for the user to ping, or do other Plan D prep work that doesn't depend on the squash landing.**

2. **Post-merge: archive this handoff** by moving it to `.handoff-archive/2026-09-28-trample-first-strike-double-strike-done.md` (mirrors the prior session pattern). Then `git checkout main && git pull`.

3. **Plan D — file the next sub-issue.** The natural follow-up is **vigilance (CR 702.2b)** — the only remaining substring-oracle-text anti-pattern from the original prep survey, located in:
   - `combat/queries.ts:65-67` (can-attack pre-check)
   - `combat/queries.ts:250-252` (available-attackers filter)
   - `combat/declaration.ts:138-140` (vigilance gate during attack declaration)

   These were explicitly flagged out-of-scope in the #2326 PR body to avoid scope creep; the next sub-issue should fold them in.

   **Verify the next issue number exists** before implementing:

   ```
   gh issue list --search "vigilance" --state open
   ```

   If no fresh vigilance issue exists, file one (next available ~#2328+).

4. **Recommended Plan D target:** vigilance. Survey first:
   ```
   rg -n 'hasVigilance|"Vigilance"|\.toLowerCase\(\)\.includes\("vigilance' src/lib/game-state -g '*.ts'
   ```
   File a fresh GH issue, branch `fix/issue-<n>-vigilance`, implement strict `keyword-actions/vigilance.ts` with `hasVigilanceStrict`, wire the three sites, add tests, PR.

### Open state references

- Epic: #2300 (keyword enforcement, ~82 unenforced after #2326 lands — mostly lower-priority keywords).
- Sibling merged PRs: #2312 (flash), #2314 (defender), #2316 (ward), #2318 (combat cleanup), #2322 (hexproof/protection), #2325 (flying/reach/menace).
- PR #2327 (trample/first-strike/double-strike): OPEN at handoff time, auto-merge armed.
- Closed-but-unrelated previous queue numbers: #2290 / #2294 / #2297 (CI cross-browser flake / QR flake / dead `game-board-client.tsx`) — same trap; don't trust those numbers as fresh tickets.
- Fresh issues in queue: none for vigilance yet (verify and file fresh as needed for Plan D).

### Conventions to preserve

- `keyword-actions/` directory (not `keyword-effects/`).
- Strict variants named `hasXStrict`; `evergreen-keywords.hasX` defers to strict first, then falls back to word-bounded `hasKeyword` substring.
- `moduleNameMapper` regex in `jest.config.js` is scoped (`"^.*/game-state/combat$"`) — does NOT collide with `types/combat.ts`.
- PR body written to file + `--body-file` (not `--body`).
- Vigilance is a **declaration-time** concern (don't tap on attack). Do NOT move it into the blocker pipeline.
- Pre-existing flake on `use-deck-coach-chat.test.ts` re-runs once and continues.
- Transient `npm install` EPROTO/SSL errors: re-trigger via empty `chore(ci):` commit.
- Never poll CI. Use the AGENTS.md one-shot `gh pr view <n> --json` and walk away.

## 5. Open Issue Trail

- Closed #2326 — fresh sub-issue filed this session (trample/first-strike/double-strike) → filed PR #2327.
- Open #2300 — Epic parent.
- Need to file: Plan D sub-issue for vigilance (next available ~#2328).

## 6. CI / Workflow Notes

- All previous PRs (Plan A/B) merged cleanly with the same auto-merge pattern.
- `npm run test:coverage` is **flaky in coverage mode** on the multiplayer/p2p-join test (`use-deck-coach-chat` + `p2p-join/page.test.tsx`) — pre-existing flake unrelated to #2326. Does not block merge; the `npm test` (no coverage) run that ratchets the test-count-doc guard is stable at 11832 / 575.
- Test-count docs ratchet verified: both `docs/TEST_VIDEO_FIXTURES.md` and `docs/onboarding.md` updated and `scripts/check-test-count-docs.mjs` PASSES.

## 7. Gotchas hit during this session

- The Plan B `moduleNameMapper` regex `^.*/game-state/combat$` in `jest.config.js` correctly resolves `combat/` directory imports without colliding with `types/combat.ts`. Verified throughout the wiring changes.
- `moduleNameMapper` does NOT need to be touched for #2326 — `combat/queries.ts` / `combat/declaration.ts` / `combat/resolution.ts` already resolve through the directory index.
- TypeScript strict literal types required `createInitialGameState(["Alice", "Bob"], 20, false)` + `startGame(state)` (not manual `players` / `zones` literals) for the new combat-trample test scaffolding — manual literals tripped on missing Player/Zone fields.
- `getExcessTrampleDamage` math at the pure-arithmetic layer does NOT factor deathtouch-induced toughness-zero reduction. That reduction is surfaced downstream via SBAs + combat resolution. The deathtouch-trample tests pin this contract explicitly so a future maintainer doesn't accidentally merge the two layers.
- Word-bound regex `/^first strike\b/i` requires literal space between "first" and "strike" (NOT a hyphen). Hyphen-separated keywords like "first-strike" fall back to the substring oracle_text path via the canonical `hasFirstStrike`.
- Plan D vigilance scope should be a small, focused PR — three sites, one strict helper, ~30-40 tests (similar to ward / hexproof patterns).
