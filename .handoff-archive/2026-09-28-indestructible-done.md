# Session Handoff Checkpoint

**Timestamp:** 2026-09-28T19:30:00Z
**Branch:** `main` — clean, at `1240710a` (synced with origin). **#2351 is done and merged.**
**Task:** Epic #2300 (keyword enforcement). **Plan L — `infect` (CR 702.90a–f) implemented, PR [#2352](https://github.com/anchapin/planar-nexus/pull/2352) squash-merged as `1240710a`, issue #2351 closed.**

## 1. What Was Done

Implemented #2351 end to end. Design decision taken at the start (Foreman abstained, human chose option A):

- ✅ **New pure-leaf `src/lib/game-state/keyword-actions/infect.ts`** — `hasInfectStrict` (parsed keywords only, `^infect\b` per token) plus **`isInfectGrantOrNegationPhrase`**, a 5-regex list. No `evergreen-keywords` import → no cycle.
- ✅ **`evergreen-keywords.hasInfect`** rewritten strict-first → grant/negation rejection → anchored `/\binfect\b/i`. **Anchoring alone was not enough** — Vector Asp ("gains infect") and Melira ("lose infect") still matched, which is why the rejection exists. Bare `"has infect"` is deliberately NOT excluded so a written-out self-grant still reads true.
- ✅ **Conversion moved into `dealDamageToCard`** (`damage-tap.ts`), _after_ the prevention/replacement pipeline and beside the deathtouch branch. Closes 702.90e (non-combat) and the prevention bypass together. Scoped to creatures (702.90c) via `isCreature(card)`. `combat/resolution.ts` is now a thin caller at all four sites; `addCounters`/`getToughness` imports dropped there.
- ✅ Deathtouch lethal marking gated on `!infectConvertsToCounters`; toxic added to the infect trample branch; CR citations corrected to **702.90a–f** and **702.95** (702.93 is _convoke_); evergreen gloss corrected (creature damage is -1/-1, not poison); two dead `hasInfect` imports dropped, **no check wired** (no such CR rule).
- ✅ New `__tests__/keyword-infect.test.ts` — **60 cases**, helpers never backfill `oracle_text`. Temporary probe `zz-infect-probe.test.ts` created and **deleted** (verified gone).

### One existing expectation was WRONG and is now corrected

`combat.test.ts` asserted a 1/1 infect+deathtouch **destroys** a 0/5 blocker (`CR 702.2b + 702.93b`). Per **702.90c** it must not — Blightsteel Colossus does not either. Corrected to assert the survivor. **This was the only pre-existing test failure** (1 failed / 46 suites in the targeted run).

## 2. Verification (all re-run this session)

