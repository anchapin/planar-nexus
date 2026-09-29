# Session Handoff Checkpoint

**Timestamp:** 2026-09-28T17:04:22Z
**Branch:** `main` (synced with origin, clean)
**Task:** Epic #2300 (keyword enforcement). **Plan I done — persist (CR 702.78) merged as PR #2339 → `96710c25`, closing #2338.** Session also filed #2340–#2343. Next: **Plan J.**

## 1. Accomplished So Far

- ✅ **Resumed Plan I (persist) from the Plan H handoff and shipped it end-to-end.** Followed the runbook, including its instruction to _"survey before trusting any recommendation"_ — which caught two handoff errors (below).
- ✅ **Found the persist bug on the state-based-action death path** — materially worse than the handoff's "smallest remaining diff" framing. `hasPersist` gated through `hasKeyword(card, "persist")`, whose second arm is an **unanchored** `oracleText.includes("persist")`, via: `state-based-actions.ts → handlePersist() → hasPersist() → hasKeyword()`. `handlePersist` returns the card **to the battlefield from the graveyard** with a -1/-1 counter, so any creature whose `keywords` array omits the tag but whose text merely _mentions_ persist (`persistent`, `persists`, `persisted`, `impersistency`) was **resurrected by the SBA loop**. State corruption, not cosmetics. Exactly **1** production substring site (contrast shroud's 3).
- ✅ **Fixed it**: added `hasPersistStrict` to `keyword-actions/persist.ts` (`/^persist\b/i` over parsed keywords, no source-controller arg); `evergreen-keywords.hasPersist` now defers strict-first with a **word-boundary** `/\bpersist\b/i` oracle fallback. The fallback **must** stay anchored — leaving the unanchored arm would re-introduce the exact FP. CR 702.78 type-line guard untouched.
- ✅ **Proved the regression tests actually catch the bug** rather than just passing against new code: restored the old gate via `git checkout HEAD -- evergreen-keywords.ts` (after backing it up), re-ran, got **6 failures — exactly the false-positive pins**, including both `handlePersist` SBA-path cases; restored the fix → 25/25. This is the check that separates a real pin from a tautology.
- ✅ Filed **#2338** → committed `29f434e2` → PR **#2339** → **merged** `96710c25`; #2338 auto-closed; branch deleted (local + remote). All 17 required checks SUCCESS.
- ✅ **Filed #2340–#2343** from two unfiled findings, after chasing each down to its real blast radius (see §4).

### Where the previous handoff was wrong — survey again, do not trust

1. **Line numbers stale + grep shape misleads.** Grepping `hasKeyword(card, "` gives **false positives for "not yet fixed"**: deathtouch/lifelink/haste were already done and use the _multi-line_ shape `if (hasXStrict(card)) return true; return hasKeyword(...)`. The single-line `: return hasKeyword` form is the real unfixed signal. Persist used the same multi-line `if (!hasKeyword(...)) return false;` shape — **read function bodies, not grep lines.**
2. **CR numbers wrong**: persist is **CR 702.78** (not 702.141), infect **702.93** (not 702.90), mutate **702.140**. Trust the `CR 7xx` comments in the code over any handoff.

## 2. Modified Files

**Working tree is CLEAN — `git diff --stat` is empty.** Everything below is committed on `main` via squash merge of PR #2339:

