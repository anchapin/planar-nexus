# Session Handoff Checkpoint

**Timestamp:** 2026-09-28T16:25:00Z
**Branch:** `main` (synced, clean)
**Task:** Epic #2300 (keyword enforcement). **Plan H done — shroud (CR 702.18) merged as PR #2337 → `9768bdcd` for #2336.** Next: Plan I.

## 1. Accomplished So Far

- ✅ **Resumed from the Plan G handoff and executed Plan H (shroud) end to end.** Followed the handoff's step 1 (`git checkout main && git pull --ff-only`, confirmed `2e693e95`), step 2 (survey before trusting the recommendation list), and the rest of the runbook.
- ✅ **Survey confirmed the handoff's shroud pick was correct, and found MORE than the handoff flagged.** The handoff noted only "single-word, bare `hasKeyword` call at `evergreen-keywords.ts:141`". Reality: shroud is detected in **three** places with **three different shapes**:
  1. `evergreen-keywords.ts:141` — bare `hasKeyword(card, "shroud")` (unanchored substring). Known false positive.
  2. `targeting-validation.ts:67` — `/\bshroud\b/i` on `oracle_text` **only, never reads `keywords`**. This is a genuine **false NEGATIVE** and is the copy the live targeting gate `canTargetCard` uses. A permanent with `keywords: ["Shroud"]` (or shroud granted via a layer-applied continuous effect) whose oracle text omits the word was **fully targetable** — a hard rules violation. This was a missed instance of the same bug class #2322 fixed for hexproof.
  3. `targeting-validation.ts:408` (`getTargetingRestrictions`, UI-facing) — `oracleText.includes("shroud")`, a third substring site. **Found only by the survey**, not mentioned in the handoff; the UI was omitting restrictions the gate was enforcing.
- ✅ Filed **#2336** with the full three-site survey + rewiring plan.
- ✅ Implemented `keyword-actions/shroud.ts` (`hasShroudStrict`), rewired all three sites strict-first, added 40 tests, docs ratcheted 583/11939 → **585/11979**, PR #2337 → `9768bdcd` on `main`, #2336 auto-closed, branch deleted (local + remote).

### Plan H detail

- `src/lib/game-state/keyword-actions/shroud.ts` (new) — `hasShroudStrict`: `keywords.some((k) => /^shroud\b/i.test(k.trim()))`, parsed keywords only. Deliberately has **no** source-controller arg (contrast `isProtectedByHexproofStrict`) because CR 702.18a blocks _everyone_, not just opponents.
- `evergreen-keywords.ts` — added `hasShroudStrict` import after `hasHasteStrict`; `hasShroud` now `hasShroudStrict(card) || hasKeyword(card, "shroud")`.
- `targeting-validation.ts` — added `hasShroudStrict` import; `hasShroud` strict-first then the existing word-bound regex; `getTargetingRestrictions` now calls `hasShroud(card)` instead of `oracleText.includes("shroud")`.
- Tests: `keyword-shroud.test.ts` (25) + `shroud-targeting.test.ts` (15) = 40.
- **Honest-limit tests, not aspirational ones:** two tests are prefixed `KNOWN LIMIT:`. I initially wrote two tests asserting that "lose shroud" oracle text should NOT read as shroud; both FAILED, because the word-bound regex genuinely matches standalone `shroud` in that sentence (and the old code behaved identically — not a regression). Rather than weaken the production fallback or silently delete the assertions, they now pin the real, pre-existing over-match and explain that a negation-aware oracle parse is out of scope (same follow-up as `"hexproof from"` in `keyword-actions/hexproof.ts`). **Lesson: when a new test fails, first ask whether the _expectation_ was ever true — don't assume the code is the bug.**

## 2. Modified Files

**Committed on `main` via squash merge of PR #2337 (branch auto-deleted):**

