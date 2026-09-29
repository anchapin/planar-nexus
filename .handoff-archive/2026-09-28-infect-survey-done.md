# Session Handoff Checkpoint

**Timestamp:** 2026-09-28T18:11:07Z
**Branch:** `main` (synced with origin, clean) at `90ad94ba`
**Task:** Epic #2300 (keyword enforcement). **Plan K (mutate, CR 702.140) merged — #2346 → PR #2347 → `90ad94ba`.** Then filed the untracked-findings pass: #2348, #2349, #2350. Next: **Plan L — `infect` (CR 702.93)**, the last unfiled keyword site.

## 1. Accomplished So Far

- ✅ **Plan K (`mutate`) shipped and merged.** The prior handoff said "one production site" and pointed at `evergreen-keywords.hasMutate` — that was wrong. There are **two** same-named `hasMutate` exports, and the one it did not name (`mutate.ts:24`) is the live one, wired via `cast.ts:509` → `canCastWithMutate`.
- ✅ **Empirically measured the divergence** (temporary probe, deleted): the two gates **disagreed**. `keywords: ["mutate"]` (lowercase), no oracle text → `mutate.ts` said `false`, `evergreen-keywords` said `true`. The gate actually in the casting path was the **stricter and buggier** one (case-**sensitive** `includes("Mutate")`).
- ✅ **FP surface measured** on the unanchored `includes("mutate")`: matches `mutates`, `Unmutated`, `commutates`, and `"This creature can't be mutated."`. (`mutation` never matched — `mutat-ion` — kept as a regression guard.)
- ✅ **Re-graded LOW, as instructed.** The `alternative-costs.ts` regexes are genuinely **cost extraction**, not keyword presence — left untouched, with the reason recorded in the new module header. The keyword half fit the pattern, so the work was real but low severity: in `castSpell`, `parseMutate` rejects non-mutate cards at `cast.ts:490` _before_ the loose gate runs, so the substring FPs are not reachable through the current casting flow.
- ✅ New pure-leaf `hasMutateStrict`; both gates defer to it, keeping an anchored `/\bmutate\b/i` fallback. `mutate.ts#hasMutate` reshaped to `CardInstance` to match sibling strict checks (3 call sites in `mutate.test.ts` updated).
- ✅ **Untracked-findings pass** — probed the previously-undocumented KNOWN LIMITs and filed three issues: **#2348** grant/negation oracle semantics, **#2349** type-line creature-guard duplication, **#2350** indestructible (survey, do last).
- ✅ **All 17 required CI checks green** on #2347 (verified against `required_status_checks`, not the raw check count). Merged manually as squash; branch deleted local + remote. Prior handoff archived.

### Two things the next session must not lose

