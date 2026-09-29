# Session Handoff Checkpoint

**Timestamp:** 2026-09-28T23:15:00Z
**Branch:** `main` — clean, at `2cec6e1b` (synced with origin). **#2348 is done and merged.**
**Task:** Epic #2300 (keyword enforcement). The "high" list is empty. #2348 (grant/negation generalization) shipped; the next items are the low/medium leftovers.

## 1. What Was Done

**#2348** — implemented end to end. PR [#2357](https://github.com/anchapin/planar-nexus/pull/2357) squash-merged as `2cec6e1b`, issue closed.

Scope was decided by **probe, not by the handoff's suggestion**. The handoff said "generalize the two lists." Probing found that was the smaller half: **only infect and indestructible had the guard at all**.

- ✅ New pure-leaf `src/lib/game-state/keyword-actions/grant-negation.ts` — `isKeywordGrantOrNegationPhrase(keyword, oracleText)` (5 phrasing classes, parameterized, regexes memoized per keyword) and `oracleTextDeclaresOwnKeyword(keyword, oracleText)` (the composed `!guard && /\bKW\b/i` fallback arm).
- ✅ **Both bespoke lists deleted** (`INFECT_GRANT_OR_NEGATION_PHRASES`, `INDESTRUCTIBLE_GRANT_OR_NEGATION_PHRASES` — measured byte-identical modulo the keyword).
- ✅ **Four gates that had no guard now have it**: `hasMutate` (both copies), `hasProwess`, `hasShroud` (both copies), `hasHexproof` (both copies).
- ✅ Two alignment fixes: `evergreen-keywords.hasShroud` (was unanchored `hasKeyword`) now agrees with the targeting copy; `getTargetingRestrictions` hexproof line (missed by #2336) now uses strict-first `hasHexproof`.
- ✅ New `__tests__/keyword-grant-negation.test.ts` — **123 cases**.

### The measured divergence (probe: 8 phrase classes x 6 gates)

| oracle text                                  | infect | indestr. | mutate   | shroud   | hexproof |
| -------------------------------------------- | ------ | -------- | -------- | -------- | -------- |
| `Other creatures you control have {X}.`      | false  | false    | **true** | **true** | **true** |
| `Creatures your opponents control lose {X}.` | false  | false    | **true** | **true** | **true** |
| `This creature gains {X} until end of turn.` | false  | false    | **true** | **true** | **true** |
| `This creature has {X}.`                     | true   | true     | true     | true     | true     |

**Three were live correctness bugs, not cosmetic**: `hasHexproof`/`hasShroud` sit behind `canTarget` (a card that only _grants_ the keyword was wrongly untargetable), and `hasProwess` gates trigger detection so `applyProwessBoost` stamped a live +1/+1 on a creature that only granted prowess to others.

### The shroud divergence (issue item 1, confirmed real)

`evergreen-keywords.hasShroud` (unanchored `hasKeyword`) vs `targeting-validation.hasShroud` (word-bounded) disagreed on **"This creature is unshrouded." / "Shrouding the temple." / "Enshrouded in mist."** — evergreen said `true` on all three.

## 2. Verification

- `npm test` — **591 suites, 12315 passed + 7 skipped (12322)**, 3 snapshots, no `--forceExit`. Baseline 590/12178. **No flakes this run** (`use-deck-coach-chat` did not fire).
- `tsc --noEmit` clean · `npm run lint` **0 errors, 599 warnings** (= baseline; note the hexproof fix orphaned a local, removed it) · `prettier --check` clean on every touched file.
- `ratchet:test-count` → `docs/TEST_VIDEO_FIXTURES.md`; `docs/onboarding.md` by hand. `check-test-count-docs` PASS.
- PR #2357: **all 17 required** checks pass (verified against `required_status_checks`, not a raw count), squash-merged, branch deleted. `git checkout main && git pull --ff-only` → `2cec6e1b`, tree clean.

## 3. Immediate Next Step

**Recommended: #2355** (not epic) — 14 case-sensitive `keywords?.includes("indestructible")` sites in `src/ai/`. All live false negatives: `AIPermanent.keywords` passes Scryfall's title-case array straight through (`serialization.ts:166`), so the AI is blind to indestructible. Tests hide it with lowercase fixtures. **Also worth auditing the other AI keywords for the same bug.** Cheapest high-signal remaining item.

Then, in order:

1. **#2340** — cheapest epic item. `flash.hasFlash` is correct and strict, just **unwired**; `evergreen-keywords.hasFlash` is a divergent bare-substring copy.
2. **#2341** — `evergreen-keywords.hasDefender` is a non-strict duplicate.
3. **#2349** — `hasPersist`/`hasProwess`/`handlePersist` re-derive `typeLine.includes("creature")` three times.
4. **#2342** — `docs/onboarding.md` `TEST_COUNT` block has no CI guard. (Note: `check-test-count-docs.mjs` **does** exist and does guard `docs/TEST_VIDEO_FIXTURES.md` — re-verify the scope claim before working.)
5. **#2343** — `gh pr merge --auto` never fires; `mutation-pr.yml` parent lands in bucket `cancel`.
6. **#2353** (not epic) — main red merges from the pre-existing `ai-proxy` flake. Do **not** re-diagnose.

### Open issues (all under epic #2300 unless noted)

| #     | finding                                                                                                           | severity                          |
| ----- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| #2340 | `flash.hasFlash` correct+strict but **unwired**; `evergreen-keywords.hasFlash` is a divergent bare-substring copy | low, cheapest remaining           |
| #2341 | `evergreen-keywords.hasDefender` is a non-strict duplicate                                                        | low                               |
| #2342 | `docs/onboarding.md` `TEST_COUNT` block has **no CI guard** (re-verify)                                           | medium                            |
| #2343 | `gh pr merge --auto` never fires — `mutation-pr.yml` parent lands in bucket `cancel`                              | medium                            |
| #2349 | `hasPersist`/`hasProwess`/`handlePersist` re-derive `typeLine.includes("creature")` three times                   | low                               |
| #2353 | AI layer: main red 3 merges: ai-proxy flake → Test Count Docs Guard cascade (+ E2E asymmetry)                     | medium, **not epic**              |
| #2355 | AI layer: 14 case-sensitive indestructible checks, all live false negatives                                       | medium, **not epic**, **next up** |

**#2348, #2350 and #2351 closed. 19 epic issues closed total.**

## 4. Conventions (load-bearing)

- `keyword-actions/` (not `keyword-effects/`). No `index.ts` barrel — deep imports within the engine are the norm.
- Strict variants named `hasXStrict`; regex shape `/^keyword\b/i` over `card.cardData.keywords ?? []`.
- Strict-check modules are **pure leaves** (no `evergreen-keywords` import). `grant-negation.ts` is a pure leaf with **zero imports** — its keyword argument is a compile-time literal, so the regex cache is bounded.
- **Composed gate** (`hasXKeyword` exported from the leaf, both call sites delegate) is for gates with **>1 engine call site**. The split shape (`hasXStrict` in the leaf, composition in the caller) is for single call sites. `hasIndestructibleKeyword` is the reference example.
- **NEW (this session):** when a fallback arm needs more than an anchored match, put the whole arm in one shared helper and call it from every gate. `oracleTextDeclaresOwnKeyword` is the shape; do **not** hand-roll `!guard && /\bKW\b/i` again.
- `moduleNameMapper` in `jest.config.js` is scoped (`^.*/game-state/combat$`) — no collision with new `keyword-actions/*.ts`.
- **Jest 30: `--testPathPatterns` (plural).** `--testPathPattern` is removed.
- **Never `git add -A`** — stage explicitly.
- commitlint: lower-case header, min 10 chars, types `feat fix docs style refactor test chore revert`. Emits a non-blocking `footer-leading-blank` **warning** when a body line starts with `Tests:` — harmless.
- PR/issue bodies via `/tmp/opencode/*.md` + `--body-file`; verify with `[ -f ... ]` before filing.
- **Measure before grading severity: grep production callers first, read bodies not grep lines. When a new test fails, first ask whether the expectation was ever true.** This session that rule caught **three** things: (a) my scope assumption ("just generalize two lists") was wrong — four other gates had no guard; (b) two of my own new test expectations were wrong (bare `"has X"` and bare `"X"` must be `true`, not `false`); (c) an existing hexproof fixture asserted `true` on text reading `"(This creature does not.)"` — the test contradicted its own fixture.
- **Probe before you plan.** Write `zz-probe-*.test.ts`, delete it, verify it is gone. The 4-gate gap and the shroud divergence were both invisible to code reading; the probe found them in one run.

### Traps hit this session

- **The 9 `Mutation score (*)` jobs fail on every PR with `The job has exceeded the maximum execution time of 2m0s`** — an infra timeout, not a score regression, and **not in the 17 required checks**. It has fired identically on #2338, #2344, #2346, #2351, #2350 and #2348. This is the pre-existing **#2343**. Do not investigate; verify against `required_status_checks` and move on.
- `ci-wait` false-reports SUCCESS/FAILED in `0m 1s` when checks are freshly QUEUED. `sleep 45 && ci-wait <PR>`, then re-read `gh pr checks` directly. Same for FAIL — it reported FAILED on 0m 1s once.
- **Do not trust a hand-rolled `gh pr checks` parser.** I wrote a node script comparing required contexts to results, got `[name, , conclusion]`, and read the **duration** as the conclusion — reported "BLOCKED" on a fully green PR. Index `[name, conclusion]`.
- **Stryker cannot complete locally — do not retry** (carried forward from the last two sessions; two independent ~24 min runs, projected ~4500h remaining).
- Engine modules were split from single files into family directories (`combat/`, `mana/`, `game-state/`, `keyword-actions/`, `spell-casting/`). **Any script, grep, or config referencing `combat.ts` / `mana.ts` / `game-state.ts` is now stale.**
- CR numbering: **704.5f = 0 toughness → put into graveyard; 704.5g = lethal damage → destroyed.**
- Prettier normalizes import quotes to double and rewrites the whole file it touches — expected churn, accept it. `prettier --check src docs/` reports **93 pre-existing failures in `docs/`** — the lint-staged hook only covers staged files; check only what you touched.
- `use-deck-coach-chat.test.ts` flake: passes in isolation, fails under full-suite load. Retry; do not chase. (Did not fire this session.)

### Standing caution (unconfirmed across six sessions — treat as habit)

re-`stat`/`git status` around writes, verify `git log` after `git add`, write the handoff last.

### Epic state

Epic **#2300**; merged siblings (19 closed): #2312, #2314, #2316, #2318, #2322, #2325, #2327, #2329, #2331, #2333, #2335, #2337, #2339, #2345, #2347, #2350, #2351, **#2348** (+#2304). Narratives: `.handoff-archive/2026-09-28-indestructible-done.md`, `…-infect-survey-done.md`, `…-plan-c-prep.md`, and this file.
