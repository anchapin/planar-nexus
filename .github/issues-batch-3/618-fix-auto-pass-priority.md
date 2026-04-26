# Fix Priority/Stack System: Remove Auto-Pass Behavior

**Priority:** 🔴 CRITICAL  
**Labels:** `critical`, `gameplay`, `engine`, `ui`, `rules`  
**Milestone:** v0.2.0 Game Rules  
**Estimated Effort:** 3–5 days  

---

## Description

The UI currently **forces both players to pass priority automatically** after spell casts. This destroys the entire stack interaction model of Magic:

- Counterspells cannot be cast (no response window)
- Instants cannot be cast during opponent's turn
- The opponent never gets priority to react

This is the single most critical gameplay bug after basic rule enforcement.

---

## Affected Files

- `src/app/(app)/game/[id]/page.tsx` (lines ~1617, ~1817, ~2062, ~2410, ~2458, ~2506, ~2580)
- `src/lib/game-state/game-state.ts` (priority passing logic)
- `src/lib/game-state/turn-phases.ts` (phase advancement)
- New file: `src/components/ui/auto-resolve-toggle.tsx` (optional)

---

## Current Broken Behavior

```typescript
// page.tsx ~1617
// After casting a spell:
let resolvedState = checkStateBasedActions(result.state).state;
const aiPlayer = Array.from(resolvedState.players.values()).find(
  (p) => p.name.includes("AI")
);
if (aiPlayer && resolvedState.stack.length > 0) {
  // BUG: Forces both players to pass without giving them a chance to respond
  newState = passPriority(newState, aiPlayer.id);
  newState = passPriority(newState, player.id);
}
```

**Same pattern appears in 6+ locations.**

---

## Required Fix

### Step 1: Remove Forced Auto-Pass

Delete or disable all forced `passPriority` loops after spell casts. After casting a spell:
1. Spell goes on stack
2. Active player retains priority
3. They must explicitly pass priority
4. Then non-active player gets priority
5. Only when both pass does the top stack object resolve

### Step 2: Add "Auto-Pass" Toggle (UX Improvement)

Add a toggle button to the game UI:
- **ON:** Auto-pass priority when you have no responses (current behavior, but opt-in)
- **OFF:** Full manual priority control (default for serious play)

When ON, auto-pass should still give the opponent a simulated response window (for AI turns).

### Step 3: Fix AI Turn Auto-Pass

Currently the human auto-passes during AI's turn with a 400ms delay. This prevents casting instants during opponent's turn.

**Fix:** During opponent's turn, the human should retain priority at relevant steps. Add a "Pass Priority" button that appears when the human has priority during opponent's turn.

### Step 4: Add Response UI

When the opponent casts a spell and it goes on the stack:
1. Highlight the stack
2. Show a "Respond" button
3. Allow casting instants/activating abilities
4. After response, return to normal priority passing

---

## Acceptance Criteria

- [ ] Forced auto-pass after spell casts is removed
- [ ] Active player retains priority after casting a spell
- [ ] Non-active player gets priority before stack resolution
- [ ] Both players can cast instants while stack is non-empty
- [ ] Counterspells can be cast in response to spells
- [ ] Human can cast instants during AI's turn
- [ ] "Auto-pass" toggle exists (default OFF)
- [ ] All existing E2E tests still pass
- [ ] New E2E test: Cast spell → opponent responds with counterspell → verify countered

---

## Test Cases

### Test 1: Counterspell Window
```typescript
test("counterspell can respond to spell", async () => {
  // Human casts Lightning Bolt
  // AI has Counterspell in hand
  // AI should get priority and cast Counterspell
  // Verify Lightning Bolt is countered
});
```

### Test 2: Instant on Opponent's Turn
```typescript
test("human can cast instant during AI's turn", async () => {
  // AI casts a spell
  // Human should get priority
  // Human casts instant from hand
  // Verify instant resolves
});
```

### Test 3: Stack Resolves LIFO
```typescript
test("stack resolves in LIFO order", async () => {
  // Cast spell A
  // Respond with spell B
  // Verify B resolves before A
});
```

---

## Related Issues

- #619 (Mana pool emptying — related to phase transitions)
- #626 (Combat — also needs priority windows)
- #614 (Complete combat system — batch 2)
