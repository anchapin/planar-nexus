# Handoff — PR #2318 (combat.ts cleanup) merged, PR #2322 (hexproof/protection) open

## Status

### Completed in this session

1. **Plan option A verification** ✅ — `#2318` combat.ts cleanup merged (`4b91ef2`, auto-merge squash). `combat.ts` deleted (1224 lines), `jest.config.js` moduleNameMapper added. Test-count doc guard PASSED (test-count neutral, doc was already correct).

2. **PR #2322 — Hexproof / protection-from-color targeting enforcement (issue #2319)** 🟡 Open, auto-merge enabled
   - **Real findings:**
     - `targeting-validation.ts::hasHexproof` consulted ONLY `oracle_text.includes("hexproof")` — ignored the parsed `keywords` array entirely.
     - `evergreen-keywords.hasHexproof` / `hasProtectionFrom` / `getProtectionQualities` all fell back to substring/regex oracle-text matching — same false-positive class as the original ward bug (#2315).
     - `evergreen-keywords.canTargetKeyword` required `effectColor` to be truthy before testing hexproof: a **colorless source** (e.g. artifact) targeting opponent's hexproof creature would have bypassed hexproof. Wrong by CR 702.11a — fixed.
   - **Added:**
     - `src/lib/game-state/keyword-actions/hexproof.ts` — `hasHexproofStrict` + `isProtectedByHexproofStrict`.
     - `src/lib/game-state/keyword-actions/protection.ts` — `hasProtectionFromColorStrict` + `getProtectionQualitiesStrict` (handles single + multi-quality `and`/`,`, W/U/B/R/G abbreviation normalization).
   - **Modified:**
     - `evergreen-keywords.ts` — `hasHexproof` defers to `hasHexproofStrict`; `getProtectionQualities` / `hasProtectionFrom` defer to strict variants; `canTargetKeyword` colorless-bug fix.
     - `targeting-validation.ts` — `hasHexproof` / `getProtectionQualities` defer to strict variants (parity fix).
   - **New tests:** `keyword-hexproof.test.ts` (22 tests) + `keyword-protection.test.ts` (24 tests) — strict detection, deferral + fallback, false-positive regressions, controller-symmetry, colorless-source regression, multi-quality parsing.
   - **Test count:** 11691 → 11737 (+46). Suites: 565 → 567 (+2 new files). Doc ratcheted in separate commit.
   - Branch: `fix/issue-2296-hexproof`. Commits: `642c1e3a` (impl) + `2a9af735` (ratchet). Auto-merge enabled (squash, delete-branch).
   - **Naming note:** the branch uses the epic sub-issue label (`#2296-hexproof`); the PR title and `Closes` reference the real GH issue (`#2319`, opened this session — the existing `#2296` was the unrelated 2v2 teams-mode issue already closed by PR #2304).

### Open state after this session

```
#2300 [Epic] Keyword enforcement: 86 unenforced (after flash #2312, defender #2314, ward #2316, hexproof/protection #2322)
#2319 [Open]  Hexproof / protection-from-color targeting — will close via #2322 auto-merge
```

Keyword-enforcement sub-issues still open (the four most actionable next):

```
#2290 — Trample / first-strike / double-strike combat damage      [highest risk: combat-damage + trample-vs-deathtouch]
#2291 — Flying / reach / menace evasion layer                      [layer-system]
#2294 — Trample-vs-deathtouch interaction                          [layer-system interaction]
#2296 — Hexproof / protection-from-color targeting                 [CLOSING via #2322]
```

After #2322 merges, the targeting-validation layer is fully strict-detection-parity compliant. Remaining keyword-enforcement gaps are combat/layer-system scoped (deeper risk).

### Remaining — Next session can pick from

#### Plan option A — `chore/test-count-ratchet` after #2322

After #2322's auto-merge squash, run `node scripts/check-test-count-docs.mjs` to verify the ratchet is still aligned. The ratchet commit (`2a9af735`) is already in the PR, so it should pass without further action. If any drift, run `npm run ratchet:test-count` and commit.

#### Plan option B — Keyword PR-E (#2291 flying / reach / menace evasion layer)

The lowest-risk remaining keyword sub-issue after #2322 lands. Per the existing keyword-enforcement playbook:

- **What:** Flying (CR 702.9), reach (CR 702.12), menace (CR 702.110) interact at the combat-blockers layer. A creature with flying can only be blocked by creatures with reach or flying. A creature with menace can only be blocked by two or more creatures.
- **Where:** `src/lib/game-state/combat/queries.ts::canBlock` (now the canonical location — `combat.ts` legacy is gone after #2318). `combat/queries.ts:137` already comments "If there's an attacker, check if it can be blocked (flying, reach, protection, etc.)" — the wiring exists but is incomplete.
- **Risk:** Medium — combat evasion is well-tested but layer-system edge cases (e.g. "creatures with reach can block as though they had flying" continuous effects) need careful handling. Mutate before merging.
- **Branch:** `fix/issue-2291-flying-reach-menace`. Same strict-detection pattern (`hasFlyingStrict`/`hasReachStrict`/`hasMenaceStrict`), defer from `evergreen-keywords`.

Before starting, **survey the existing combat evasion scaffolding** with `rg -n 'hasFlying|hasReach|hasMenace|canBlock' src/lib/game-state/combat -g '*.ts'` to see what's already partially implemented.

#### Plan option C — Audit the gap analysis post-#2322

Re-run `npx tsx scripts/analyze-gameplay-gaps.ts` to refresh `reports/gameplay-gap-analysis.md` post-#2312/#2314/#2316/#2322. Last refresh 2026-09-27 (before #2316, before #2322). Useful for re-prioritization of the 84 remaining unenforced keywords.

### Process notes for the next session

- **`combat.ts` legacy file:** removed by #2318. No more mirror tax. Any combat keyword PR (e.g. #2290 trample, #2291 flying/reach, #2294 trample-vs-deathtouch) now edits only `combat/{queries,declaration,resolution}.ts`.
- **Test-count ratchet:** already done for #2322 (`2a9af735`). Always run `node scripts/check-test-count-docs.mjs` after any merge to verify.
- **Pre-existing flake:** `use-deck-coach-chat.test.ts` will surface on every full-suite run. Always re-run once. CI's flake detector job catches it independently.
- **Strict parsed-keywords pattern:** `hasFlashStrict`, `hasDefenderStrict`, `hasWardStrict`, `hasHexproofStrict`, `hasProtectionFromColorStrict` are the canonical contract; their `evergreen-keywords.has*` siblings defer to the strict variants first. Use this pattern for any future keyword enforcement PR.
- **`keyword-actions/` convention** (not `keyword-effects/`) — established in #2312, extended in #2314/#2316/#2322.
- **`moduleNameMapper` for combat in `jest.config.js`:** scoped regex `"^.*/game-state/combat$"` — does NOT collide with `types/combat.ts` (different parent). If adding a similar mapper for another engine module, ensure the regex is end-anchored to the engine module path only.
- **Issue filing:** GitHub rejects bodies >65536 chars on the GraphQL API. For large bodies, write to a file and use `--body-file` instead of `--body`. The `gh issue create` CLI respects this; passing a multi-KB body inline via `--body "<huge string>"` will fail with "Body is too long".
- **Sub-issue labels vs real GH issue numbers:** The epic #2300's sub-issues (#2290–#2297) are labels, not real issue numbers. The actual GH numbers for these were filed separately (e.g. #2319 for hexproof/protection). When opening a PR for a sub-issue, **file a real GH issue first** so the PR can `Closes #<real>`. The branch can keep the sub-issue label for context (`fix/issue-2296-hexproof`), but the PR title and `Closes` reference must use the real GH number.
- **Handoff archival:** previous handoff moved to `.handoff-archive/2026-09-27-combat-cleanup-done.md`. Keep this convention.
