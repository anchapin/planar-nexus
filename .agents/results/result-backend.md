# Result: Fix Issue #793 - APNAP Ordering Not Applied to Replacement Effects

## Status: COMPLETED

## Summary

Fixed APNAP (Active Player, Non-Active Player) ordering for replacement effects per CR 616. The `createAPNAPOrder` function was already implemented in `ReplacementEffectManager` but was never being called in `processEvent`. All calls to `processEvent` now pass the appropriate `APNAPOrder` based on the current active player.

## Files Changed

- `src/lib/game-state/game-state.ts` - Added APNAP ordering to `dealDamageToPlayer` and `gainLife`
- `src/lib/game-state/player-actions.ts` - Added APNAP ordering to `dealDamageToPlayer` and `gainLife`
- `src/lib/game-state/keyword-actions.ts` - Added APNAP ordering to `destroyCard`, `drawCards`, and `dealDamageToCard`
- `src/lib/game-state/__tests__/replacement-effects.test.ts` - Added 2 multiplayer tests

## Changes Made

### Integration of `createAPNAPOrder` into all `processEvent` calls:

1. **game-state.ts**:
   - `dealDamageToPlayer()` - damage replacement events
   - `gainLife()` - life gain replacement events

2. **player-actions.ts**:
   - `dealDamageToPlayer()` - damage replacement events
   - `gainLife()` - life gain replacement events

3. **keyword-actions.ts**:
   - `destroyCard()` - destroy replacement events (e.g., regeneration)
   - `drawCards()` - draw replacement events
   - `dealDamageToCard()` - damage to creatures

### New Tests Added:

- `should apply multiplayer APNAP ordering with 4 players` - Tests 4-player game with effects in P1→P2→P3→P4 order
- `should apply APNAP ordering with different active player` - Tests with P3 as active player (order: P3→P4→P1→P2)

## Acceptance Criteria

- [x] APNAP ordering should be applied when processing replacement events
- [x] Add test for multiplayer replacement effect ordering

## Test Results

All 3333 tests pass (3278 passed, 7 skipped, 48 todo)
