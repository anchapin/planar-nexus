# Result: Issue #866 Event Sourcing Implementation

## Status: COMPLETED

## Summary

Fixed the critical issue where `mutationApplier` was never set in `EventSourcingGameState`, which caused `getStateAtIndex()` and `verifyEventLogIntegrity()` to return unchanged state during event replay.

## Files Changed

1. **`src/lib/game-state/event-sourced-game-state.ts`** (+182 lines)
   - Added combat function imports (`declareAttackers`, `declareBlockers`)
   - Created `mutationFunctions` map with all original mutation functions
   - Set `mutationApplier` in `createEventSourcedState()` to enable proper event replay
   - Implemented `applyActionToState()` to handle all action types for state reconstruction
   - Added `declareAttackers()` and `declareBlockers()` wrappers with event emission

2. **`src/lib/game-state/__tests__/event-replay.test.ts`** (+186 lines)
   - Added `createMockCard()` helper function
   - Added `mutationApplier integration` test suite with 3 tests:
     - `declare_attackers` action replay correctness
     - `declare_blockers` action replay correctness
     - Multiple sequential actions replay correctness

## Acceptance Criteria Checklist

- [x] **mutationApplier is set when EventSourcingGameState is initialized**
  - `createEventSourcedState()` now calls `esState.setMutationApplier()` with the `applyActionToState` function

- [x] **Combat declarations emit events**
  - `declareAttackers()` and `declareBlockers()` wrapped with `withEventEmission()`
  - Actions have proper `type: "declare_attackers"` and `type: "declare_blockers"`

- [x] **State can be reconstructed by replaying event log**
  - `applyActionToState()` handles all action types including combat declarations
  - `getStateAtIndex()` can now properly reconstruct state by replaying events through the mutation applier

- [x] **Tests verify event replay correctness**
  - Tests verify that `getStateAtIndex()` returns correct state after attacker/blocker declarations
  - Tests confirm combat state (`attackers`, `blockers`) is correctly reconstructed

## Key Implementation Details

### Mutation Applier Registration

```typescript
export function createEventSourcedState(
  initialState: GameState,
  sessionId: string,
  localPlayerId: PlayerId,
): EventSourcingGameState {
  const esState = new EventSourcingGameState(
    initialState,
    sessionId,
    localPlayerId,
  );

  // Register the mutation applier for event replay
  esState.setMutationApplier((state, action) => {
    return applyActionToState(state, action, mutationFunctions);
  });

  return esState;
}
```

### Combat Event Emission

The `declareAttackers` and `declareBlockers` functions now:

1. Create a `GameAction` with proper data structure
2. Call original combat functions via `withEventEmission()`
3. Return `{ state, context }` to maintain event emission flow

### Action Data Format

For `declare_attackers`:

```typescript
data: {
  attackers: Array<{
    cardId: CardInstanceId;
    defenderId: PlayerId | CardInstanceId;
  }>;
}
```

For `declare_blockers`:

```typescript
data: {
  blockers: Array<{ cardId: CardInstanceId; attackerId: CardInstanceId }>;
}
```

## Commit

```
5d1bd69 feat(event-sourcing): set mutationApplier and wire combat to event emission
```

## Next Steps (for other agents)

The following areas still need event emission wrappers (not in scope for this PR):

- `state-based-actions.ts` - SBA execution
- `spell-casting.ts` - `castSpell()`, `resolveStackAction()`
- `trigger-system.ts` - triggered ability resolution
- `mana.ts` - mana production/tapping
- `turn-phases.ts` - phase transitions
