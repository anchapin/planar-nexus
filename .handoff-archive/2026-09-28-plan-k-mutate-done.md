# Session Handoff Checkpoint

**Timestamp:** 2026-09-28T17:40:00Z
**Branch:** `main` (synced with origin, clean) at `0aee61e9`
**Task:** Epic #2300 (keyword enforcement). **Plan J done — prowess (CR 702.108) merged as PR #2345 → `0aee61e9`, closing #2344.** Next: **Plan K — `mutate` (CR 702.140).**

## 🚨 READ FIRST — a concurrent process is writing in this working directory

During Plan J the working tree was **shared with another process**. Observed, in order:

1. `src/lib/game-state/__tests__/keyword-prowess.test.ts` — I wrote a 24-test version and ran it (24 passed). Later the same file held a **29-test** version with different test names and 4 different `describe` blocks. No new commit, no worktree, no matching stash, nothing in `git reflog`.
2. `docs/onboarding.md` was modified — I never touched it.
3. `git add <5 paths>` → `git status` showed **nothing staged**: a commit `5ee0ad9b` already existed with exactly the message and file set I intended. **I never ran `git commit`.**
4. The branch was already pushed and **PR #2345 already open**.
5. `.handoff.md` was archived to `.handoff-archive/2026-09-28-plan-j-prowess-done.md` by something other than me.

The concurrent writer's test file was **better** than mine (adds `getProwessInstanceCount` coverage, a `prowessless` FP case, 3 more `detectProwessTriggers` cases). I asked the user, who chose to keep it. I then re-validated it independently (29/29 green; old-gate proof → exactly 6 failures, all FP pins) and added a **provenance note to the PR body** flagging the test file's authorship as unverified.

**Consequences for you:**

- **Do not trust that the working tree is yours.** Re-`stat`/`git status` before and after every write, and verify `git log` after every `git add`.
- If you write a file and later find different content, **do not overwrite it.** Surface it to the user with the evidence (mtime, `git log`, `reflog`, per-suite test-count diff) and let them decide. That is exactly what happened, and it worked.
- Prefer writing the handoff **last**, and verify it is the file you wrote before finishing.

## 1. Plan J — accomplished

- ✅ **Surveyed before trusting the previous handoff, and it was wrong again.** It listed **two** production sites and called `parseProwess` "a genuine false negative". `grep -rn parseProwess src/` returns only its own definition, `__tests__/prowess.test.ts`, and a barrel-typecheck assertion. **No production callers** → text-only blindness is a test-only / public-surface concern, graded exactly like #2340/#2341. There was **one** live site: `evergreen-keywords.hasProwess` (bare `hasKeyword`).
- ✅ **Probed empirically before writing the issue** (temporary test, since deleted). Confirmed FPs `prowesses` / `unprowess` → `hasProwess=true`, and that a **grantor** card (`"Other creatures you control have prowess."`) reads as a prowess creature and is pumped. Also confirmed the _divergence_ that proves the substring arm is wrong: `parseProwess` (anchored) says `false` where `hasProwess` (unanchored) says `true`.
- ✅ Filed **#2344** (confirmed free with `gh issue view` first) → PR **#2345** → merged `0aee61e9`; #2344 auto-closed. All 17 **required** checks green (verified against `required_status_checks`, not the check count — 45 checks run, 17 required).
- ✅ **Proved the pins catch the bug**: restored the old gate via `git checkout HEAD -- evergreen-keywords.ts`, got **6 failures — exactly the FP pins** (incl. both live `detectProwessTriggers` cases); restored → 29/29.

### Where the old handoff was wrong — keep surveying

- Line numbers were stale again (`hasProwess` at **1245**, not ~1231). Always re-grep.
- The `parseProwess` "second production site" was phantom. **Grep callers before calling anything a P0.**

## 2. Modified Files (all committed, `0aee61e9`)

