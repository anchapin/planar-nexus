# Handoff — PR-B (defender) merged; PR-C (ward) is next

## Status

### Completed in this session

1. **PR #2314 — Defender keyword enforcement (issue #2293, defender portion)** ✅ Merged as `41aca2c3`
   - Real bug fixed: `canAttack` in `combat/{queries.ts,combat.ts}` checked creature-type/tapped/sickness but never consulted the defender keyword. A creature with the defender keyword could be declared as an attacker.
   - Wired a new strict parsed-keywords check (`hasDefenderStrict` in `src/lib/game-state/keyword-actions/defender.ts`) into both `canAttack` and `getAvailableAttackers`.
   - 15 new tests in `src/lib/game-state/__tests__/keyword-defender.test.ts`.
   - Test count: 11654 → 11669 (+15). Suites: 563 → 564.
   - Ratchet: `docs/TEST_VIDEO_FIXTURES.md` updated. CI gate green, auto-merged, branch deleted.

### Pre-existing issue surfaced

**`combat.ts` vs `combat/` directory split** (#2137 attempted a split). Both files exist side-by-side in `src/lib/game-state/`. Jest's `moduleFileExtensions: ["ts", ...]` resolution picks `combat.ts` (file) before `combat/` (directory) for any `from "../combat"` import — meaning the directory split has been **a complete no-op for consumers** since #2137. The legacy `combat.ts` (1230 lines) duplicates everything in `combat/{queries,declaration,resolution}.ts`.

I applied the defender fix to BOTH files to make the PR shippable. The proper cleanup (delete `combat.ts`, or add a jest moduleNameMapper to force directory resolution) is too big for a defender PR but should be a follow-up. Suggested issue: "Delete legacy `src/lib/game-state/combat.ts` after verifying no deep imports remain."

### Remaining — PR-C (Ward, CR 702.21) for the next session

Per the original plan in `/home/alex/.opencode/plan/land-2309-then-issue-2293.md`:

#### Plan

- **CR 702.21** — triggered cost when permanent becomes the target of a spell or ability.
- **New file:** `src/lib/game-state/keyword-actions/ward.ts` with:
  - `hasWardStrict(card)`: strict parsed-keywords check for "ward" (mirrors `hasDefenderStrict`).
  - `registerWardTrigger(card, gameState)`: registers a triggered ability that fires when the permanent becomes the target of a spell/ability; pay-cost gate the spell/ability resolution.
- **Wire into trigger-system:** register a new trigger type that fires on `becomesTarget`. The actual cost-payment UI is **engine-only** by default per the plan; UI plumbing is a separate ticket.
- **Also mirror to legacy `combat.ts`** if ward touches combat (it doesn't — ward is trigger-only, so this caveat doesn't apply).
- **New file:** `src/lib/game-state/__tests__/keyword-ward.test.ts`.
- **Edge cases to test:**
  - Ward N triggers, opponent pays → spell resolves
  - Ward N triggers, opponent can't pay → spell is countered
  - Ward triggers only on the _first_ time per turn (CR 702.21b)
  - Multiple ward sources → each triggers separately
  - Ward triggers only for opponent's spells (own spells don't trigger ward)
- **Branch:** `fix/issue-2293-ward`. Auto-merge once CI green.
- **Mutation gate:** `npm run mutate:trigger-system` (mutation-pr.yml runs it on PRs touching src/lib/game-state/; non-blocking, informational — don't wait for it).
- **After merge,** ratchet `docs/TEST_VIDEO_FIXTURES.md` via `npm run ratchet:test-count` in a separate commit on the same branch (precedent: #2313, this session's defender ratchet).
- **Verify CI gate locally before pushing:**
  ```
  npm run typecheck && npm run lint && npm test
  ```
  And:
  ```
  node scripts/check-test-count-docs.mjs
  ```

### Process notes for the next session

- **Test-count ratchet:** commit in a separate commit on the same branch, or auto-merge squash drops it. Precedent: this session's defender ratchet (`e32cb637`).
- **Auto-merge discipline:** always run `node scripts/check-test-count-docs.mjs` locally before pushing. See #2313 (flash) and #2314 (defender) precedents.
- **`combat.ts` legacy file:** the no-op split means **any** engine change that's supposed to ship should be mirrored in `combat.ts` if it's a combat concern. Ward is not — it's trigger-system — so this caveat doesn't apply for PR-C. But for the proposed `cleanup` follow-up, the right move is to delete `combat.ts` and let jest resolve `combat/` via the directory, OR add a moduleNameMapper like `"^.*/game-state/combat$": "<rootDir>/src/lib/game-state/combat/index.ts"`.
- **`keyword-actions/` convention** (not `keyword-effects/`) — established in #2312.
- **Strict parsed-keywords pattern:** `hasFlashStrict`, `hasDefenderStrict`, and forthcoming `hasWardStrict` all bypass the substring oracle-text fallback in `evergreen-keywords.hasKeyword`. Use the parsed `keywords` array.
- **CI flake known:** `use-deck-coach-chat.test.ts` is a pre-existing flake (see #2309 author comment). If it surfaces on a ward PR, just re-run.
- **`docs/TEST_VIDEO_FIXTURES.md` test count anchor** format: `<!-- TEST_COUNT:START --> ... <!-- TEST_COUNT:END -->`. The ratchet only rewrites this block.
- **`docs/onboarding.md` test-count block** is informational; the ratchet script does NOT touch it. The CI guard only checks `TEST_VIDEO_FIXTURES.md`. Leave `onboarding.md` alone unless you also want to update it manually.

### Open issue state

```
#2300 [Epic] Keyword enforcement: 243 of 257 detected keywords unenforced    ← still open (after flash + defender: 241 unenforced)
#2293 (PR-B closed via #2314)
```

The original `flash/defender/ward` tracker #2293 is now closed (per the handoff's "close per keyword as PRs land" option). Ward doesn't have its own issue, so the next session can either:

- Open a fresh issue (e.g., #2315) titled `fix(#2315): ward keyword enforcement via triggered cost (CR 702.21)` referencing the original #2293, OR
- Just file the PR with no closing reference (the parent epic #2300 still tracks the remaining gap).

I recommend the fresh-issue path for cleaner traceability.