1. **The AI layer may hold keyword copies the engine sweep never reached.** `src/ai/decision-making/combat-decision-tree.ts:1309` computes its own `isIndestructible` **outside** `src/lib/game-state/`. Every sweep in this epic has been engine-scoped. Re-grep `src/ai/` before declaring the epic done, and check whether such copies are deliberate. Surfaced while surveying #2350.
2. **Fixing a gate moves mutation scores.** `state-based-actions.mutation.test.ts` exercises SBA 704.5f directly against `!hasIndestructible`, and nightly Stryker covers that module. Tightening indestructible will change killed-mutant counts — treat movement as expected and explain it, not as a regression (see #2350 step 4).

### Where the old-gate proof has a trap

`git checkout HEAD -- mutate.ts evergreen-keywords.ts` also reverts the **signature** change, so the old `hasMutate` receives a `CardInstance`, finds no `.keywords`, and returns `false` for everything — inflating failures to **22**. The real signal is **4**; read it with `npx jest --testPathPatterns=keyword-mutate -t "rejects"`. Do not report the inflated number.

## 2. Modified Files

**All committed at `90ad94ba`. Working tree has zero modified/staged tracked files.**

- `src/lib/game-state/keyword-actions/mutate.ts` — **new** `hasMutateStrict` + module header (incl. why the cost-extraction regexes are out of scope). Pure leaf, no `evergreen-keywords` import → no cycle.
- `src/lib/game-state/mutate.ts` — `hasMutate` now `CardInstance`-shaped, strict-first + anchored fallback; `canCastWithMutate` passes `card` not `card.cardData`.
- `src/lib/game-state/evergreen-keywords.ts` — added `hasMutateStrict` import; `hasMutate` rewritten off `hasKeyword` onto the same strict-first + anchored shape. The two exports can no longer diverge.
- `src/lib/game-state/__tests__/keyword-mutate.test.ts` — **new, 48 tests**, authored by me this session. Pins FPs, FNs, a `describe.each` over **both** gates, an explicit "the two exports agree" block, and the KNOWN LIMIT.
- `src/lib/game-state/__tests__/mutate.test.ts` — 3 call sites updated for the signature change.
- `docs/TEST_VIDEO_FIXTURES.md` — 587/12033 → 588/12081 (`ratchet-test-count.mjs` owns this file).
- `docs/onboarding.md` — same numbers, **manual**; no script owns it (still #2342).

**Untracked by design — NEVER `git add -A`:** `.foreman/runs/*` (3 dirs), `.handoff-archive/*.md` (11 files), `.handoff.md`. That is the entire `git status --short` output; a clean tree looks "dirty" here by design.

## 3. Current Verification State

- **`npm test`: 588 suites, 12074 passed + 7 skipped (12081)**, 3 snapshots, no `--forceExit`. Was 587/12033.
- `npx tsc --noEmit` **clean**.
- `npm run lint` **0 errors**, 601 warnings — pre-existing baseline, none in the touched files.
- `npx prettier --check` **clean** on all 5 touched `.ts` files.
- `node scripts/check-test-count-docs.mjs` **PASS** (588 / 12081). QA coverage gate 0 todos.
- **CI on #2347: all 17 required checks `pass`.** The 9 `Mutation score (*)` jobs report `CANCELLED` with parent _"Mutation Score (PR info)"_ cancelled — the known #2343 `timeout-minutes: 2` bug, **not** a score regression. `Build` was the last straggler; wait it out rather than merging on a partial set.
- `mergeStateStatus` sat at `UNSTABLE` despite a fully green required set (known #2343 stall). Merged manually.

**Nothing is pending or failing.** No unrun tests, no blockers. The three issues filed are open by design.

## 4. Immediate Next Step

**Plan L — `infect` (CR 702.93).** It is the **only remaining unfiled keyword site**. The handoff flags it as "coupled to the damage/poison pipeline — check blast radius first", so establish the blast radius _before_ grading severity, as Plan K's cost/keyword split taught.

1. `git checkout main && git pull --ff-only` (expect `90ad94ba`).
2. **Re-grep `src/ai/` for keyword checks** as well as the engine — the `combat-decision-tree.ts:1309` indestructible copy suggests the AI layer holds duplicates the engine sweep never reached, and `infect` may have the same problem.
3. Survey infect: re-locate every site, grep production callers, read bodies not grep lines.
4. `gh issue create` — **next free is #2351, but confirm with `gh issue view` first** (#2346–#2350 are all consumed).

### Open issues (all under epic #2300)

| #                                                             | finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | severity                  |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| [#2340](https://github.com/anchapin/planar-nexus/issues/2340) | `flash.hasFlash` (correct, strict) is **unwired**; `evergreen-keywords.hasFlash` is a divergent bare-substring copy. `hasFlashStrict` is cited by 6 module headers but has never existed                                                                                                                                                                                                                                                                                                                                   | low                       |
| [#2341](https://github.com/anchapin/planar-nexus/issues/2341) | `evergreen-keywords.hasDefender` is a non-strict duplicate; the combat gate correctly uses `hasDefenderStrict`                                                                                                                                                                                                                                                                                                                                                                                                             | low                       |
| [#2342](https://github.com/anchapin/planar-nexus/issues/2342) | `docs/onboarding.md` `TEST_COUNT` block has **no CI guard**; both scripts hard-code `DOC_PATH`                                                                                                                                                                                                                                                                                                                                                                                                                             | medium                    |
| [#2343](https://github.com/anchapin/planar-nexus/issues/2343) | `gh pr merge --auto` never fires — `mutation-pr.yml` parent job lands in bucket `cancel`; #2328–#2347 all affected                                                                                                                                                                                                                                                                                                                                                                                                         | medium                    |
| [#2348](https://github.com/anchapin/planar-nexus/issues/2348) | Grant/negation oracle semantics. Anchored fallback is a boolean, so `"Other creatures you control have mutate."` and `"This creature loses shroud."` both read as having the keyword. **Includes a live two-copy divergence:** `evergreen-keywords.hasShroud` uses unanchored `hasKeyword` while `targeting-validation.hasShroud` uses anchored `/\bshroud\b/i` — measured disagreement on `unshrouded` / `shrouding` / `enshrouded`. Also `getTargetingRestrictions:417` still uses raw `oracleText.includes("hexproof")` | medium                    |
| [#2349](https://github.com/anchapin/planar-nexus/issues/2349) | `hasPersist`, `hasProwess`, and `handlePersist` (`persist.ts:94-97`) each re-derive an independent `typeLine.includes("creature")` — three copies, no shared predicate, free to drift                                                                                                                                                                                                                                                                                                                                      | low                       |
| [#2350](https://github.com/anchapin/planar-nexus/issues/2350) | Indestructible, **do LAST**. `removal.ts:19` is case-**sensitive** `keywords.includes("Indestructible") \|\| unanchored text`; `evergreen-keywords.isIndestructible` uses case-insensitive `hasKeyword` → same divergence Plan K fixed for mutate. Plus a **third** check at `combat-decision-tree.ts:1309`. Sits on SBA 704.5f — a false negative **kills an indestructible permanent**                                                                                                                                   | high blast radius, latent |

**Not filed, by choice:** the written-out-ability false negative (folded into #2348, same root cause); CR 702.11b `hexproof from` and ward-from variants (documented as deliberate refinements in `keyword-actions/hexproof.ts:27-30`, mirroring #2316).

### Also open, independent of the keyword work

- Regenerate the stale gap report: `npx tsx scripts/analyze-gameplay-gaps.ts` → `reports/gameplay-gap-analysis.md`. Epic #2300's "243 of 257 unenforced" figure is heavily stale.
- #2340 is the cheapest remaining win: the strict check already exists and is correct, it just is not wired.

### Runbook (proven six times)

1. `git checkout main && git pull --ff-only`. 2. **Survey every candidate; read bodies, not grep lines; grep callers before grading severity.** 3. File the issue, confirm the number. 4. `git checkout -b fix/issue-<n>-<kw>`. 5. New `hasXStrict` in `keyword-actions/<kw>.ts`; `evergreen-keywords.hasX` strict-first; **rewire every production substring site**; keep the fallback **anchored**. 6. **Prove the pins catch the bug** — and check whether the revert also reverted a signature (see the trap above). 7. Tests + docs ratchet (`ratchet-test-count.mjs` covers **only** `TEST_VIDEO_FIXTURES.md`; `docs/onboarding.md` is manual). 8. PR squash + delete-branch; verify the **17 required** checks; **merge manually** (#2343); `ci-wait <n>`, never poll. Wait for `Build` stragglers.

### Conventions to preserve

- `keyword-actions/` (not `keyword-effects/`). No `index.ts` barrel — deep imports within the engine are the norm.
- Strict variants named `hasXStrict`; canonical `hasX` defers strict-first, then keeps an **anchored** substring fallback for untagged cards. Regex shape: `/^keyword\b/i` over `card.cardData.keywords ?? []`.
- Strict-check modules are **pure leaves** (no `evergreen-keywords` import). `persist.ts` is the exception — it needs `hasPersist`/`canPersistTrigger`, so the cycle is real, safe, and documented.
- `moduleNameMapper` in `jest.config.js` is scoped (`^.*/game-state/combat$`) — no collision with new `keyword-actions/*.ts`.
- **Jest 30: `--testPathPatterns` (plural).** `--testPathPattern` is removed.
- PR/issue bodies via `/tmp/opencode/*.md` + `--body-file`. The `write` tool's output **was** shell-visible this session, but always verify with `[ -f ... ]` before filing. `gh` needs `-R anchapin/planar-nexus` when run outside the repo.
- **New test helpers must NOT backfill `oracle_text` from the keyword list.** `createMockCreature` in `keyword-enforcement.test.ts:101` _does_ backfill — do not copy it for FP/FN cases.
- **When a new test fails, first ask whether the _expectation_ was ever true.** Plan I: I asserted `"Artifact — Creature"` should not get persist; it failed because an Artifact Creature _is_ a creature (rules-correct). Fixed the expectation, pinned real behavior.
- commitlint lower-case header, min 10 chars, types: `feat fix docs style refactor test chore revert`; footer needs a leading blank line. `git commit -F -` heredoc works and husky runs normally.
- Pre-existing flake on `use-deck-coach-chat.test.ts` re-runs once and continues.
- **Epic sub-issues DO auto-close on merge** (#2346→#2347 did).
- **Do NOT `git add -A`.** Stage explicitly (7 paths for Plan K), or `git reset .foreman .handoff-archive .handoff.md`.

### Standing caution

The Plan J handoff described another process sharing this tree. **It did not appear at all during Plan K or the untracked-findings pass** — every file was byte-for-byte mine and `git log` matched after every `git add`. Keep the precaution (re-`stat`/`git status` around writes, verify `git log` after `git add`, write the handoff last) but treat the hazard as unconfirmed rather than active.

## 5. Epic State

- Epic **#2300** — "243 of 257 detected keywords unenforced", heavily stale.
- Merged siblings (16 closed): #2312 (flash), #2314, #2316 (ward), #2318 (combat cleanup), #2322 (hexproof/protection), #2325 (flying/reach/menace), #2327 (trample/first-strike/double-strike), #2329 (vigilance), #2331 (deathtouch), #2333 (lifelink), #2335 (haste), #2337 (shroud), #2339 (persist), #2345 (prowess), #2347 (mutate).
- **The keyword-arm sweep is now fully enumerated.** After `infect`, the remaining epic work is #2348/#2349 (semantic + type-line, not keyword arms) and #2350 (indestructible).
- Narratives: `.handoff-archive/2026-09-28-plan-j-prowess-done.md`, `.handoff-archive/2026-09-28-plan-k-mutate-done.md` (prior handoff), and this file.
