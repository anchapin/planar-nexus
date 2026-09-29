# Session Handoff Checkpoint

**Timestamp:** 2026-09-28T13:53:50Z
**Branch:** `main`
**Task:** Epic #2300 (keyword enforcement). **Plan F done — PR #2333 merged (squash, auto-delete-branch) for #2332 (lifelink, CR 702.15). Plan G ready to start. Recommended next keyword: `hasFlash` (CR 702.8) — timing-only, no combat wiring to rewire, simplest remaining case.**

## 1. Accomplished So Far

- ✅ **Resume verification (this session):** `gh pr view 2333 --json` confirms `state=MERGED`, `mergedAt=2026-09-28T13:52:54Z`, `mergeCommit=92d7d867`. Auto-merge (squash + delete-branch) worked as designed.
- ✅ **Plan F (lifelink) implemented + verified + merged:**
  - `c451e46f` — `fix(#2332): lifelink keyword enforcement via strict parsed-keywords check (cr 702.15)` (new `keyword-actions/lifelink.ts`, `evergreen-keywords.hasLifelink` defers strict-first + substring fallback, 2 production substring sites in `combat/resolution.ts:131` and `:290-291` rewired to canonical `hasLifelink`, +23 tests across `keyword-lifelink.test.ts` [16] and `combat-lifelink.test.ts` [7]).
  - Auto-merge squash landed as `92d7d867` on `main`; `fix/issue-2332-lifelink` auto-deleted (local + remote).
