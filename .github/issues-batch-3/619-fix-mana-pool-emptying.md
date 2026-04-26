# Fix Mana Pool Emptying at End of Phase/Step

**Priority:** 🟠 HIGH  
**Labels:** `high`, `gameplay`, `engine`, `rules`, `mana`  
**Milestone:** v0.2.0 Game Rules  
**Estimated Effort:** < 1 day  

---

## Description

Per CR 500.4, mana pools empty at the end of each step and phase. Currently, mana only empties when `emptyAllManaPools` is explicitly called. This means floating mana from one phase carries into the next — a clear rules violation.

---

## Affected Files

- `src/lib/game-state/mana.ts` (`emptyAllManaPools`)
- `src/lib/game-state/game-state.ts` (`advanceToNextPhase`)
- `src/lib/game-state/__tests__/mana.test.ts`

---

## Current Behavior

```typescript
// advanceToNextPhase in game-state.ts
// Mana pool emptying is called, but verify it runs for ALL transitions
newState = emptyAllManaPools(newState);
```

The code exists but may not be reached for all phase transitions. Need to verify:
1. Does it run when advancing from Precombat Main → Begin Combat?
2. Does it run when a player passes priority within a phase?
3. Does it run at end of turn?

---

## Required Fix

### Step 1: Audit Current Emptying Points

Trace every code path where `emptyAllManaPools` is called. Document which phase transitions are covered.

### Step 2: Ensure Emptying on ALL Phase Advances

Add `emptyAllManaPools` call to any `advanceToNextPhase` path that misses it.

### Step 3: Add Unit Tests

```typescript
it("should empty mana pool when advancing to next phase", () => {
  let state = createGameStateWithMana({ red: 3 });
  state.turn.currentPhase = Phase.PRECOMBAT_MAIN;

  state = advanceToNextPhase(state); // → BEGIN_COMBAT

  const player = state.players.get(playerId);
  expect(player?.manaPool.red).toBe(0);
});

it("should empty mana pool at end of turn", () => {
  // Test cleanup phase → next turn
});
```

### Step 4: Add E2E Test

```typescript
test("mana does not float between phases", async () => {
  // Tap Mountain for {R}
  // Advance phase
  // Try to cast spell requiring {R}
  // Should fail (mana is gone)
});
```

---

## Acceptance Criteria

- [ ] Mana pool empties at end of every phase transition
- [ ] Mana pool empties at end of every step transition
- [ ] Unit tests verify emptying for all 12+ phase transitions
- [ ] E2E test verifies mana does not float
- [ ] No regressions in mana ability activation

---

## Rules Reference

- **CR 500.4:** When a step or phase ends, any unused mana in a player's mana pool empties.

---

## Related Issues

- #618 (Priority system — mana floating interacts with priority windows)
