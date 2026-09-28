# Session Handoff Checkpoint

**Timestamp:** 2026-09-28T02:10:00Z (resume session update)
**Branch:** `fix/issue-2324-flying-reach-menace` (PR #2325 OPEN as of handoff write; resume-session check: still OPEN / mergeStateStatus=BLOCKED with `Test`, `Rust Checks`, `Test Count Docs Guard` still rolling — auto-merge is doing the right thing; do NOT poll)
**Task:** Continue Epic #2300 (keyword enforcement). **Plan B done — PR #2325 filed for #2324 (flying/reach/menace evasion layer, CR 702.9/702.12/702.110). Next: wait for CI; then Plan C — file & merge a fresh PR for the next sub-issue in the queue.**

## 1. Accomplished So Far

- ✅ **PR #2325** (`871608f7`, squash pending) filed — closes #2324. Fixed two real bugs (substring oracle-text fallback in `canBlock` for flying/reach; missing strict-detection contract for `hasFlying` / `hasReach` / `hasMenace`). Mirrors the PR #2322 / #2316 / #2314 / #2312 pattern exactly.
- ✅ **Three new strict keyword-actions modules** (`src/lib/game-state/keyword-actions/{flying,reach,menace}.ts`). `menace.ts` also exports `getMenaceBlockRequirementStrict` returning `1 | 2`.
- ✅ **Important contract pin:** menace is **NOT** enforced at the per-blocker pre-check in `canBlock` (the minimum-two-blocker rule is correctly enforced at declaration-time in `combat/declaration.ts::declareBlockers`, line 219). A per-blocker `canBlock: false` rejection there breaks `declareBlockers` because it filters each blocker individually — discovered via red-blocking tests. The per-blocker-permissive contract is pinned in `combat-canblock.test.ts` so future maintainers don't reintroduce the regression.
- ✅ **Test count: 11737 → 11780 (+43 new tests). Suites: 567 → 571.**
- ✅ **Test-count doc guard PASSED** post-update (`docs/TEST_VIDEO_FIXTURES.md` ratcheted to 571/11780).
- ✅ **CI status on PR #2325 at handoff time:** Type Check ✅, Lint ✅, Commit Lint ✅, A11y ✅, CodeQL ✅, Bundle Size ✅, Workflow Lint ✅, Test Count Docs Guard 🔄 IN_PROGRESS, Broken Markdown Link Guard 🔄 IN_PROGRESS, Test 🔄 IN_PROGRESS, Rust Checks 🔄 IN_PROGRESS, Security Audit (Rust) 🔄 IN_PROGRESS. Mutation score jobs CANCELLED (expected — per `AGENTS.md`, per-PR `mutation-pr.yml` is non-blocking informational; full nightly suite is `.github/workflows/mutation.yml`).
- ✅ **Auto-merge enabled** (`gh pr merge 2325 --auto --squash --delete-branch`). Will fire when all required checks pass.

## 2. Modified Files

**In branch `fix/issue-2324-flying-reach-menace` (commit `871608f7`, in PR #2325):**

- `src/lib/game-state/keyword-actions/flying.ts` (new): `hasFlyingStrict` — parsed-keywords only.
- `src/lib/game-state/keyword-actions/reach.ts` (new): `hasReachStrict` — parsed-keywords only.
- `src/lib/game-state/keyword-actions/menace.ts` (new): `hasMenaceStrict` + `getMenaceBlockRequirementStrict` (1 or 2).
- `src/lib/game-state/evergreen-keywords.ts` (modified): added strict imports; `hasFlying` / `hasReach` / `hasMenace` defer to strict first, then `hasKeyword` substring fallback. CR section comments updated.
- `src/lib/game-state/combat/queries.ts` (modified): replaced substring `oracle_text?.toLowerCase().includes("flying"/"reach")` in `canBlock` with `hasFlyingStrict` / `hasReachStrict`. Explicit comment block explaining WHY menace is not enforced per-blocker (declaration-time is the right gate).
- `src/lib/game-state/__tests__/keyword-flying.test.ts` (new, 15 tests): strict contract + flavor-word / grant-effect false-positive regressions.
- `src/lib/game-state/__tests__/keyword-reach.test.ts` (new, 15 tests): same shape.
- `src/lib/game-state/__tests__/keyword-menace.test.ts` (new, 13 tests): strict contract + `getMenaceBlockRequirementStrict` accessor + flavor-word regressions.
- `src/lib/game-state/__tests__/combat-canblock.test.ts` (new, 10 tests): end-to-end `canBlock` for flying evasion, reach exception, and per-blocker-permissive menace contract.
- `docs/TEST_VIDEO_FIXTURES.md` (ratcheted to 571 suites / 11780 tests / 11773 passed + 7 skipped).

**Working tree (uncommitted, unrelated / optional cleanup):**

- `.handoff-archive/2026-09-27-combat-cleanup-done.md` — modified (65 +/60 −), but the diff is historical content drift, NOT my change. Likely a pre-existing line-ending / text-rewrite artifact from a prior session. **Safe to ignore — do NOT include in any commit for #2324 follow-ups.**
- `.foreman/runs/{d5f46558d2d8,e138d3191e9c}/` — pre-existing scratch logs.
- `.handoff-archive/2026-09-28-{flying-reach-menace-done,hexproof-protection-done}.md` — handoff archives.
- `.handoff-archive/2026-09-27-ward-done.md` — prior archive.
- `.handoff-archive/2026-09-28-plan-c-prep.md` — **NEW in this resume session.** Plan C survey notes for trample / first-strike / double-strike (CR 702.7 / 702.4 / 702.3) — includes declaration.ts / resolution.ts line-by-line survey of the substring fallbacks that Plan C needs to replace, plus the per-step CR references and estimated test-count delta. Read this when filing the fresh Plan C sub-issue.

## 3. Current Verification State

- **Typecheck:** PASS (`npm run typecheck`, clean).
- **Lint:** PASS (0 errors, 601 pre-existing warnings).
- **Targeted tests:** PASS (43 new + 571 targeted = all green; 20 suites matched).
- **Full suite:** 11773 passed + 7 skipped (11780 total) on the most recent `npm test` (no `use-deck-coach-chat` flake this run; the pre-existing flake is still per #2309/#2314/#2316/#2322 handoff notes).
- **CI on PR #2325 (resume-session read):** `state=OPEN`, `mergeStateStatus=BLOCKED`. ~25 required checks ✅ SUCCESS (Type Check, Lint, A11y, CodeQL, Bundle Size, Workflow Lint, Broken Markdown Link Guard, Coverage Docs Guard, Security Audit, etc.). Three still IN_PROGRESS at last check: `Test`, `Rust Checks` (rust fmt/clippy/test), `Test Count Docs Guard`. Mutation score jobs CANCELLED (expected — per `AGENTS.md`, per-PR `mutation-pr.yml` is non-blocking informational). Auto-merge armed (`--auto --squash --delete-branch`); will fire when the three remaining required checks clear. **Do NOT re-poll this status.**
- **Test-count doc guard:** PASSED locally (`scripts/check-test-count-docs.mjs`).

## 5. Resume-Session Work (added 2026-09-28T02:10:00Z)

While PR #2325 was still rolling:

- ✅ **Closed issue #2317** (`chore: delete legacy combat.ts`) as completed by PR #2318 (commit `4b91ef2b`). PR body had said `Closes #2137` so the issue stayed open even though every acceptance criterion was met: legacy `src/lib/game-state/combat.ts` deleted (1224 lines), `jest.config.js` `moduleNameMapper` `"^.*/game-state/combat$"` wired at line 48, no engine-logic or test changes. Verified with `test -f src/lib/game-state/combat.ts && echo EXISTS || echo DELETED` and by checking the grep of `src/lib/game-state/combat['\"]` consumers (everything resolves through `combat/index.ts`). Unblocks Plan C cleanly — no file-mirror tax.
- ✅ **Plan C survey captured** in `.handoff-archive/2026-09-28-plan-c-prep.md`: every inline substring fallback for `hasFirstStrike` / `hasDoubleStrike` / `hasTrample` (and incidentally `hasVigilance`) located; CR section references listed (702.7 / 702.4 / 702.3 / 702.2b–d for trample-vs-deathtouch); test-count estimate ~45–55 tests across trample / first-strike / double-strike including deathtouch-interaction; trigger condition documented (file fresh GH issue after #2325 merges).
- ✅ **Verified `#2290` / `#2294` / `#2297`** are closed-but-unrelated (CI red on main / Playwright flake / dead `game-board-client.tsx`) — same trap as Plan B's #2324 discovery. **No fresh `trample` / `first-strike` / `double-strike` GH issue exists** — `gh issue list --search "trample" --state open` returns only #2300 itself. Confirms Plan C needs to file a fresh sub-issue (next available ~#2326+).
- ⏳ **PR #2325 status check (non-polling):** `state=OPEN`, `mergeStateStatus=BLOCKED`, `Test` + `Rust Checks` + `Test Count Docs Guard` still in-progress. Per handoff §4, **do NOT re-poll.** Auto-merge handler is doing the right thing. Wait for user ping or proceed with other non-#2325-dependent work.

## 4. Immediate Next Step

**Resume PR #2325 CI to green. Do NOT poll; let auto-merge fire. Once merged, Plan C.**

Concrete actions in order:

1. **First, verify PR #2325 has merged.** Single non-polling check:

   ```
   gh pr view 2325 --json state,mergedAt,mergeCommit
   ```

   If `state == MERGED`, proceed. If `state == OPEN` and CI is still rolling, **STOP — do not re-check the same status. The auto-merge handler is doing the right thing. Wait for the user to ping, or do other Plan C prep work that doesn't depend on the squash landing.**

2. **Post-merge: archive this handoff** by moving it to `.handoff-archive/2026-09-28-flying-reach-menace-done.md` (mirrors the prior session pattern). Then `git checkout main && git pull`.

3. **Plan C — file the next sub-issue.** Remaining queue per the previous handoff:
   - #2290 trample / first-strike / double-strike (highest risk — damage math).
   - #2294 trample-vs-deathtouch.
   - #2297 prowess / mutate / landwalk.

   These numbers are closed-but-unrelated issues (per this session's discovery: the handoff's "sub-issue labels" #2290/#2291/#2294/#2297 are real closed GH issues with unrelated problems — flying/reach/menace had NO real issue and required filing a fresh #2324). **Same trap likely applies to Plan C: don't trust those numbers as fresh tickets. Confirm each via `gh issue view <n> --json title,body` before writing any code.**

4. **Recommended Plan C target:** trample / first-strike / double-strike is the highest-risk remaining work (damage assignment math in `combat/resolution.ts`). Survey first:
   ```
   rg -n 'hasFirstStrike|hasDoubleStrike|hasTrample|trampleDamage|assignCombatDamage' src/lib/game-state/combat -g '*.ts'
   ```
   File a fresh GH issue (next available, ~#2326+), branch `fix/issue-<n>-trample-first-strike-double-strike`, implement strict keyword-actions modules, wire them, test, PR.

### Open state references

- Epic: #2300 (keyword enforcement, ~84 unenforced after #2324 lands).
- Sibling merged PRs: #2312 (flash), #2314 (defender), #2316 (ward), #2318 (combat cleanup), #2322 (hexproof/protection).
- PR #2325 (flying/reach/menace): OPEN at handoff time, auto-merge armed.
- Fresh issues in queue: **none yet** for #2290/#2294/#2297 (those numbers are closed-but-unrelated — verify and file fresh as needed for Plan C).

### Conventions to preserve

- `keyword-actions/` directory (not `keyword-effects/`).
- Strict variants named `hasXStrict`; `evergreen-keywords.hasX` defers to strict first, then falls back to word-bounded `hasKeyword` substring.
- `moduleNameMapper` regex in `jest.config.js` is scoped (`"^.*/game-state/combat$"`) — does NOT collide with `types/combat.ts`.
- PR body written to file + `--body-file` (not `--body`).
- Per-blocker vs declaration-time enforcement distinction: a per-blocker rejection in `canBlock` is wrong for any keyword whose rule is about the _group_ of blockers (menace). Pin the contract in tests whenever the per-blocker gate would otherwise silently break the declaration-time gate.
- Pre-existing flake on `use-deck-coach-chat.test.ts` re-runs once and continues.
- Transient `npm install` EPROTO/SSL errors: re-trigger via empty `chore(ci):` commit.
- Never poll CI. Use the AGENTS.md one-shot `gh pr view <n> --json` and walk away.
