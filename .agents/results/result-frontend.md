# Result — Frontend: Issue #1818 (memoize HandDisplay render boundary)

**Status:** ✅ Complete
**Commit:** `9c8a1d67` — `fix: resolve #1818 — memoize handdisplay render boundary` (single commit, working tree clean)
**Worktree:** `/home/alex/Projects/worktrees/issue-1818-memoize-hand-display` (branch `fix/issue-1818-memoize-hand-display`, base `origin/main` @ `52cc9f80`)

## Summary

`HandDisplay` was an unmemoized 467-line component whose per-card children were inline closures — every engine state update (and every inbound P2P game-sync envelope) re-rendered the whole hand fan and its sort/layout logic. Following `game-board.tsx` conventions (`memo()` + `useCallback`/ref discipline, `BattlefieldCard` extraction precedent from `virtualized-zone-strip.tsx`):

1. **Extracted per-card children** into new module `src/components/hand-card.tsx`:
   - `HandCard` (was internal `CardDisplay`) — `memo()`-wrapped; `onClick: () => void` replaced by stable `onCardClick: (cardId: string) => void` so no per-card closures are created; `useCallback`'d click + keydown handlers.
   - `OpponentHandCard` (was inline button + `CardBack` in the map) — `memo()`-wrapped, primitive `cardId` + stable `onCardClick` props.
2. **`HandDisplay` wrapped in `memo()`** (`export const HandDisplay = memo(function HandDisplay(…))`):
   - `handleCardClick` / `handleClearSelection` are `useCallback`'d; a `selectionRef` latest-value mirror (written only in handlers/effects, never during render) keeps `handleCardClick`'s identity stable across selection toggles.
   - External-selection sync effect now returns the previous Set from the state updater when content is unchanged — kills a guaranteed second full-hand render on mount (fresh `new Set` reference). Pure render-path change; visual behavior identical.
3. **Stabilized call-site props** (memo is useless with recreated props):
   - `game-board.tsx` `PlayerArea`: inline `onCardClick={(cardId) => …}` → `useCallback`'d `handleHandCardClick`.
   - `mobile-game-layout.tsx` `MobilePlayerArea`: same fix.
   - `hand-display-demo.tsx`: handlers wrapped in `React.useCallback`.

## Files changed (6)

| File                                                          | Change                                                                                             |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/components/hand-card.tsx`                                | NEW — memoized `HandCard` + `OpponentHandCard` (+ private `CardBack`)                              |
| `src/components/hand-display.tsx`                             | `memo()` wrap, stable callbacks + selection ref, bail-out selection sync, children via `hand-card` |
| `src/components/game-board.tsx`                               | `PlayerArea`: `handleHandCardClick` `useCallback` for the HandDisplay call site                    |
| `src/components/mobile-game-layout.tsx`                       | `MobilePlayerArea`: same stable-callback fix                                                       |
| `src/components/hand-display-demo.tsx`                        | demo handlers → `useCallback` (direct HandDisplay props)                                           |
| `src/components/__tests__/hand-display-render-count.test.tsx` | NEW — render-count regression tests (see below)                                                    |

## Acceptance criteria checklist

- [x] `HandDisplay` wrapped in `memo` with stable callbacks
- [x] Per-card children extracted into memoized components (`hand-card.tsx`)
- [x] Props into `HandDisplay` / children referentially stable at all call sites (game-board, mobile layout, demo)
- [x] Render-count test asserts hand card components do not re-render when a state change only affects other zones (opponent battlefield update) — **negative-controlled**: temporarily removing `memo()` makes the acceptance test fail, restoring makes it pass
- [x] Visual behavior identical (pure render-boundary change; existing behavior tests in `hand-display.test.tsx` untouched and green)

## Key test

`HandDisplay under GameBoard — other-zone deltas skip the hand (#1818) > does not re-render hand cards when a state change only affects the opponent's battlefield`
(`src/components/__tests__/hand-display-render-count.test.tsx`)

- Mocks `@/components/hand-card` with **deliberately unmemoized** render-counting stubs (so counts track every render the real parent would produce — a memoized stub would mask a broken boundary), renders the **real** `GameBoard → PlayerArea → HandDisplay` chain, then re-renders with a fresh `players` array whose only delta is the opponent's battlefield (local player keeps every reference) — the shape of a P2P game-sync envelope for an opponent's action. Asserts hand-card render count stays at 3.
- Companions: direct memo-boundary tests (identical-ref rerenders don't re-render cards, either face-up or card-back path), over-memoization guards (drawing a card re-renders the list and shows the new card), and structural `$$typeof === Symbol.for("react.memo")` assertions for the real `HandDisplay`/`HandCard`/`OpponentHandCard` exports.

## Verification results

| Check            | Command                                 | Result                                                                                                                                             |
| ---------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck        | `npm run typecheck`                     | ✅ pass (clean)                                                                                                                                    |
| Lint             | `npm run lint`                          | ✅ 0 errors (607 pre-existing warnings; only errors gate, max-warnings 1000)                                                                       |
| Tests            | `npm test -- --testPathPatterns "hand"` | ✅ 516 suites / 10804 tests passed, 11 skipped, 0 failed (includes hand-display, hand-display-render-count, game-board, mobile-game-layout suites) |
| No `--forceExit` | tests exit normally                     | ✅                                                                                                                                                 |
| Commit           | `git status --porcelain` after commit   | ✅ EMPTY                                                                                                                                           |

Note: Jest 30 in this repo replaced `--testPathPattern` with `--testPathPatterns`; the requested `npm test -- --testPathPattern "hand"` errors out with a deprecation exit — used the supported flag.

## Deviations / out-of-scope notes

- `hand-display-demo.tsx` handler stabilization was included (direct HandDisplay props at a call site — in-scope per guidance "fix call sites if needed").
- The selection-sync effect's bail-out (return prev Set when content unchanged) is a small behavior-adjacent improvement required to avoid a redundant mount re-render of the whole hand; content semantics unchanged.
- Pre-existing `ZoneDisplayLocal`/`ZoneButton` inner-component patterns in `game-board.tsx`/`mobile-game-layout.tsx` (new component types per render) were **not** touched — battlefield path, out of scope for #1818.
- No e2e/a11y-contrast runs required by the task; unit/type/lint gates all green. Coverage floors unaffected (tests added, none removed).
