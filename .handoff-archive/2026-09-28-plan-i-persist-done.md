# Session Handoff Checkpoint — Plan I complete, ready for Plan J

**Timestamp:** 2026-09-28 (session resumed Plan I end-to-end)
**Branch:** `main` (synced, clean)
**Task:** Epic #2300 (keyword enforcement). **Plan I done — persist (CR 702.78) merged as PR #2339 → `96710c25` for #2338.** Next: Plan J.

## 1. Plan I (persist) — what shipped

Resumed from the Plan H handoff and executed its runbook. **Surveyed before trusting the handoff's recommendation list — and the handoff was wrong in two ways**, see §4.

- ✅ Filed **#2338**, implemented, 25 tests, PR #2339 → `96710c25` on `main`, #2338 auto-closed, branch deleted (local + remote). All 17 required checks SUCCESS.

### The bug was on the SBA death path — worse than a mis-detection

`hasPersist` gated through `hasKeyword(card, "persist")`, whose second arm is an **unanchored** `oracleText.includes("persist")`. The chain:

```
state-based-actions.ts  ->  handlePersist()  ->  hasPersist()  ->  hasKeyword()
```

`handlePersist` returns the card **to the battlefield from the graveyard** with a -1/-1 counter. So a creature whose `keywords` array omits the tag but whose oracle text merely _mentions_ persist — `persistent`, `persists`, `persisted`, `impersistency` — was **resurrected by the SBA loop**. State corruption, not cosmetics.

