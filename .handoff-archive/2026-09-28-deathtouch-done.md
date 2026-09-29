# Session Handoff Checkpoint

**Timestamp:** 2026-09-28T13:07:22Z
**Branch:** `fix/issue-2330-deathtouch`
**Task:** Epic #2300 (keyword enforcement). **Plan E done — PR #2331 filed for #2330 (deathtouch, CR 702.2) with auto-merge armed (squash + delete-branch). Plan F (lifelink, CR 702.15) surveyed and ready to start the moment PR #2331 lands.**

## 1. Accomplished So Far

- ✅ **Resume verification (this session):** `gh pr view 2331 --json` confirms `state=OPEN`, `mergeStateStatus=BLOCKED`, auto-merge armed (SQUASH, `enabledBy=@anchapin` at `2026-09-28T13:02:22Z`). Did **not** poll further per handoff instruction.
- ✅ **Plan F (lifelink) survey complete** (cold-ready for next session):
  - `src/lib/game-state/evergreen-keywords.ts:192` — `hasLifelink` is the bare `hasKeyword(card, "lifelink")` substring helper; needs the strict-first upgrade.
  - `src/lib/game-state/effect-resolution.ts:50` — already uses canonical `hasLifelink`; will inherit strict-first automatically.
  - **`src/lib/game-state/combat/resolution.ts:131` and `:290–291`** — **two production substring sites** (`keywords?.includes("Lifelink") || oracle_text.toLowerCase().includes("lifelink")`); both must be rewired to `hasLifelinkStrict` (or canonical `hasLifelink`).
  - All test fixtures already pass `keywords: ["Lifelink"]` directly, so test rewrites are not needed for the strict path.
- ✅ **Earlier this session chain (committed on branch):**
  - `ed6a3e4a` — `fix(#2330): deathtouch keyword enforcement via strict parsed-keywords check (cr 702.2)` (new `keyword-actions/deathtouch.ts`, `evergreen-keywords.hasDeathtouch` defers strict-first, +29 tests across `keyword-deathtouch.test.ts` [16] and `combat-deathtouch.test.ts` [13]).
  - `69c6bf9e` — `chore(handoff): archive vigilance-done handoff (pr #2329 merged)`.
- ✅ Coverage floor ratcheted (functions 55→56, lines 63→64, statements 62→63); `jest.config.js`, `README.md`, `CONTRIBUTING.md`, `docs/TESTING.md` auto-synced.
- ✅ Test-count docs ratcheted to 579 suites / 11889 tests (`docs/TEST_VIDEO_FIXTURES.md` via script, `docs/onboarding.md` manually — script gap noted).
- ✅ AGENTS.md `next.js-agent-rules` block re-added (auto-managed by `next dev`).

## 2. Modified Files

**Committed on `fix/issue-2330-deathtouch` (2 commits, pushed):**

- `src/lib/game-state/keyword-actions/deathtouch.ts` (new) — `hasDeathtouchStrict` helper (parsed-keywords only, case-insensitive, word-bound, whitespace-trimmed).
- `src/lib/game-state/evergreen-keywords.ts` — added strict import after `hasVigilanceStrict`; `hasDeathtouch` defers strict-first then `hasKeyword` substring fallback; CR 702.2 section comment.
- `src/lib/game-state/__tests__/keyword-deathtouch.test.ts` (new, 16 tests).
- `src/lib/game-state/__tests__/combat-deathtouch.test.ts` (new, 13 tests).
- `AGENTS.md` — re-added `<!-- BEGIN:nextjs-agent-rules -->` … `<!-- END:nextjs-agent-rules -->` block.
- `jest.config.js` — coverageThreshold bumped to `functions:56, lines:64, statements:63`.
- `docs/TEST_VIDEO_FIXTURES.md` — ratcheted to 579/11889.
- `docs/onboarding.md` — ratcheted to 579/11889 (manual edit).
- `README.md`, `CONTRIBUTING.md`, `docs/TESTING.md` — coverage-floor table auto-synced.
- `.handoff-archive/2026-09-28-vigilance-done.md` (committed in `69c6bf9e`).

