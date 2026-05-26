# Research: Event Sourcing Single Source of Truth (#866)

## Executive Summary

**Status**: Architectural problem requiring refactor

**Severity**: Medium-High — breaks undo/rollback, replay, and multiplayer sync

**Verdict**: NOT a quick fix. Requires architectural changes to make event log the authoritative source of truth.

---

## Current Architecture

### Files Analyzed

- `src/lib/game-state/event-sourcing.ts` — Core EventSourcingGameState class
- `src/lib/game-state/event-sourced-game-state.ts` — Wrapper functions with event emission
- `src/lib/game-state/state-hash.ts` — State hashing utilities
- `src/lib/game-state/game-state.ts` — Raw mutation functions
- `src/hooks/use-game-engine.ts` — React hook consuming game state

### Architecture Diagram (Current)

```
use-game-engine.ts
├── Imports directly from game-state.ts (NO event emission):
│   ├── gainLife()
│   ├── dealDamageToPlayer()
│   ├── engineDrawCard()
│   └── ... other mutations
│
└── State mutations happen directly:
    gainLife(engineState, playerId, amount)
         ↓
    engineStateRef.current = newState  ← No event logged!
         ↓
    setEngineState(newState)
```

### Event-Sourcing Infrastructure (Exists But Unused)

`event-sourced-game-state.ts` provides wrapper functions:

- `drawCard(esState, playerId)` — wraps with event emission
- `dealDamageToPlayer(esState, ...)` — wraps with event emission
- `gainLife(esState, ...)` — wraps with event emission

BUT `use-game-engine.ts` does NOT use these wrappers.

---

## Mutation Points Identified

### 1. Primary: `use-game-engine.ts` Direct Mutations

**Lines 43, 612-619:**

```typescript
import { dealDamageToPlayer, gainLife } from "@/lib/game-state/game-state"; // Line 43

// In healPlayerAction (lines 608-622):
const newState = gainLife(
  engineStateRef.current, // Direct state
  playerId,
  amount,
  sourceId,
);
setEngineState(newState); // No event emitted!
```

**Same pattern for:**

- `dealDamageToPlayer` (line 43, damage application elsewhere)
- `engineDrawCard` (line 20)
- `engineConcede`, `engineOfferDraw`, `engineAcceptDraw` (lines 23-26)
- `enginePlayLand`, `engineCastSpell` (lines 30, 34)

### 2. Secondary: `withEventEmission` Ordering Issue

**Location**: `event-sourcing.ts` lines 840-858

```typescript
export function withEventEmission<T extends GameState>(
  esState: EventSourcingGameState,
  mutationFn: (state: GameState) => T,
  action: GameAction,
): { result: T; context: StateMutationContext } {
  const previousState = esState.getState();
  const previousStateHash = computeStateHash(previousState);

  // WRONG ORDER: Apply mutation FIRST
  const result = mutationFn(previousState);

  // Then update internal state
  esState.applyState(result);

  // Then emit event (AFTER mutation)
  const event = esState.emitAction(action, previousStateHash);

  return { result, context: { previousState, previousStateHash, event } };
}
```

**Problem**: This is backwards. True event sourcing emits the event BEFORE applying the mutation. The current order means:

- If `emitAction` fails, state is already mutated
- Remote clients receive event with already-mutated state

### 3. Tertiary: `mutationApplier` Not Registered

**Location**: `event-sourcing.ts` lines 638-660

```typescript
private applyActionToState(state: GameState, actionEvent: ActionEvent): GameState {
  if (this.mutationApplier) {
    return this.mutationApplier(state, actionEvent.action);
  }
  // Fallback: return state as-is if no applier is registered
  return state;  // ← REPLAY FAILS SILENTLY
}
```

The `mutationApplier` callback must be registered by the game engine, but:

- If not set, replay returns state unchanged
- No error is thrown
- No warning is logged

---

## Trace: `gain_life` Through Current Code

### Happy Path (If Event-Sourced Were Used)