- `src/lib/game-state/keyword-actions/prowess.ts` — **new** `hasProwessStrict` + module-header rationale. Pure leaf, no `evergreen-keywords` import (no cycle — unlike `persist.ts`).
- `src/lib/game-state/evergreen-keywords.ts` — `hasProwess` strict-first + **anchored** `/\bprowess\b/i` fallback; CR 702.108a type-line guard preserved. _(authored by me, byte-for-byte)_
- `src/lib/game-state/__tests__/keyword-prowess.test.ts` — **new, 29 tests**. ⚠️ _concurrent-writer provenance, see above._
- `docs/TEST_VIDEO_FIXTURES.md` — 586/12004 → 587/12033 (ratchet script owns this file).
- `docs/onboarding.md` — 586/12004 → 587/12033 (manual; no script owns it — tracked as #2342).

**Untracked by design (never `git add -A`):** `.foreman/runs/*`, `.handoff-archive/*.md`, `.handoff.md`.

## 3. Verification State (at `0aee61e9`)

- **`npm test`: 587 suites, 12026 passed + 7 skipped (12033)**, 3 snapshots, no `--forceExit`. Was 586/12004.
- `npx tsc --noEmit` clean. `npm run lint` **0 errors**, 601 warnings (pre-existing baseline; none in the prowess files). `prettier --check` clean.
- `node scripts/check-test-count-docs.mjs` **PASS** (587 / 12033). QA coverage gate 0 todos.
- **CI on #2345: all 17 required checks `pass`.** The 9 `Mutation score (*)` jobs report `fail` but the parent **"Mutation Score (PR info)" is `cancelled`** — the #2343 `timeout-minutes: 2` bug, not a score regression. Do not read those as real failures.
- `mergeStateStatus` sat at `UNSTABLE` despite a fully green required set (known #2343 stall). Merged as squash; branch deleted local + remote.

## 4. Immediate Next Step

**Plan K — `mutate` (CR 702.140).** One production site, and the handoff flags it as **awkward**: detection is inherently oracle-text-driven (the engine parses the mutate _cost_ at `oracle-text-parser/alternative-costs.ts:247`), so the strict-keyword pattern fits poorly. **Survey this before assuming the pattern applies** — if the gate is genuinely cost-parsing rather than keyword-presence, this may not be a keyword-enforcement fix at all and should be re-graded rather than forced into the runbook shape.

1. `git checkout main && git pull --ff-only` (expect `0aee61e9`).
2. Survey: re-locate the site, grep production callers, and check whether `mutate` is enforced at all vs. merely parsed.
3. `gh issue create --title "fix(#<n>): mutate keyword enforcement via strict parsed-keywords check (cr 702.140)"` — **next free is #2346, but confirm with `gh issue view` first.**

### Remaining set (state as of `0aee61e9`)

| keyword          | CR      | sites | notes                                                                                                                                                                                                                                                                                        |
| ---------------- | ------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mutate`         | 702.140 | 1     | **do next** — awkward, may not fit the pattern; check before filing                                                                                                                                                                                                                          |
| `infect`         | 702.93  | 1     | coupled to the damage/poison pipeline — check blast radius first                                                                                                                                                                                                                             |
| `indestructible` | 702.12b | 2     | **LAST, deliberately** — `keyword-actions/removal.ts:19` is `keywords.includes("Indestructible") \|\| oracleText.includes("indestructible")` (case-**sensitive** on the keyword arm, case-insensitive on the text arm) + the bare `evergreen` site. Widest blast radius: damage/SBA pipeline |

**Also open:** regenerate the stale gap report — `npx tsx scripts/analyze-gameplay-gaps.ts` → `reports/gameplay-gap-analysis.md`. Epic #2300's "243 of 257 unenforced" figure is heavily stale.

### Runbook (proven five times now)

1. `git checkout main && git pull --ff-only`. 2. **Survey every candidate; read bodies, not grep lines; grep callers before grading severity.** 3. File the issue, confirm the number. 4. `git checkout -b fix/issue-<n>-<kw>`. 5. New `hasXStrict` in `keyword-actions/<kw>.ts`; `evergreen-keywords.hasX` strict-first; **rewire every production substring site**; keep the fallback **anchored**. 6. **Prove the pins catch the bug** (restore old gate → confirm failures → restore). 7. Tests + docs ratchet (`ratchet-test-count.mjs` covers **only** `TEST_VIDEO_FIXTURES.md`; `docs/onboarding.md` is manual). 8. PR squash + delete-branch; verify the **17 required** checks (not the raw count); **merge manually** (#2343); `ci-wait <n>`, never poll.

### Conventions to preserve

- `keyword-actions/` (not `keyword-effects/`). No `index.ts` barrel — deep imports within the engine are the norm.
- Strict variants named `hasXStrict`; canonical `hasX` defers strict-first, then keeps an **anchored** substring fallback for untagged cards. Regex shape: `/^keyword\b/i.test(k.trim())` over `card.cardData.keywords ?? []`.
- Strict-check modules are **pure leaves** (no `evergreen-keywords` import). `persist.ts` is the exception (needs `hasPersist`/`canPersistTrigger`, so the cycle is real, safe, and documented).
- `moduleNameMapper` in `jest.config.js` is scoped (`^.*/game-state/combat$`) — no collision with new `keyword-actions/*.ts`.
- **Jest 30: `--testPathPatterns` (plural).** `--testPathPattern` is removed.
- PR/issue bodies via shell heredoc to `/tmp/opencode/*.md` + `--body-file`. The `write` tool writes to a server-local mount invisible to the shell. `gh` also needs `-R anchapin/planar-nexus` when run outside the repo.
- **New test helpers must NOT backfill `oracle_text` from the keyword list.** `createMockCreature` in `keyword-enforcement.test.ts:101` _does_ backfill — do not copy it for FP/FN cases.
- **When a new test fails, first ask whether the _expectation_ was ever true.** Plan I: I asserted `"Artifact — Creature"` should not get persist; it failed because the guard is `includes("creature")` and an Artifact Creature _is_ a creature (rules-correct). Fixed the expectation, pinned real behavior, logged a `KNOWN LIMIT`.
- commitlint lower-case header, min 10 chars, types: `feat fix docs style refactor test chore revert`; footer needs a leading blank line.
- Pre-existing flake on `use-deck-coach-chat.test.ts` re-runs once and continues.
- **Epic sub-issues DO auto-close on merge** (#2338→#2339, #2344→#2345 both did).
- **Do NOT `git add -A`** — sweeps `.foreman/`, `.handoff-archive/`, `.handoff.md`. Stage explicitly (5 paths for Plan J), or `git reset .foreman .handoff-archive .handoff.md`.

## 5. Open Issues Filed This Epic (unfixed)

| #                                                             | finding                                                                                                                                                                                                                             | severity |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| [#2340](https://github.com/anchapin/planar-nexus/issues/2340) | `keyword-actions/flash.hasFlash` (correct, strict) is **unwired**; `evergreen-keywords.hasFlash` is a divergent bare-substring copy holding the canonical name. `hasFlashStrict` is cited by 6 module headers but has never existed | low      |
| [#2341](https://github.com/anchapin/planar-nexus/issues/2341) | `evergreen-keywords.hasDefender` is a non-strict duplicate; the combat gate correctly uses `hasDefenderStrict`                                                                                                                      | low      |
| [#2342](https://github.com/anchapin/planar-nexus/issues/2342) | `docs/onboarding.md` `TEST_COUNT` block has **no CI guard**; both scripts hard-code `DOC_PATH` to `TEST_VIDEO_FIXTURES.md`                                                                                                          | medium   |
| [#2343](https://github.com/anchapin/planar-nexus/issues/2343) | `gh pr merge --auto` never fires — `mutation-pr.yml` parent job lands in bucket `cancel` (`timeout-minutes: 2`); #2328–#2345 all affected                                                                                           | medium   |

**Deliberately NOT filed** (recorded as `KNOWN LIMIT` in code — say the word if you want them tracked): persist's and prowess's `typeLine.includes("creature")` guards, the negation/grant-aware oracle parses for `"hexproof from"` / `"lose shroud"` / `"Other creatures … have prowess"`, and the written-out-ability false negative for prowess (a card with no keyword tag whose text spells the trigger in full).

## 6. Epic State

- Epic: **#2300** — "243 of 257 detected keywords unenforced", heavily stale.
- Merged siblings (15 closed): #2312 (flash), #2314, #2316 (ward), #2318 (combat cleanup), #2322 (hexproof/protection), #2325 (flying/reach/menace), #2327 (trample/first-strike/double-strike), #2329 (vigilance), #2331 (deathtouch), #2333 (lifelink), #2335 (haste), #2337 (shroud), #2339 (persist), **#2345 (prowess)**.
- Full Plan J narrative: `.handoff-archive/2026-09-28-plan-j-prowess-done.md`.
