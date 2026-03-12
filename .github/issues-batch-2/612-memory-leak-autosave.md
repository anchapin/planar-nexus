# Fix Memory Leak in Auto-Save Timer

**Priority:** 🟠 HIGH  
**Labels:** `high`, `bug`, `performance`, `memory-leak`  
**Milestone:** v0.2.0 Stability  
**Estimated Effort:** 1 day

---

## Description

Auto-save timer in game page **captures stale `gameState`** in interval callback, causing:
- Memory leaks
- Saving outdated game state
- Potential crashes in long sessions

---

## Affected Files

- `src/app/(app)/game/[id]/page.tsx` (lines 481-493)

---

## Current Problematic Code

```typescript
// src/app/(app)/game/[id]/page.tsx
const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);

useEffect(() => {
  autoSaveTimerRef.current = setInterval(() => {
    if (gameState) { // ❌ Captures stale gameState!
      saveGame(gameState); // Saves outdated state
    }
  }, 30000);
  
  return () => {
    if (autoSaveTimerRef.current) {
      clearInterval(autoSaveTimerRef.current);
    }
  };
}, []); // ❌ Missing gameState dependency!
```

---

## Problems

1. **Stale Closure:** `gameState` is captured when effect runs
2. **Memory Leak:** Old gameState objects retained in memory
3. **Wrong Data:** Auto-save uses outdated state
4. **No Cleanup:** Timer may not be cleared on unmount

---

## Required Changes

### Option 1: Use Ref for Current State (Recommended)

```typescript
const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
const gameStateRef = useRef<GameState | null>(null);

// Keep ref updated
useEffect(() => {
  gameStateRef.current = gameState;
}, [gameState]);

useEffect(() => {
  autoSaveTimerRef.current = setInterval(() => {
    // ✅ Use ref to access current state
    const currentState = gameStateRef.current;
    if (currentState) {
      saveGame(currentState);
    }
  }, 30000);
  
  return () => {
    if (autoSaveTimerRef.current) {
      clearInterval(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
  };
}, []); // ✅ Empty dependency array is correct now
```

### Option 2: Add to Dependency Array

```typescript
useEffect(() => {
  const timer = setInterval(() => {
    if (gameState) {
      saveGame(gameState);
    }
  }, 30000);
  
  return () => {
    clearInterval(timer);
  };
}, [gameState]); // ⚠️ Timer recreated on every state change
```

**Note:** Option 2 works but creates/clears timer frequently, which is inefficient.

---

## Acceptance Criteria

- [ ] **No memory leaks** in DevTools Memory profiler
- [ ] **Auto-save uses current** game state
- [ ] **Timer properly cleaned up** on unmount
- [ ] **Tests verify** cleanup behavior
- [ ] **No ESLint warnings** for dependencies

---

## Testing

### Memory Leak Test
```typescript
// src/app/(app)/game/[id]/__tests__/memory.test.tsx
import { render, unmountComponentAtNode } from '@testing-library/react';

describe('Memory Management', () => {
  it('should not leak memory on unmount', async () => {
    const container = document.createElement('div');
    
    // Mount and unmount multiple times
    for (let i = 0; i < 10; i++) {
      const { unmount } = render(<GamePage />, { container });
      unmount();
    }
    
    // Check for detached DOM nodes
    // (Manual check in DevTools or use testing-library utilities)
  });
  
  it('should clear auto-save timer on unmount', () => {
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
    
    const { unmount } = render(<GamePage />);
    unmount();
    
    expect(clearIntervalSpy).toHaveBeenCalled();
    
    clearIntervalSpy.mockRestore();
  });
});
```

### Manual Testing
1. Open game page
2. Open DevTools Memory profiler
3. Take heap snapshot
4. Play game for 5 minutes
5. Take another heap snapshot
6. Compare - should not see growing gameState objects

---

## Additional Improvements

### Add Debouncing
```typescript
const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

const debouncedSave = useCallback((state: GameState) => {
  if (saveTimeoutRef.current) {
    clearTimeout(saveTimeoutRef.current);
  }
  
  saveTimeoutRef.current = setTimeout(() => {
    saveGame(state);
  }, 1000); // Wait 1 second after last change
}, []);
```

### Add Save Status
```typescript
const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

const saveGame = useCallback(async (state: GameState) => {
  setSaveStatus('saving');
  try {
    await saveToStorage(state);
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 2000);
  } catch (error) {
    setSaveStatus('error');
    console.error('Save failed:', error);
  }
}, []);
```

### Add Visual Feedback
```typescript
// Show save status in UI
{saveStatus === 'saving' && <Spinner />}
{saveStatus === 'saved' && <CheckIcon />}
{saveStatus === 'error' && <ErrorIcon />}
```

---

## Related Issues

- #609 (Add error handling to async operations)

---

## ESLint Configuration

To prevent similar issues:

```javascript
// eslint.config.mjs
rules: {
  'react-hooks/exhaustive-deps': 'error',
  'react-hooks/rules-of-hooks': 'error',
}
```

---

## Best Practices

### For Timers in useEffect
1. **Always** clean up in return function
2. **Use refs** for values that change
3. **Avoid** adding timers to dependency array
4. **Clear** timer before component unmounts

### For State in Closures
1. **Use refs** for latest values
2. **Don't rely** on closure captures
3. **Update refs** when state changes
4. **Test** for stale closures

---

## Debugging Tips

### Check for Memory Leaks
```javascript
// In browser console
performance.memory.usedJSHeapSize
// Should not grow continuously
```

### Check Timer Cleanup
```javascript
// Add logging
useEffect(() => {
  console.log('Timer created');
  return () => {
    console.log('Timer cleaned up');
  };
}, []);
```
