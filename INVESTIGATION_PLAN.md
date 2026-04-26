# Investigation Plan: E2E Test Failures & Game Initialization

## Problem Statement
E2E tests are failing because the game page triggers an error boundary ("Game Interrupted") during initial load, BEFORE the user sees the mulligan screen.

## Evidence
- Page snapshot shows "Game Interrupted" error page
- Error occurs during page initialization (before handleKeepHand is clicked)
- This happens consistently in the test environment

---

## Investigation Steps

### Step 1: Enable Error Logging
Add console logging to catch the actual error:
```typescript
// In page.tsx - wrap the initialization in try/catch with logging
```

### Step 2: Check Server Component Errors
The page is a Server Component that calls `getOrCreateActiveGame()`. Possible issues:
- [ ] Missing required parameters (deckId, mode, etc.)
- [ ] IndexedDB not available on server-side
- [ ] Invalid player name from localStorage
- [ ] Error in createInitialGameState

### Step 3: Check Client-Side Initialization
The `useEffect` that initializes the game could be failing:
- [ ] Error in getOrCreateActiveGame when loading from storage
- [ ] Error in loading deck from sessionStorage
- [ ] Error in drawCard during mulligan setup

### Step 4: Check Browser Console Errors
Run test with browser console logging enabled to capture actual error message.

---

## Potential Root Causes

### A. Server-Side Rendering Issue
The page.tsx might be doing something during SSR that fails:
- Check if any code accesses `localStorage`, `sessionStorage`, or `IndexedDB` during render
- These are only available in the browser

### B. Async Initialization Failure
The game initialization is async and might be failing silently:
- Check if there's proper error handling in the initializeGame useEffect
- Add try/catch with logging to identify the exact failure point

### C. Invalid Game State
The game state might be invalid when loaded:
- Check if saved game state is corrupted
- Check if required fields are missing

### D. Route Parameter Issue
The gameId from URL might be causing issues:
- Check if id parameter is properly validated
- Check if mode, difficulty parameters are valid

---

## Quick Wins to Implement

1. **Add defensive checks** around all localStorage/sessionStorage/IndexedDB access
2. **Add error boundary wrapping** around the main game content
3. **Add more specific error messages** to identify where failures occur
4. **Add try/catch** around game initialization with console logging

---

## Test Fixes Needed

Once the root cause is fixed, update tests:
1. Remove unnecessary waits added during debugging
2. Update test assertions to match actual game flow
3. Add proper error handling in tests

---

## Priority

1. **HIGH**: Find actual error causing "Game Interrupted"
2. **HIGH**: Add defensive code to prevent crashes
3. **MEDIUM**: Fix tests to properly verify game flow
4. **LOW**: Clean up debugging code
