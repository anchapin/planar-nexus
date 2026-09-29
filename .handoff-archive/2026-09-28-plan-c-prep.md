# Plan C Prep Notes — Trample / First-Strike / Double-Strike

Captured during the 2026-09-28 session that resumed from `.handoff.md` while
PR #2325 (flying/reach/menace, `4b91ef2b` line) was still rolling.

## Goal (Plan C)

Implement strict-keyword enforcement for the **highest-risk remaining work in
Epic #2300**: trample / first-strike / double-strike (CR 702.3 / 702.4 / 702.7).

This is the largest correctness gap left in the rules engine because it
intersects **damage assignment math** in `combat/resolution.ts`, which is the
only path in the engine that computes per-blocker damage on a multi-blocker
attacker. Trample excess-damage overflow, first-strike ordering, and the
deathtouch interaction with trample are all already partially wired
substring-oracle-text fallbacks identical in shape to the ones Plan B fixed
for flying/reach/menace. The same strict-keyword-actions pattern applies.

## Why this is the right next ticket

- **#2290 / #2294 / #2297 are closed-but-unrelated** (CI red on main, a
  Playwright flake, dead `game-board-client.tsx`) — same trap as Plan B's
  #2324 discovery. Don't trust the epic sub-issue numbers as fresh tickets.
- Epic #2300's body lists #2290–#2297 as the evergreen sub-issue queue, but
  the queue itself is stale; the real fresh tracking issue will need to be
  filed.
- **No fresh `trample` / `first-strike` / `double-strike` GH issue exists.**
  `gh issue list --search "trample" --state open` returns only #2300 itself.
  Confirms a new sub-issue is required.

## Survey results — what currently reads `hasFirstStrike / hasDoubleStrike / hasTrample`

All three keywords still use the substring-oracle-text fallback pattern —
identical anti-pattern to the flying/reach/menace bug fixed in Plan B.

### `src/lib/game-state/combat/declaration.ts`

- **Lines 100-105** — `hasFirstStrike` for attackers:
  ```ts
  attackerCard.cardData.keywords?.includes("First Strike") ||
    attackerCard.cardData.oracle_text?.toLowerCase().includes("first strike");
  ```
- **Lines 106-111** — `hasDoubleStrike` for attackers (same shape).
- **Lines 254-258** — `blockerHasFirstStrike` / `blockerHasDoubleStrike`
  for blockers (same shape).
- The downstream Attacker shape stores `hasFirstStrike: boolean` /
  `hasDoubleStrike: boolean` so wiring is straightforward once the strict
  helpers exist.
- `hasVigilance` at line 138-140 is the **same anti-pattern**: should be
  deferred to a strict `hasVigilanceStrict` helper in the same PR (or a
  follow-up) for consistency.

### `src/lib/game-state/combat/resolution.ts`

- **Lines 73 / 78** — gating which attackers deal damage per step,
  read off the Attacker shape (`attacker.hasFirstStrike || attacker.hasDoubleStrike`).
- **Lines 88-90** — `attackerHasTrample` computed inline with substring:
  ```ts
  attackerCard.cardData.keywords?.includes("Trample") ||
    attackerCard.cardData.oracle_text?.toLowerCase().includes("trample");
  ```
- **Line 369** — only path that actually applies trample excess damage:
  ```ts
  if (remainingDamage > 0 && attackerHasTrample) {
    /* overflow to defender */
  }
  ```
- **Lines 456-478** — blocker first-strike / double-strike detection
  (substring again, on `blocker.cardData`).

## Pattern to follow (already established)

Each keyword gets:

1. `src/lib/game-state/keyword-actions/{keyword}.ts` — exports
   `has{Keyword}Strict(card)` returning boolean by consulting ONLY the
   parsed `keywords` array (case-insensitive, whitespace-trimmed, word-bound).
2. `src/lib/game-state/evergreen-keywords.ts` — defer to strict first, fall
   back to `hasKeyword` substring for backward compat.