```
1. Client calls healPlayerAction(playerId, 3)
        ↓
2. gainLife(esState, playerId, 3) from event-sourced-game-state.ts
        ↓
3. withEventEmission wraps:
   - Captures previousState
   - Calls originalGainLife(state, playerId, 3)
   - Returns new state
   - Updates esState.applyState(newState)
   - esState.emitAction(gain_life, previousHash)
        ↓
4. Event { type: "gain_life", amount: 3 } added to log
        ↓
5. setEngineState(result) updates UI
```

### Actual Path (Current)

```
1. Client calls healPlayerAction(playerId, 3)
        ↓
2. gainLife(engineStateRef.current, playerId, 3) from game-state.ts
        ↓
3. originalGainLife returns new state
        ↓
4. NO EVENT EMITTED
        ↓
5. setEngineState(newState)
        ↓
6. Event log does NOT record this change
        ↓
7. Undo/rollback/replay cannot recover this action
```

---

## Impact Analysis

| Feature            | Current Status | Broken Because                    |
| ------------------ | -------------- | --------------------------------- |
| Undo/rollback      | Non-functional | No event recorded for mutations   |
| Replay system      | Partial        | State changes not in event log    |
| Multiplayer sync   | Non-functional | Remote peers can't receive events |
| State verification | Unreliable     | No hash chain integrity           |
| Late-join recovery | Broken         | Event log incomplete              |

---

## Recommendations

### Option A: Minimum Viable Fix (Effort: Medium, Risk: Low)

**Goal**: Make event log record all state changes without full architectural refactor

**Changes Required**:

1. **Wire `event-sourced-game-state.ts` into `use-game-engine.ts`**
   - Replace direct imports from `game-state.ts` with event-sourced wrappers
   - Requires passing `EventSourcingGameState` instance throughout

2. **Fix `mutationApplier` registration**
   - Register applier function that maps actions → state mutations
   - Enables proper event replay

3. **Fix event emission ordering** in `withEventEmission`:
   ```typescript
   // Correct order:
   const previousState = esState.getState();
   const event = esState.emitAction(action, computeStateHash(previousState)); // FIRST
   const result = mutationFn(previousState); // THEN apply
   esState.applyState(result);
   ```

**Estimated Effort**: 2-3 days
**Risk**: Low — existing event infrastructure is sound

### Option B: Full Event Sourcing Refactor (Effort: Large, Risk: Medium)

**Goal**: Make event log the TRUE single source of truth

**Changes Required**:

1. **Move to Command Sourcing Pattern**
   - All state changes go through `performVerifiedStateTransition()`
   - No direct `esState.applyState()` calls externally
   - Events are IMMUTABLE records

2. **Decouple React state from engine state**
   - Engine maintains event log
   - React state is derived by replaying events
   - UI never mutates state directly

3. **Add event ordering guarantees**
   - Sequence numbers on events
   - Causal ordering for multiplayer

4. **Implement proper rollback**
   - Use `performRollback(targetIndex)`
   - Replay events forward to recover

**Estimated Effort**: 1-2 weeks
**Risk**: Medium — requires careful migration

---

## Conclusion

**Is this a quick fix? NO**

The problem is architectural. The event-sourcing infrastructure exists (`EventSourcingGameState`, `event-sourced-game-state.ts` wrappers) but:

1. The primary consumer (`use-game-engine.ts`) bypasses it entirely
2. The `mutationApplier` isn't wired up
3. Event emission happens after mutation (wrong order)

**Recommended Path**: Option A (Minimum Viable Fix) first to make the event log record changes, then Option B as a later phase if multiplayer sync is a priority.

**Priority**: This blocks:

- Undo/rollback (Issue #761 mentioned)
- Multiplayer synchronization
- Reliable replay system

**Files to Modify for Option A**:

- `src/hooks/use-game-engine.ts` — Wire event-sourced wrappers
- `src/lib/game-state/event-sourcing.ts` — Fix event emission ordering
- `src/lib/game-state/event-sourced-game-state.ts` — May need additional wrappers