Exactly **one** production substring site (contrast shroud's three).

### Changes

- `keyword-actions/persist.ts` — new `hasPersistStrict`: `/^persist\b/i` over `card.cardData.keywords ?? []`, parsed keywords only.
- `evergreen-keywords.hasPersist` — strict-first, then a **word-boundary** `/\bpersist\b/i` oracle fallback. The fallback must stay anchored: leaving the unanchored `hasKeyword` arm in place re-introduces the exact false positive. CR 702.78 type-line guard untouched.
- `__tests__/keyword-persist.test.ts` (new, 25 tests).

### Verification worth copying

**Proved the regression tests actually catch the bug** rather than just passing against new code. Restored the old gate (`git checkout HEAD -- evergreen-keywords.ts`, after backing it up), re-ran, got **6 failures — exactly the false-positive pins**, including both `handlePersist` SBA-path `REGRESSION:` cases. Restored the fix → 25/25. Do this for future plans; it is the only thing that distinguishes a real pin from a tautology.

- **Tests:** 586 suites, 11997 passed + 7 skipped (**12004**), 3 snapshots. Was 585/11979. Related suites 187/187.
- **Typecheck** clean. **Lint** 0 errors (1 pre-existing unrelated warning, `COLOR_ABbrev_TO_FULL`).
- `node scripts/check-test-count-docs.mjs` PASS (586/12004).

## 2. Where the previous handoff was WRONG (survey before trusting, again)

1. **Line numbers were all stale** (expected) — but the "VERIFY, likely already deferred" items were genuinely done: deathtouch, lifelink, haste use the _multi-line_ shape `if (hasXStrict(card)) return true; return hasKeyword(...)`, so grepping for `hasKeyword(card, "` gives **false positives for "not yet fixed"**. Grepping the single-line form (`: return hasKeyword`) distinguishes them. Persist used the same multi-line `if (!hasKeyword(...)) return false;` shape — read the function body, not the grep line.
2. **CR numbers were wrong**: persist is **CR 702.78** (not 702.141); infect is **CR 702.93** (not 702.90); mutate is **CR 702.140**. Trust the `CR 7xx` comments already in the code over the handoff.

### Bonus finding, NOT yet filed — `defender` has a divergent second copy

`hasDefenderStrict` exists (#2314) and the real combat gate `combat/queries.ts:100,275` uses it. But `evergreen-keywords.hasDefender` (~line 737) is a **separate non-strict `hasKeyword` copy** still used by `canAttackIfNotDefender` and the description builder (~line 934). So the combat path is strict while the UI-facing helpers are not. Lower severity than shroud's (the _gate_ was the non-strict one there), but a real inconsistency worth a follow-up issue.

## 3. Immediate Next Step — Plan J

**Recommended: `prowess` (CR 702.108)** — it has **two** production sites, the second being a genuine false _negative_ of the shroud class:

- `evergreen-keywords.ts` ~1231: `if (!hasKeyword(card, "prowess")) return false;` (bare, unanchored).
- `oracle-text-parser/casting-keywords.ts:106`: `const hasProwess = /\bprowess\b/i.test(oracleText);` — **oracle text only, never reads `keywords`**. Anchored, but text-only. A card whose `keywords` array carries `Prowess` while the text form doesn't match is missed. Note the FP direction too: "Other creatures you control have prowess" (a continuous-effect _grant_) would read as inherent prowess.

**Order for the rest of the set** (verified state as of `96710c25`):

| keyword          | CR      | sites | notes                                                                                                                                                                                                                                                                                                                       |
| ---------------- | ------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prowess`        | 702.108 | 2     | **do next** — has the false-negative site                                                                                                                                                                                                                                                                                   |
| `mutate`         | 702.140 | 1     | awkward: detection is inherently oracle-text-driven (parses the mutate _cost_ from the text in `alternative-costs.ts:247`). Strict-keyword pattern fits poorly                                                                                                                                                              |
| `infect`         | 702.93  | 1     | coupled to the damage/poison pipeline — verify blast radius before touching                                                                                                                                                                                                                                                 |
| `indestructible` | 702.12b | 2     | **LAST, deliberately** — `keyword-actions/removal.ts:19` is `keywords.includes("Indestructible") \|\| oracleText.includes("indestructible")` (note: case-**sensitive** on the keyword arm, case-insensitive on the text arm), plus the bare `evergreen-keywords` site. Widest blast radius of the set — damage/SBA pipeline |

Next free issue number is **~#2344** (but #2338 was the number and #2339 the PR; always confirm with `gh issue view` after create — issue numbers can land out of order relative to PRs).

### Filed after Plan I (all verified against `96710c25`, all honestly downgraded)

Chasing these down changed their severity twice. Both keyword findings turned out to be **dead divergent duplicates**, not live rules bugs — the affected helpers have zero production callers, and `evergreen-keywords` is **not** in the `index.ts` barrel (and deep engine imports are eslint-blocked outside it). Worth re-checking blast radius before calling anything a P0 here.

| #                                                             | finding                                                                                                                                                                                                                                                                                                                                           | severity                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| [#2340](https://github.com/anchapin/planar-nexus/issues/2340) | `keyword-actions/flash.hasFlash` (correct, strict) is **unwired**; `evergreen-keywords.hasFlash` is a divergent bare-substring copy carrying the canonical name. Proven: a real Flashback card returns `true` from the evergreen copy, `false` from the strict one. Also: **`hasFlashStrict` is cited by 6 module headers but has never existed** | low (live cast gate already correct since #2312) |
| [#2341](https://github.com/anchapin/planar-nexus/issues/2341) | `evergreen-keywords.hasDefender` is a non-strict duplicate; combat gate correctly uses `hasDefenderStrict`                                                                                                                                                                                                                                        | low (test-only consumers)                        |
| [#2342](https://github.com/anchapin/planar-nexus/issues/2342) | `docs/onboarding.md` `TEST_COUNT` block has **no CI guard** — both scripts hard-code `DOC_PATH` to `TEST_VIDEO_FIXTURES.md`. Observed drift: 581 vs the guarded 585                                                                                                                                                                               | medium (recurring silent staleness)              |
| [#2343](https://github.com/anchapin/planar-nexus/issues/2343) | `gh pr merge --auto` never fires (`mergeStateStatus=UNSTABLE`) because `mutation-pr.yml`'s 9 jobs hit `timeout-minutes: 2` and land in bucket `cancel`. Re-confirmed on #2339                                                                                                                                                                     | medium (DX tax on every PR)                      |

**Meta-lesson from #2340:** my first read was "every Flashback card can be cast at instant speed" — a P0. It is false: the live gate is `keyword-actions/flash.canCastAtInstantSpeed` and is already correct. The `evergreen` copy is unreachable. Grep the _callers_ before grading severity; the presence of a wrong function is not the presence of a bug.

Also open: regenerate the stale report for fresh numbers — `npx tsx scripts/analyze-gameplay-gaps.ts` → `reports/gameplay-gap-analysis.md`. Epic #2300's "86 not enforced" figure is heavily stale.

## 4. Runbook (proven three times now)

1. `git checkout main && git pull --ff-only` (expect `96710c25`).
2. **Survey before trusting any recommendation.** For EVERY candidate: read the actual function body (not the grep line), grep `keyword-actions/<kw>.ts` for an existing `hasXStrict`, and grep production call sites for the keyword string. Assume the handoff's line numbers, CR numbers, and "already done" guesses may all be stale.
3. `gh issue create --title "fix(#<n>): <kw> keyword enforcement via strict parsed-keywords check (cr <x>)" --body-file <file>`; confirm the number landed with `gh issue view`.
4. `git checkout -b fix/issue-<n>-<kw>` from clean `main`.
5. Mirror the haste/lifelink/shroud/persist shape: new `hasXStrict` in `keyword-actions/<kw>.ts`, `evergreen-keywords.hasX` strict-first, **rewire every production substring site** (check more than the one named), and keep the fallback **anchored** where the unanchored arm is the bug.
6. **Prove the pins catch the bug** (restore the old gate, confirm the new tests fail, restore the fix).
7. Tests + docs ratchet. `scripts/ratchet-test-count.mjs` updates **only** `docs/TEST_VIDEO_FIXTURES.md` — `docs/onboarding.md` is manual and had drifted to 581 suites, now 586/12004.
8. PR squash + delete-branch. Verify the 17 required checks, then **merge manually** (see below). `ci-wait <n>`, never poll.

## 5. Operational finding — auto-merge still stalls (re-confirmed this session)

`gh pr merge --auto` will **not** fire even when all 17 required checks are SUCCESS. Cause: the 9 `Mutation score (*)` jobs from the **non-blocking** `mutation-pr.yml` hit `timeout-minutes: 2` and land in bucket `cancel`, so `mergeStateStatus` sits at **`UNSTABLE`**, and GitHub refuses auto-merge while any check is non-successful.

Re-confirmed on PR #2339: `mergeStateStatus=UNSTABLE`, `mergeable=MERGEABLE`, all 17 required checks `pass`, `ci-wait` reported SUCCESS — then merged cleanly with `gh pr merge <n> --squash --delete-branch`.

**Workaround:** verify the 17 _required_ checks are individually SUCCESS, then merge manually. Do NOT wait on auto-merge.

## 6. Conventions to preserve

- `keyword-actions/` directory (not `keyword-effects/`). No `index.ts` barrel — deep imports within the engine are the norm.
- Strict variants named `hasXStrict`; canonical `hasX` defers strict-first, then keeps an **anchored** substring fallback for untagged cards.
- Regex shape: `/^keyword\b/i.test(k.trim())` over `card.cardData.keywords ?? []`.
- Strict-check modules are **pure leaves** (no `evergreen-keywords` import) — that is why the cycles stay out. `persist.ts` is the exception: it needs `hasPersist`/`canPersistTrigger`, so importing `hasPersistStrict` back creates a cycle. It is safe (all hoisted function declarations, strict check only called at runtime, never during module eval) and is documented in the module header.
- `moduleNameMapper` in `jest.config.js` is scoped (`^.*/game-state/combat$`) — no collision with new `keyword-actions/*.ts`.
- **Jest 30: `--testPathPatterns` (plural).** `--testPathPattern` is removed and errors out.
- PR/issue bodies via shell heredoc to `/tmp/opencode/*.md` + `--body-file` (the `write` tool writes to a server-local mount invisible to the shell). Verify with `wc -l`.
- **Test helpers in new files must NOT backfill `oracle_text` from the keyword list** when tests need keyword/text disagreement. `createMockCreature` in `keyword-enforcement.test.ts:101` _does_ backfill — do not copy it for FP/FN cases.
- **When a new test fails, first ask whether the _expectation_ was ever true** — do not assume the code is the bug. Plan I: I asserted `"Artifact — Creature"` should not get persist; it failed because the type-line guard is a plain `includes("creature")` and an Artifact Creature _is_ a creature (rules-correct). Fixed the expectation, pinned the real behavior, and logged the type-line substring as a `KNOWN LIMIT` follow-up.
- commitlint lower-case header, min 10 chars, types: `feat fix docs style refactor test chore revert`. Footer needs a leading blank line.
- Pre-existing flake on `use-deck-coach-chat.test.ts` re-runs once and continues.
- Transient `npm install` EPROTO/SSL errors: re-trigger via empty `chore(ci):` commit.
- **Epic sub-issues DO auto-close on merge** (#2336→#2337, #2338→#2339 both auto-closed). The older claim that they don't is stale.
- **Do NOT `git add -A`** — it sweeps `.foreman/`, `.handoff-archive/`, `.handoff.md`. Stage explicitly (5 paths for Plan I), or `git reset .foreman .handoff-archive .handoff.md` after.

## 7. Epic state

- Epic: **#2300** (keyword enforcement). Its "86 not enforced" figure is heavily stale.
- Merged siblings: #2312 (flash), #2314 (ward/defender), #2316 (ward), #2318 (combat cleanup), #2322 (hexproof/protection), #2325 (flying/reach/menace), #2327 (trample/first-strike/double-strike), #2329 (vigilance), #2331 (deathtouch), #2333 (lifelink), #2335 (haste), #2337 (shroud), **#2339 (persist)** — 14 sub-issues closed.