3. New test files:
   - `src/lib/game-state/__tests__/keyword-{keyword}.test.ts` — strict
     contract + flavor-word false-positive regressions.
   - End-to-end combat tests in `combat-{keyword}.test.ts` for any
     behavioral impact (trample is the highest-risk for math correctness).
4. Resolve any consumer (declaration.ts / resolution.ts) that uses the
   inline substring fallback to consume the new strict helper.

## Per-step CR references

- **CR 702.7** — first strike.
- **CR 702.4** — double strike.
- **CR 702.3** — trample.
- **CR 702.2b–d** — deathtouch interaction with trample
  (deathtouch turns any nonzero damage from a blocker into lethal, so
  trample excess math flips from "leftover ≥ blockerToughness" to
  "leftover > 0"). Already partially implemented; needs unit test for
  the deathtouch-trample interaction since `assignCombatDamage` is
  inline-substring today.

## Estimated test count delta

Based on the Plan B pattern (43 tests for 3 keywords):

- Flying = 15, Reach = 15, Menace = 13 → 43 tests / +4 suites
- Estimate here: ~45–55 tests for trample / first-strike / double-strike
  including deathtouch-interaction tests and end-to-end combat math
  coverage. Maybe one or two follow-up suites for vigilance if it's
  folded in.

## Conventions to preserve (lifted from handoff.md §4)

- `keyword-actions/` directory (not `keyword-effects/`).
- Strict variants named `hasXStrict`; `evergreen-keywords.hasX` defers to
  strict first, then falls back to word-bounded `hasKeyword` substring.
- `moduleNameMapper` regex in `jest.config.js` is scoped
  (`"^.*/game-state/combat$"`) — does NOT collide with `types/combat.ts`.
- PR body written to file + `--body-file` (not `--body`).
- Per-blocker vs declaration-time enforcement distinction matters for
  trample too — trample is a **damage assignment** concern, NOT a
  declaration-time concern, so the wiring lives in `resolution.ts`
  lines around 369 not `declaration.ts`.
- Pre-existing flake on `use-deck-coach-chat.test.ts` re-runs once and
  continues.
- Transient `npm install` EPROTO/SSL errors: re-trigger via empty
  `chore(ci):` commit.
- Never poll CI. Use the AGENTS.md one-shot `gh pr view <n> --json` and
  walk away.

## Pre-work actions completed in this resume session

While #2325 rolls, I completed two non-blocking cleanups that don't
disturb the open PR:

1. **Closed #2317** — `chore: delete legacy combat.ts after verifying
combat/ directory split is complete`. Filed as the follow-up for
   #2137, the work was completed by PR #2318 (`4b91ef2b`) but the PR
   body referenced `Closes #2137` rather than `Closes #2317`, so the
   issue stayed open even though everything in its acceptance criteria
   is done. Verified locally:
   - `src/lib/game-state/combat.ts` does not exist
   - `jest.config.js` line 48 has the
     `"^.*/game-state/combat$": "<rootDir>/src/lib/game-state/combat/index.ts"`
     mapper
   - All combat tests still pass against the directory
     Closing comment cites PR #2318 + commit `4b91ef2b` and lists the
     acceptance criteria that have all been met.

## Trigger for filing the fresh Plan-C issue

File the fresh `trample / first-strike / double-strike` enforcement
sub-issue immediately after PR #2325 merges to main. Use next available
GH number (likely ~#2326). Branch `fix/issue-<n>-trample-first-strike-double-strike`,
implement three strict keyword-actions modules, wire them into
`combat/declaration.ts` and `combat/resolution.ts`, add tests, file PR.

Mirror the Plan B / Plan A pattern exactly:

- Conventional Commits header (lowercase, ≥10 chars).
- PR body written to file + `--body-file`.
- `--auto --squash --delete-branch` on PR creation.
- Update `docs/TEST_VIDEO_FIXTURES.md` test-count ratchet before merge.