- `src/lib/game-state/keyword-actions/persist.ts` — new `hasPersistStrict` + module-header rationale (5 files, +476/−9 total)
- `src/lib/game-state/evergreen-keywords.ts` — `hasPersist` strict-first + anchored fallback; added `hasPersistStrict` import
- `src/lib/game-state/__tests__/keyword-persist.test.ts` — **new, 25 tests** (strict parsing, FP/FN pins, `handlePersist` SBA-path regressions)
- `docs/TEST_VIDEO_FIXTURES.md` — ratcheted 585/11979 → 586/12004 (via `scripts/ratchet-test-count.mjs`)
- `docs/onboarding.md` — manual, 581/11979 → 586/12004 (its block had already drifted; no script owns it, see #2342)

**Untracked, by design (do NOT `git add -A`):** `.foreman/runs/*` (pre-existing scratch), `.handoff-archive/*.md` (incl. `2026-09-28-plan-i-persist-done.md` = full Plan I record), `.handoff.md` (this file).

## 3. Current Verification State

- **Full `npm test`: 586 suites, 11997 passed + 7 skipped (12004 total)**, 3 snapshots, no `--forceExit`. Was 585/11979.
- **`npx tsc --noEmit`:** clean. **`npm run lint`:** 0 errors (1 pre-existing unrelated warning, `COLOR_ABbrev_TO_FULL` at `evergreen-keywords.ts:401`).
- Related suites re-run green: keyword-enforcement, keyword-actions-families, state-based-actions ×2 → 187/187.
- `node scripts/check-test-count-docs.mjs` PASS (586/12004). QA coverage gate 0 todos.
- **CI on PR #2339:** MERGED `96710c25`, all 17 required checks `pass` individually, CodeQL + Analyze green.
- `mergeStateStatus` sat at `UNSTABLE` despite a fully green required set — the known auto-merge stall (now filed as **#2343**). Merged manually with `--squash --delete-branch`.

## 4. Filed This Session — all four verified against `96710c25`

Grading was wrong twice and got corrected both times. **Grep the callers before calling anything a P0 here:** `evergreen-keywords` is **not** re-exported by the `index.ts` barrel and deep engine imports are eslint-blocked outside the engine, so several wrong functions are unreachable.

| #                                                             | finding                                                                                                                                                                                                                                                                                                                                                                                                                 | severity                                         |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| [#2340](https://github.com/anchapin/planar-nexus/issues/2340) | `keyword-actions/flash.hasFlash` (correct, strict) is **unwired** — nobody imports it; `evergreen-keywords.hasFlash` is a divergent bare-substring copy holding the canonical name. Probed: a real Flashback card → `true` from the evergreen copy, `false` from the strict one. Also **`hasFlashStrict` is cited by 6 module headers (deathtouch, hexproof, lifelink, shroud, vigilance, ward) but has never existed** | low — live cast gate already correct since #2312 |
| [#2341](https://github.com/anchapin/planar-nexus/issues/2341) | `evergreen-keywords.hasDefender` is a non-strict duplicate; combat gate correctly uses `hasDefenderStrict`                                                                                                                                                                                                                                                                                                              | low — test-only consumers                        |
| [#2342](https://github.com/anchapin/planar-nexus/issues/2342) | `docs/onboarding.md` `TEST_COUNT` block has **no CI guard**; both scripts hard-code `DOC_PATH` to `TEST_VIDEO_FIXTURES.md`. Evidence: 581 vs guarded 585                                                                                                                                                                                                                                                                | medium                                           |
| [#2343](https://github.com/anchapin/planar-nexus/issues/2343) | `gh pr merge --auto` never fires — `mutation-pr.yml` 9 jobs hit `timeout-minutes: 2`, land in bucket `cancel`; #2328–#2339 all affected                                                                                                                                                                                                                                                                                 | medium                                           |

**Deliberately NOT filed** (low-value substring hardening, already recorded as `KNOWN LIMIT` in code — say the word if you want them tracked): persist's `typeLine.includes("creature")` guard, and the negation-aware oracle parses for `"hexproof from"` / "lose shroud".

## 5. Immediate Next Step

**File and execute Plan J — `prowess` (CR 702.108).** It is the highest-value remaining keyword because it has **two** production sites, the second being a genuine false _negative_ of the shroud class:

- `evergreen-keywords.ts` ~1231: `if (!hasKeyword(card, "prowess")) return false;` (bare, unanchored)
- `oracle-text-parser/casting-keywords.ts:106`: `const hasProwess = /\bprowess\b/i.test(oracleText);` — **oracle text only, never reads `keywords`**. Anchored, but text-only. Also note the FP direction: "Other creatures you control have prowess" (a continuous-effect _grant_) would read as inherent prowess.

**First three actions, in order:**

1. `git checkout main && git pull --ff-only` (expect `96710c25`).
2. **Survey before trusting this list.** Re-verify both sites above; check for a `hasProwessStrict` in `keyword-actions/`; grep production call sites. Assume these line numbers are stale too.
3. `gh issue create --title "fix(#<n>): prowess keyword enforcement via strict parsed-keywords check (cr 702.108)" --body-file <file>` — **next free is #2344**, but always confirm with `gh issue view` (numbers can land out of order vs PRs).

**Remaining set** (state as of `96710c25`):

| keyword          | CR      | sites | notes                                                                                                                                                                                                                                                                                        |
| ---------------- | ------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prowess`        | 702.108 | 2     | **do next** — has the false-negative site                                                                                                                                                                                                                                                    |
| `mutate`         | 702.140 | 1     | awkward: detection is inherently oracle-text-driven (parses the mutate _cost_, `alternative-costs.ts:247`). Strict-keyword pattern fits poorly                                                                                                                                               |
| `infect`         | 702.93  | 1     | coupled to the damage/poison pipeline — check blast radius first                                                                                                                                                                                                                             |
| `indestructible` | 702.12b | 2     | **LAST, deliberately** — `keyword-actions/removal.ts:19` is `keywords.includes("Indestructible") \|\| oracleText.includes("indestructible")` (case-**sensitive** on the keyword arm, case-insensitive on the text arm) + the bare `evergreen` site. Widest blast radius: damage/SBA pipeline |

Also open: regenerate the stale report for fresh numbers — `npx tsx scripts/analyze-gameplay-gaps.ts` → `reports/gameplay-gap-analysis.md`. Epic #2300's "243 of 257 unenforced" figure is heavily stale.

### Runbook (proven four times now)

1. `git checkout main && git pull --ff-only`. 2. **Survey every candidate; read bodies, not grep lines.** 3. File the issue, confirm the number. 4. `git checkout -b fix/issue-<n>-<kw>`. 5. New `hasXStrict` in `keyword-actions/<kw>.ts`; `evergreen-keywords.hasX` strict-first; **rewire every production substring site**; keep the fallback **anchored**. 6. **Prove the pins catch the bug** (restore old gate → confirm new tests fail → restore). 7. Tests + docs ratchet (`ratchet-test-count.mjs` covers **only** `TEST_VIDEO_FIXTURES.md`; `docs/onboarding.md` is manual). 8. PR squash + delete-branch; verify the 17 required checks; **merge manually** (#2343); `ci-wait <n>`, never poll.

### Conventions to preserve

- `keyword-actions/` (not `keyword-effects/`). No `index.ts` barrel — deep imports within the engine are the norm.
- Strict variants named `hasXStrict`; canonical `hasX` defers strict-first, then keeps an **anchored** substring fallback for untagged cards. Regex shape: `/^keyword\b/i.test(k.trim())` over `card.cardData.keywords ?? []`.
- Strict-check modules are **pure leaves** (no `evergreen-keywords` import) — that is what keeps cycles out. `persist.ts` is the exception: it needs `hasPersist`/`canPersistTrigger`, so the new import creates a cycle. Safe (all hoisted function declarations; strict check only called at runtime, never during module eval) and documented in the module header. **Not** tested under a bundler.
- `moduleNameMapper` in `jest.config.js` is scoped (`^.*/game-state/combat$`) — no collision with new `keyword-actions/*.ts`.
- **Jest 30: `--testPathPatterns` (plural).** `--testPathPattern` is removed and errors out.
- PR/issue bodies via shell heredoc to `/tmp/opencode/*.md` + `--body-file` — the `write` tool writes to a server-local mount invisible to the shell. Verify with `wc -l`.
- **New test helpers must NOT backfill `oracle_text` from the keyword list** when tests need keyword/text disagreement. `createMockCreature` in `keyword-enforcement.test.ts:101` _does_ backfill — do not copy it for FP/FN cases.
- **When a new test fails, first ask whether the _expectation_ was ever true** — do not assume the code is the bug. Plan I: I asserted `"Artifact — Creature"` should not get persist; it failed because the type-line guard is `includes("creature")` and an Artifact Creature _is_ a creature (rules-correct). Fixed the expectation, pinned real behavior, logged the substring as a `KNOWN LIMIT` follow-up.
- commitlint lower-case header, min 10 chars, types: `feat fix docs style refactor test chore revert`; footer needs a leading blank line.
- Pre-existing flake on `use-deck-coach-chat.test.ts` re-runs once and continues. Transient `npm install` EPROTO/SSL: re-trigger via empty `chore(ci):` commit.
- **Epic sub-issues DO auto-close on merge** (#2336→#2337, #2338→#2339 both did). The older claim that they don't is stale.
- **Do NOT `git add -A`** — sweeps `.foreman/`, `.handoff-archive/`, `.handoff.md`. Stage explicitly (5 paths for Plan I), or `git reset .foreman .handoff-archive .handoff.md`.

## 6. Epic State

- Epic: **#2300** — "243 of 257 detected keywords unenforced", heavily stale.
- Merged siblings (14 closed): #2312 (flash), #2314, #2316 (ward), #2318 (combat cleanup), #2322 (hexproof/protection), #2325 (flying/reach/menace), #2327 (trample/first-strike/double-strike), #2329 (vigilance), #2331 (deathtouch), #2333 (lifelink), #2335 (haste), #2337 (shroud), **#2339 (persist)**.
- Full Plan I narrative: `.handoff-archive/2026-09-28-plan-i-persist-done.md`.
