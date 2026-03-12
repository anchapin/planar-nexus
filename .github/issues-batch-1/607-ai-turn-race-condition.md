# Fix Race Condition in AI Turn Execution

**Priority:** 🔴 CRITICAL  
**Labels:** `critical`, `bug`, `ai`, `gameplay`  
**Milestone:** v0.2.0 Stability  
**Estimated Effort:** 1 day

---

## Description

AI turn execution in `useEffect` doesn't prevent multiple simultaneous executions when `gameState?.priorityPlayerId` changes rapidly. This can cause:
- Duplicate AI actions
- Inconsistent game state between peers
- Game-breaking bugs in multiplayer

---

## Affected Files

- `src/app/(app)/game/[id]/page.tsx` (lines 507-600)

---

## Current Problematic Code

```typescript
// src/app/(app)/game/[id]/page.tsx
useEffect(() => {
  if (gameState?.priorityPlayerId === aiPlayerId) {
    // ❌ No guard against concurrent execution!
    // If priorityPlayerId changes rapidly, this can fire multiple times
    executeAITurn();
  }
}, [gameState?.priorityPlayerId]);

async function executeAITurn() {
  // AI logic here...
  // If called twice simultaneously, both executions run
  // This can cause duplicate actions
}
```

---

## Reproduction Scenario

1. AI gains priority
2. `useEffect` triggers `executeAITurn()`
3. Before AI finishes, priority changes (e.g., user responds)
4. `useEffect` triggers again when AI regains priority
5. **Two AI executions run simultaneously**
6. AI makes two moves at once → game state corruption

---

## Required Changes

### Add Execution Guard

```typescript
// Add ref to track ongoing AI execution
const aiExecutionRef = useRef(false);

useEffect(() => {
  // ✅ Guard against concurrent execution
  if (gameState?.priorityPlayerId === aiPlayerId && !aiExecutionRef.current) {
    aiExecutionRef.current = true;
    
    executeAITurn()
      .finally(() => {
        aiExecutionRef.current = false;
      })
      .catch((error) => {
        console.error('AI turn failed:', error);
        aiExecutionRef.current = false;
        // Show error to user
        toast({
          title: 'AI Error',
          description: 'The AI encountered an error. Please refresh.',
          variant: 'destructive',
        });
      });
  }
}, [gameState?.priorityPlayerId]);
```

### Add Additional Safety

```typescript
// Add game state lock
const gameActionLock = useRef(false);

async function executeAITurn() {
  // Prevent re-entrancy
  if (gameActionLock.current) {
    console.warn('AI turn already executing, skipping');
    return;
  }
  
  gameActionLock.current = true;
  
  try {
    // AI logic here...
    const decision = await getAIDecision(gameState);
    await applyGameAction(decision);
  } finally {
    gameActionLock.current = false;
  }
}
```

---

## Acceptance Criteria

- [ ] AI **never** executes two turns simultaneously
- [ ] **No duplicate** AI actions in game log
- [ ] Game state **remains consistent** across all peers
- [ ] **Tests** verify concurrent protection
- [ ] **Error handling** properly resets guards

---

## Test Cases

### Unit Tests
```typescript
// src/app/(app)/game/[id]/__tests__/ai-turn.test.ts
describe('AI Turn Execution', () => {
  it('should prevent concurrent AI executions', async () => {
    const { component, gameState } = setupGameWithAI();
    
    // Trigger AI turn
    gameState.priorityPlayerId = 'ai';
    
    // Trigger again before first completes
    gameState.priorityPlayerId = 'ai';
    
    // Should only execute once
    expect(executeAITurn).toHaveBeenCalledTimes(1);
  });
  
  it('should reset guard after completion', async () => {
    const { component, gameState } = setupGameWithAI();
    
    gameState.priorityPlayerId = 'ai';
    await waitFor(() => expect(aiExecutionRef.current).toBe(false));
    
    // Should be able to execute again
    gameState.priorityPlayerId = 'ai';
    expect(executeAITurn).toHaveBeenCalledTimes(2);
  });
  
  it('should reset guard on error', async () => {
    const { component, gameState } = setupGameWithAI();
    
    // Mock AI to throw error
    mockGetAIDecision.mockRejectedValue(new Error('AI error'));
    
    gameState.priorityPlayerId = 'ai';
    await waitFor(() => expect(aiExecutionRef.current).toBe(false));
    
    // Guard should be reset even after error
    expect(aiExecutionRef.current).toBe(false);
  });
});
```

### Integration Tests
```typescript
describe('AI Turn Integration', () => {
  it('should handle rapid priority changes', async () => {
    const { component, user } = setupGameWithAI();
    
    // Simulate rapid priority changes
    act(() => {
      gameState.priorityPlayerId = 'ai';
      gameState.priorityPlayerId = 'player';
      gameState.priorityPlayerId = 'ai';
    });
    
    // Should handle gracefully without duplicate actions
    await waitFor(() => expect(gameLog).toHaveLength(1));
  });
});
```

---

## Additional Improvements

### Add Timeout Protection
```typescript
async function executeAITurn() {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('AI turn timeout')), 30000);
  });
  
  const aiTurnPromise = getAIDecision(gameState);
  
  // Race between AI and timeout
  const decision = await Promise.race([aiTurnPromise, timeoutPromise]);
  // ...
}
```

### Add Logging
```typescript
async function executeAITurn() {
  console.log('[AI] Starting turn execution');
  aiExecutionRef.current = true;
  
  try {
    const decision = await getAIDecision(gameState);
    console.log('[AI] Decision:', decision);
    await applyGameAction(decision);
    console.log('[AI] Turn complete');
  } catch (error) {
    console.error('[AI] Turn failed:', error);
    throw error;
  } finally {
    aiExecutionRef.current = false;
  }
}
```

---

## Related Issues

- #544 (Server/Engine-Side Action Validation)
- #602 (Connect game engine to UI)

---

## Debugging Tips

To debug AI turn issues:

1. **Enable debug logging:**
```typescript
const DEBUG_AI = true;
if (DEBUG_AI) {
  console.log('[AI] Priority:', gameState?.priorityPlayerId);
  console.log('[AI] Executing:', aiExecutionRef.current);
}
```

2. **Check browser console** for duplicate action messages

3. **Use React DevTools** to inspect component state

4. **Add breakpoints** in `executeAITurn()` to verify single execution

---

## Impact

This is a **critical bug** that can cause:
- **Game state corruption** in multiplayer
- **Desync** between peers
- **Unpredictable** AI behavior
- **Game-breaking** scenarios

Fix should be prioritized before any multiplayer deployment.