- `npm test` — **589 suites, 12133 passed + 7 skipped (12141)**, 3 snapshots, no `--forceExit`. One failure on the first run: the known pre-existing flake in `use-deck-coach-chat.test.ts`; passes in isolation. Baseline was 588/12081.
- `tsc --noEmit` clean · `npm run lint` **0 errors**, 599 warnings (601 baseline − 2 dead imports; none in touched code) · `prettier --check` clean.
- `ratchet:test-count` → `docs/TEST_VIDEO_FIXTURES.md` (589/12141); `docs/onboarding.md` block updated **by hand** (manual per #2342). `check-test-count-docs` PASS.
- PR #2352: all **17 required** checks SUCCESS (verified against `required_status_checks`, not raw count), merged **manually** with squash, branch deleted.
- `git checkout main && git pull --ff-only` → `1240710a`, tree clean.

## 3. Post-Merge Finding (new, filed as #2353)

`main` CI is **red for the last 3 merges** — pre-existing, NOT caused by #2352. The `Test` job succeeds every time; four jobs fail:

- `Flake Detector (Jest)` — **7 flaky tests in `src/app/api/ai-proxy/__tests__/route.test.ts`**, all with the same `PASS PASS PASS FAIL FAIL` signature, alongside runner `Failed to recover package-lock.json. Disk space may be exhausted` + `npm-ci-retry` notices. Shared per-file state / resource pressure, not seven test bugs.
- **`Test Count Docs Guard`** — cascades from the same flake: `check-test-count-docs.mjs` requires `npm test --silent` to exit **0** before it will report doc sync. The doc numbers were correct. This also blocks `ratchet-test-count.mjs` locally (retry until it clears — it succeeded on attempt 1 this session).
- `Cross-Browser E2E (firefox + webkit)`, `E2E Tests`, `Flake Detector (Playwright)` — pass on the PR run for the same commit, fail on the pushed `main` commit. Push-vs-PR asymmetry, undiagnosed.

Filed: [#2353](https://github.com/anchapin/planar-nexus/issues/2353). Do **not** re-diagnose.

## 4. Immediate Next Step

**#2350 (indestructible) is the next keyword-arm item** — the handoff's ranked runner-up, and the last one on the "high" list.

1. `git checkout main && git pull --ff-only` (expect `1240710a`).
2. Survey is **partly done**; the rest is cheap: `removal.ts:19` is case-**sensitive** and unanchored vs `isIndestructible` case-insensitive; a **third** copy sits at `combat-decision-tree.ts:1309`; and it sits on **SBA 704.5f** where a false negative _kills an indestructible permanent_.
3. **Expect mutation-score movement** — nightly Stryker covers that module, so tightening it will move scores. That is the point, not a regression.
4. Then: #2348 (grant/negation — the generalization of `isInfectGrantOrNegationPhrase`), #2349 (shared type-line predicate), #2340 (cheapest: the strict check exists and is correct, it is just unwired), #2342, #2343.
5. Independent: regenerate the stale gap report — `npx tsx scripts/analyze-gameplay-gaps.ts` → `reports/gameplay-gap-analysis.md`. Epic #2300's "243 of 257 unenforced" figure is heavily stale.

### Open issues (all under epic #2300 unless noted)

| #     | finding                                                                                                                                            | severity                |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| #2340 | `flash.hasFlash` (correct, strict) is **unwired**; `evergreen-keywords.hasFlash` is a divergent bare-substring copy                                | low, cheapest remaining |
| #2341 | `evergreen-keywords.hasDefender` is a non-strict duplicate                                                                                         | low                     |
| #2342 | `docs/onboarding.md` `TEST_COUNT` block has **no CI guard**                                                                                        | medium                  |
| #2343 | `gh pr merge --auto` never fires — `mutation-pr.yml` parent lands in bucket `cancel`                                                               | medium                  |
| #2348 | Grant/negation oracle semantics; live `hasShroud` two-copy divergence + `getTargetingRestrictions:417` raw `includes("hexproof")`                  | medium                  |
| #2349 | `hasPersist`/`hasProwess`/`handlePersist` re-derive `typeLine.includes("creature")` three times                                                    | low                     |
| #2350 | Indestructible. `removal.ts:19` case-sensitive + unanchored vs `isIndestructible`; **third** copy at `combat-decision-tree.ts:1309`; on SBA 704.5f | high, latent            |
| #2353 | main red 3 merges: ai-proxy flake → Test Count Docs Guard cascade (+ E2E asymmetry)                                                                | medium, **not epic**    |

**#2351 closed this session.** The keyword-arm sweep is fully enumerated; only #2350 remains on the "high" list.

## 5. Conventions (load-bearing)

- `keyword-actions/` (not `keyword-effects/`). No `index.ts` barrel — deep imports within the engine are the norm.
- Strict variants named `hasXStrict`; canonical `hasX` defers strict-first, then an **anchored** fallback. Regex shape `/^keyword\b/i` over `card.cardData.keywords ?? []`.
- Strict-check modules are **pure leaves** (no `evergreen-keywords` import). `persist.ts` is the documented exception.
- **NEW precedent:** the grant/negation phrase rejection (`isInfectGrantOrNegationPhrase`). Scoped to infect; #2348 generalizes it. Keep it phrase-shaped, never a full grant parse, and never exclude bare "has <keyword>" — the false-negative direction is the expensive one.
- `moduleNameMapper` in `jest.config.js` is scoped (`^.*/game-state/combat$`) — no collision with new `keyword-actions/*.ts`.
- **Jest 30: `--testPathPatterns` (plural).** `--testPathPattern` is removed.
- **Never `git add -A`** — stage explicitly, or `git reset .foreman .handoff-archive .handoff.md`.
- commitlint: lower-case header, min 10 chars, types `feat fix docs style refactor test chore revert`. `npx commitlint --last` emits a non-blocking `footer-leading-blank` **warning** when a body line starts with `Tests:` — harmless, CI does not use `--max-warnings 0`.
- Prettier rewrites the whole file it touches and **normalizes import quotes to double** — write new imports that way, or accept the churn.
- PR/issue bodies via `/tmp/opencode/*.md` + `--body-file`; verify with `[ -f ... ]` before filing. `gh` needs `-R anchapin/planar-nexus` when run outside the repo.
- Measure before grading severity: grep production callers first, read bodies not grep lines. **When a new test fails, first ask whether the expectation was ever true** — 7 of my initial pins were wrong and measurement corrected every one.

### Traps hit this session

- **SBA 704.5q** removes N of each when a permanent holds both +1/+1 and -1/-1. The infect+deathtouch 4/4 blocker therefore ends with **one +1/+1 and no -1/-1**, not one -1/-1. Do not write a counter-count pin there without accounting for it.
- **Counters are cleared on a zone change** (`moveCardToZone`), so any creature that dies in SBA cannot be asserted on for counters. Use a survivor big enough to hold them.
- **Never `git checkout HEAD -- <file>`** to prove an old gate also reverts the _signature_ — it inflates the failure count.
- `use-deck-coach-chat.test.ts` flake: passes in isolation, fails under full-suite load. It can block both `npm test` and the ratchet. Retry; do not chase.

### Standing caution (unconfirmed across four sessions — treat as habit)

re-`stat`/`git status` around writes, verify `git log` after `git add`, write the handoff last.

### Epic state

Epic **#2300**; merged siblings (17 closed): #2312, #2314, #2316, #2318, #2322, #2325, #2327, #2329, #2331, #2333, #2335, #2337, #2339, #2345, #2347, **#2351** (+#2304). Narratives: `.handoff-archive/2026-09-28-plan-k-mutate-done.md`, `…-infect-survey-done.md` (survey for #2351), and this file.