- ✅ **Plan F CI walk (informational, non-blocking):** Watched `gh pr checks 2333 --watch --fail-fast`. `mutation-pr.yml` jobs reported `fail` but the workflow is **explicitly non-blocking** (`continue-on-error: true`, line 62; workflow header line 30: "Non-blocking: this job posts a PR comment but never fails the PR"). Workflow `conclusion: cancelled` was the 2-min `timeout-minutes` from `mutation-pr.yml:33`. **The actual merge gate (`.github/workflows/ci.yml` `build` job) PASSED.** No fix required.
- ✅ **Local repo synchronized:** `git checkout main && git pull --ff-only` brought local to `92d7d867`; local `fix/issue-2332-lifelink` branch deleted.
- ✅ **Earlier chain (committed on the merged branch):**
  - `ed6a3e4a` — `fix(#2330): deathtouch keyword enforcement via strict parsed-keywords check (cr 702.2)` (PR #2331, MERGED at `2026-09-28T13:20:48Z`, `mergeCommit=efea8593`).
  - `06ef9227` — `fix(#2328): vigilance declaration-time enforcement via strict parsed-keywords check (cr 702.2b)` (PR #2329, prior merge).
- ✅ Coverage floor unchanged: functions 56, lines 64, statements 63 (Plan F coverage 64.7/65.7/57.7/55.9 vs floors63/64/56/54 — all above).
- ✅ Test count ratcheted: 581 suites / 11912 tests (11905 passed + 7 skipped); `docs/TEST_VIDEO_FIXTURES.md` auto-ratcheted, `docs/onboarding.md` manually updated.

## 2. Modified Files

**This turn (committed on `main` via squash merge of PR #2333, all auto-deleted from branch):**

- `src/lib/game-state/keyword-actions/lifelink.ts` (new) — `hasLifelinkStrict` helper (parsed-keywords only, case-insensitive, word-bound `/^lifelink\b/i`, whitespace-trimmed).
- `src/lib/game-state/evergreen-keywords.ts` — added `hasLifelinkStrict` import after `hasDeathtouchStrict`; `hasLifelink` defers strict-first, then `hasKeyword` substring fallback; CR 702.15 section comment.
- `src/lib/game-state/combat/resolution.ts` — added `hasLifelink` to evergreen-keywords import group; replaced 2 substring sites (`keywords?.includes("Lifelink") || oracle_text.toLowerCase().includes("lifelink")`) at lines 131 and 290-291 with `hasLifelink(card)` calls.
- `src/lib/game-state/__tests__/keyword-lifelink.test.ts` (new, 16 tests).
- `src/lib/game-state/__tests__/combat-lifelink.test.ts` (new, 7 tests).
- `docs/TEST_VIDEO_FIXTURES.md` — ratcheted to 581/11912.
- `docs/onboarding.md` — manually ratcheted to 581/11912 (script gap noted).

**Working tree (uncommitted, by-design out-of-scope):**

- `.foreman/runs/{d5f46558d2d8,e138d3191e9c}/` — pre-existing scratch logs.
- `.handoff-archive/2026-09-27-ward-done.md`, `2026-09-28-hexproof-protection-done.md`, `2026-09-28-plan-c-prep.md`, `2026-09-28-plan-c-trample-fs-ds-done.md`, `2026-09-28-deathtouch-done.md` — untracked archives from prior sessions.
- `.handoff.md` — this handoff (untracked).

## 3. Current Verification State

- **Typecheck:** PASS (`npx tsc --noEmit`, clean).
- **Lint:** PASS (0 errors, no new warnings — only pre-existing baseline warnings remain).
- **Targeted Jest tests:** PASS (23 new + 567 broader relevant = all green).
- **Full Jest suite:** 11905 passed + 7 skipped (11912 total, 581 suites).
- **CI on PR #2333:** `state=MERGED`, `mergedAt=2026-09-28T13:52:54Z`, `mergeCommit=92d7d867`. All required gates (ci.yml `build` job, including lint, typecheck, test, e2e, security, mutation-smoke, etc.) **PASS**. Only `mutation-pr.yml` (informational per workflow header line 30) jobs showed `fail` in `gh pr checks` — they are non-blocking and do not gate merge.
- **Test-count doc guard:** PASS (`scripts/check-test-count-docs.mjs`).
- **QA coverage gate:** OK (`scripts/qa-coverage-gate.js` — 14/13 blocks, 0 todos).
- **Coverage ratchet:** PASS (`npm run test:coverage:ratchet` — measurements 64.7/65.7/57.7/55.9 above floors63/64/56/54; no floor change).

## 4. Immediate Next Step

**File Plan G — the next sub-issue for Epic #2300.** Recommended: **`hasFlash`** (CR 702.8 — single-word detection, simplest remaining case, no combat wiring to rewire, will reveal broken flash-grant fixtures if any exist).

1. `git checkout main` (already done; verify `git log --oneline -1` shows `92d7d867`).
2. `gh issue create --title "fix(#<n>): flash keyword enforcement via strict parsed-keywords check (cr 702.8)" --body "..."` — next available issue number is ~#2334.
3. `git checkout -b fix/issue-<n>-flash` from clean `main`.
4. **Survey first:** `grep -rn "hasFlash\|'Flash'\|\"Flash\"" src/lib/game-state/` to find all production sites and bare-`hasKeyword` substring usages.
5. **Plan:** mirror lifelink shape — new `keyword-actions/flash.ts` with `hasFlashStrict`, upgrade `evergreen-keywords.hasFlash` to defer strict-first, add tests, PR with squash + delete-branch auto-merge.
6. **Expected sites:** `src/lib/game-state/evergreen-keywords.ts` (likely has bare-`hasKeyword` substring helper currently); `src/lib/game-state/spell-casting/` (flash affects timing — search for sites that check `canCastWithFlash` or similar); possibly `src/lib/game-state/oracle-text-parser/` (already has `"flash"` in its keyword registry at `oracle-text-parser/keywords.ts` per the prior lifelink survey — flash is likely registered there).

### Conventions to preserve

- `keyword-actions/` directory (not `keyword-effects/`).
- Strict variants named `hasXStrict`; `evergreen-keywords.hasX` defers strict-first, then `hasKeyword` substring fallback.
- `moduleNameMapper` regex in `jest.config.js` is scoped (`"^.*/game-state/combat$"`) — does NOT collide with `types/combat.ts`.
- PR body written to file + `--body-file` (not `--body`).
- commitlint lower-case header rule — no camelCase like `setState` in headers.
- Pre-existing flake on `use-deck-coach-chat.test.ts` re-runs once and continues.
- Transient `npm install` EPROTO/SSL errors: re-trigger via empty `chore(ci):` commit.
- Never poll CI. One-shot `gh pr view <n> --json` only.
- **`scripts/ratchet-test-count.mjs` ONLY updates `docs/TEST_VIDEO_FIXTURES.md`, NOT `docs/onboarding.md`** — update onboarding manually after the ratchet.
- `declareBlockers` signature is `Map<CardInstanceId, CardInstanceId[]>`, not an array of `{cardId, attackerId}`.

### Open state references

- Epic: #2300 (keyword enforcement, ~7 keywords left after #2332 lands — Plan G done).
- Sibling merged PRs: #2312 (flash), #2314 (defender), #2316 (ward), #2318 (combat cleanup), #2322 (hexproof/protection), #2325 (flying/reach/menace), #2327 (trample/first-strike/double-strike), #2329 (vigilance), #2331 (deathtouch), #2333 (lifelink).
- Need to file: Plan G sub-issue at next available ~#2334.
