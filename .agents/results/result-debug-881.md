# Debug Result: Event Replay Test Failure (#881)

## Status: FIXED

## Summary

Fixed the failing tests at `src/lib/game-state/__tests__/event-replay.test.ts` lines 189 and 550 where `resultingStateHash` equaled `previousHash` after `emitAction`. The root cause was that the tests called `emitAction` directly WITHOUT actually mutating state first.

## Root Cause

- `emitAction` computes `resultingStateHash` from `this.state` at emission time
- Tests called `emitAction` directly without mutating the game state
- Since no mutation occurred, `previousHash === resultingHash` (state unchanged)

## Fix Applied

### Test Changes (src/lib/game-state/**tests**/event-replay.test.ts)

**Line 168-194: "should emit action events with correct previous and resulting state hashes"**

- Changed from `esState.emitAction(action, previousHash)`
- To `esState.performVerifiedStateTransition(action, mutationFn)` with inline mutation
- Mutation directly updates player life by +5 to avoid replacement effect complexity

**Line 530-566: "should perform rollback to previous state"**

- Changed from `esState.emitAction(action, esState.getStateHash())` and separate state check
- To `esState.performVerifiedStateTransition(action, mutationFn)` with inline mutation
- Now actually mutates state before hash computation

**Removed:** Unused `gainLife` import since tests use direct state mutation

## Files Changed

- `src/lib/game-state/__tests__/event-replay.test.ts` - Fixed test mutations

## Verification

```
PASS (16) FAIL (0)
```

All 16 tests in event-replay.test.ts now pass.

## Key Insight

The `performVerifiedStateTransition` method is the correct API for state mutations because it:

1. Computes hash BEFORE mutation (previousHash)
2. Applies mutation to get new state
3. Computes hash AFTER mutation (resultingHash)
4. Then updates internal state and emits event with correct hashes

Direct `emitAction` calls should only be used when you have ALREADY mutated state externally and just need to record the event.