**Working tree (uncommitted, by-design out-of-scope):**

- `.foreman/runs/{d5f46558d2d8,e138d3191e9c}/` — pre-existing scratch logs.
- `.handoff-archive/2026-09-27-ward-done.md`, `2026-09-28-hexproof-protection-done.md`, `2026-09-28-plan-c-prep.md`, `2026-09-28-plan-c-trample-fs-ds-done.md` — untracked archives from prior sessions.
- `.handoff.md` — this handoff (untracked).

## 3. Current Verification State

- **Typecheck:** PASS (`npx tsc --noEmit`, clean).
- **Lint:** PASS (0 errors, 601 pre-existing warnings — no new warnings).
- **Targeted Jest tests:** PASS (29 new + 551 broader relevant = all green).
- **Full Jest suite:** 11882 passed + 7 skipped (11889 total). One flake on `use-deck-coach-chat.test.ts` during guard run; passes on re-run (known flake).
- **CI on PR #2331:** `state=OPEN`, `mergeStateStatus=BLOCKED` (CI rolling), auto-merge armed. **Do NOT poll.**
- **Test-count doc guard:** PASS (`scripts/check-test-count-docs.mjs`).
- **QA coverage gate:** OK (`scripts/qa-coverage-gate.js` — 14/13 blocks, 0 todos).
- **Coverage ratchet:** PASS (`npm run test:coverage:ratchet`).

## 4. Immediate Next Step

**One-shot non-polling check on PR #2331 merge state:**

```
gh pr view 2331 --json state,mergedAt,mergeCommit
```

If `state == MERGED`, proceed with:

1. **Archive this handoff** → `mv .handoff.md .handoff-archive/2026-09-28-deathtouch-done.md` (mirrors prior session pattern), then commit on `fix/issue-2330-deathtouch` (or via a follow-up `chore(handoff)` PR — the squash in PR #2331 already consumed the branch, so the archive commit will need a fresh `main`-rooted branch or a direct main commit).
2. **`git checkout main && git pull --ff-only`** (fast-forward should work cleanly; local main was in lockstep with `origin/main` from the prior reset).
3. **Start Plan F — file the next sub-issue.** **Recommended: lifelink** (CR 702.15 — single-word detection, similar to deathtouch). Survey already done (see §1); remaining bare-`hasKeyword` substring-only keywords are `hasFlash`, `hasDefender`, `hasShroud`, `hasIndestructible`, `hasLifelink`, `hasPersist`, `hasMutate`, `hasInfect`, `hasProwess`. File a fresh GH issue (next available ~#2332), branch `fix/issue-<n>-lifelink` from `main`, implement `src/lib/game-state/keyword-actions/lifelink.ts` with `hasLifelinkStrict` mirroring `deathtouch.ts`, rewire the two substring sites in `combat/resolution.ts:131` and `:290–291` to use `hasLifelinkStrict` (or canonical `hasLifelink` after the `evergreen-keywords.ts:192` upgrade), add tests (mirror `keyword-deathtouch.test.ts` + `combat-deathtouch.test.ts` shape), PR with `--body-file` + auto-merge.

If `state == OPEN` and CI is still rolling, **STOP — walk away. Do not re-check.** The survey is complete and Plan F branch creation must wait for the merge so it forks from clean `main`.

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

- Epic: #2300 (keyword enforcement, ~9 keywords left after #2330 lands).
- Sibling merged PRs: #2312 (flash), #2314 (defender), #2316 (ward), #2318 (combat cleanup), #2322 (hexproof/protection), #2325 (flying/reach/menace), #2327 (trample/first-strike/double-strike), #2329 (vigilance).
- PR #2331 (deathtouch, OPEN): auto-merge armed, CI rolling.
- Need to file: Plan F sub-issue (lifelink recommended) at next available ~#2332.