- `src/lib/game-state/keyword-actions/shroud.ts` (new)
- `src/lib/game-state/evergreen-keywords.ts`
- `src/lib/game-state/targeting-validation.ts`
- `src/lib/game-state/__tests__/keyword-shroud.test.ts` (new, 25 tests)
- `src/lib/game-state/__tests__/shroud-targeting.test.ts` (new, 15 tests)
- `docs/TEST_VIDEO_FIXTURES.md`, `docs/onboarding.md`

**Working tree (uncommitted, by-design out-of-scope):**

- `.foreman/runs/*` — pre-existing scratch logs.
- `.handoff-archive/*.md` — untracked archives (incl. `2026-09-28-plan-h-shroud-done.md` = this session's completed Plan H handoff).
- `.handoff.md` — this handoff (untracked).

**NOTE: do NOT `git add -A`** — it sweeps these in. Stage explicitly (7 paths), or `git reset .foreman .handoff-archive .handoff.md` after.

## 3. Current Verification State

- **Typecheck:** PASS (`npx tsc --noEmit`, clean).
- **Lint:** PASS — 0 errors, 601 pre-existing baseline warnings (unchanged).
- **Full Jest suite:** **585 suites, 11972 passed + 7 skipped (11979 total)**, 3 snapshots. No `--forceExit`. (was 583/11939)
- **CI on PR #2337:** `state=MERGED`, `mergedAt=2026-09-28T16:20:14Z`, `mergeCommit=9768bdcd`. **All required checks passed** — all 17 in the `main` branch-protection required set verified `SUCCESS` individually (Test, Type Check, Lint, E2E Tests, Build, Security Audit npm+Rust, Rust Checks, A11y Contrast, Commit Lint, Workflow Lint, Engine Size Budget, Bundle Size Budget, Test Count Docs Guard, Coverage Docs Guard, Mutation Config Guard, Stub Inventory, Turn Credentials, Tauri Updater Config). CodeQL + Analyze also green.
- **Test-count doc guard:** PASS (`node scripts/check-test-count-docs.mjs` → 585/11979).
- **QA coverage gate:** OK (14/13 blocks, 0 todos).

### NEW operational finding — auto-merge got stuck (worth carrying forward)

`gh pr merge --auto` was armed at 15:44:40Z and **never fired**, even though all 17 required checks were SUCCESS. Cause: `mergeStateStatus` sat at **`UNSTABLE`**, not `CLEAN`.

Root cause: the 9 `Mutation score (*)` jobs from the **non-blocking** `mutation-pr.yml` workflow all land in bucket `cancel` — they hit the workflow's `timeout-minutes: 2` and get CANCELLED. This is **pre-existing and normal**: #2328/#2330/#2332/#2334/#2335 all show the same 9 CANCELLED mutation jobs. GitHub will not auto-merge while any check is non-successful, even non-required ones, so the run stalls.

**Workaround that worked:** after verifying all 17 _required_ checks are individually SUCCESS, drop auto-merge and run `gh pr merge <n> --squash --delete-branch` manually. That is exactly what auto-merge was configured to do, and it is safe once the required set is green. Do NOT poll indefinitely waiting for auto-merge — budget ~60s after the required set goes green, verify the 17 required checks, then merge manually. (`ci-wait` itself reports SUCCESS correctly; it is GitHub's auto-merge gate, not the checks, that stalls.)

## 4. Immediate Next Step

**File Plan I — the next sub-issue for Epic #2300.** Re-run the bare-`hasKeyword` survey first (line numbers below are from `9768bdcd`; re-verify). Current remaining bare sites in `evergreen-keywords.ts`:

```
123  deathtouch   (line 123: return hasKeyword(card, "deathtouch");)   <-- VERIFY, may already be done
180  indestructible (CR 702.12b)
209  lifelink     <-- VERIFY, likely already deferred to hasLifelinkStrict
365  haste        <-- VERIFY, Plan G just fixed this
704  flash        <-- VERIFY, flash was complete pre-existing (#2312)
727  defender     <-- VERIFY
1037 persist      (CR 702.141)
1073 mutate       (CR 702.139)
1167 infect       (CR 702.90)
1220 prowess      (CR 702.108)
```

**Recommended next: `persist` (CR 702.141) — the smallest remaining diff.** `keyword-actions/persist.ts` already exists; it likely only needs the `hasXStrict` deferral at `evergreen-keywords.ts:1037` plus tests.

**Runbook (proven twice now):**

1. `git checkout main && git pull --ff-only` (expect `9768bdcd`).
2. **Survey before trusting any recommendation** — for EVERY candidate, grep `keyword-actions/<kw>.ts` for an existing `hasXStrict` and grep production call sites for the keyword string. Do not assume the handoff's list is current.
3. `gh issue create --title "fix(#<n>): <kw> keyword enforcement via strict parsed-keywords check (cr <x>)" --body-file <file>` — next free number ~#2338. **Check the number actually landed** (`gh issue view`); issue #2336 was created before PR #2337 existed.
4. `git checkout -b fix/issue-<n>-<kw>` from clean `main`.
5. Mirror the haste/lifelink/hexproof shape: new `keyword-actions/<kw>.ts` with `hasXStrict`, upgrade `evergreen-keywords.hasX` to strict-first, **rewire every production substring site** (shroud had three — check more than the one the handoff names).
6. Tests + docs ratchet (`scripts/ratchet-test-count.mjs` updates only `docs/TEST_VIDEO_FIXTURES.md` — **update `docs/onboarding.md` manually**).
7. PR with squash + delete-branch. Verify the 17 required checks, then merge manually (see auto-merge note above). `ci-wait <n>`, never poll.

### Conventions to preserve

- `keyword-actions/` directory (not `keyword-effects/`). No `index.ts` barrel — deep imports within the engine are the norm.
- Strict variants named `hasXStrict`; canonical `hasX` defers strict-first, then keeps the substring fallback.
- Regex shape: `/^keyword\b/i.test(k.trim())` over `card.cardData.keywords ?? []`.
- `moduleNameMapper` in `jest.config.js` is scoped (`^.*/game-state/combat$`) — no collision with new `keyword-actions/*.ts`.
- **Jest 30: use `--testPathPatterns` (plural). `--testPathPattern` is removed and errors out.**
- PR/issue bodies via shell heredoc to `/tmp/opencode/*.md` + `--body-file` (the `write` tool writes to a server-local mount invisible to the shell). Verify with `wc -l`.
- commitlint lower-case header, min 10 chars, types: `feat fix docs style refactor test chore revert`.
- Test helpers in new test files should NOT backfill `oracle_text` from the keyword list if the tests need keyword/text disagreement (the `targeting-validation.test.ts` helper does backfill — do not copy it for false-positive/false-negative cases).
- Pre-existing flake on `use-deck-coach-chat.test.ts` re-runs once and continues.
- Transient `npm install` EPROTO/SSL errors: re-trigger via empty `chore(ci):` commit.
- **Epic sub-issues DO auto-close on merge now** (#2336 closed automatically on #2337 merge) — the older handoff's claim that they don't is stale.

### Open state references

- Epic: **#2300** (keyword enforcement). Epic body's "86 not enforced" figure predates the whole PR chain — heavily stale.
- Merged siblings: #2312 (flash), #2314 (defender), #2316 (ward), #2318 (combat cleanup), #2322 (hexproof/protection), #2325 (flying/reach/menace), #2327 (trample/first-strike/double-strike), #2329 (vigilance), #2331 (deathtouch), #2333 (lifelink), #2335 (haste), **#2337 (shroud)**. All 13 sub-issues closed.
- Remaining candidates: `persist`, `indestructible`, `mutate`, `infect`, `prowess` (+ non-standard/legacy keywords the report lists as accepted gaps).
- **Do `indestructible` LAST** — it touches the damage/SBA pipeline, widest blast radius of the set.
- Report to regenerate for fresh numbers: `npx tsx scripts/analyze-gameplay-gaps.ts` → `reports/gameplay-gap-analysis.md`.
