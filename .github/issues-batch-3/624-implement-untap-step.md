# Implement Complete Untap Step Engine Logic

**Priority:** 🟠 HIGH  
**Labels:** `high`, `gameplay`, `engine`, `rules`, `turn-structure`  
**Milestone:** v0.2.0 Game Rules  
**Estimated Effort:** 1–2 days  

---

## Description

The untap step currently exists only as a structural phase — it has no actual engine logic. When a new turn starts:

1. `startNextTurn` sets phase to `UNTAP`
2. `advanceToNextPhase` skips to `UPKEEP` because `playersGetPriority(Phase.UNTAP)` returns `false`
3. Untap happens as a side effect of turn transition, not as a proper step

**Bug:** If a card says "At the beginning of your untap step", there's no actual untap step where triggers can fire. Also, effects that say "This permanent doesn't untap during your untap step" have no step to reference.

---

## Affected Files

- `src/lib/game-state/turn-phases.ts`
- `src/lib/game-state/game-state.ts` (`advanceToNextPhase`)
- `src/lib/game-state/state-based-actions.ts` (trigger handling)
- `src/lib/game-state/__tests__/turn-phases.test.ts`
- `src/lib/game-state/__tests__/game-state.test.ts`

---

## Required Fix

### Step 1: Make Untap Step a Real Phase

The untap step should:
1. **Untap all permanents** controlled by the active player
2. **Check for "doesn't untap" effects** (e.g., "This permanent doesn't untap during your next untap step")
3. **Fire "at beginning of untap step" triggers**
4. **Then advance to upkeep**

```typescript
function performUntapStep(state: GameState): GameState {
  const activePlayerId = state.turn.activePlayerId;
  const battlefield = state.zones.get(`${activePlayerId}-battlefield`);

  if (!battlefield) return state;

  const updatedCards = new Map(state.cards);
  for (const cardId of battlefield.cardIds) {
    const card = updatedCards.get(cardId);
    if (!card) continue;

    // Check if card has "doesn't untap" effect
    if (hasEffect(card, "doesn't untap during your untap step")) {
      continue;
    }

    // Untap if tapped
    if (card.isTapped) {
      updatedCards.set(cardId, untapCard(card));
    }
  }

  return {
    ...state,
    cards: updatedCards,
    lastModifiedAt: Date.now(),
  };
}
```

### Step 2: Separate Untap from Turn Transition

Currently untap happens in `advanceToNextPhase` during cleanup→next turn transition. Separate it:

```typescript
// In advanceToNextPhase, when transitioning to a new turn:
// 1. Create new turn with phase = UNTAP
// 2. DO NOT untap here
// 3. Let the phase system advance through UNTAP normally
// 4. When phase is UNTAP, performUntapStep() then advance
```

### Step 3: Handle "Doesn't Untap" Effects

Add a field or effect tracking mechanism:

```typescript
interface CardInstance {
  // ... existing fields ...
  effects: ActiveEffect[];
}

interface ActiveEffect {
  type: "no_untap";
  duration: "next_untap" | "permanent";
  sourceId: CardInstanceId;
}
```

When performing untap step, check `card.effects` for `no_untap` with `duration: "next_untap"` and skip those cards. Remove the effect after the step.

---

## Acceptance Criteria

- [ ] Untap step is a distinct phase with engine logic
- [ ] All active player's tapped permanents untap during untap step
- [ ] "Doesn't untap" effects prevent untapping
- [ ] "At beginning of untap step" triggers can fire (even if just stubbed)
- [ ] Phase advances from UNTAP → UPKEEP after untap completes
- [ ] Unit test: permanents untap at start of turn
- [ ] Unit test: "doesn't untap" effect prevents untapping
- [ ] Existing tests still pass (turn transition test at game-state.test.ts:664)

---

## Test Cases

```typescript
it("should untap all permanents during untap step", () => {
  let state = createGameWithTappedLand();
  state.turn.currentPhase = Phase.UNTAP;

  state = performUntapStep(state);

  const land = state.cards.get(landId);
  expect(land?.isTapped).toBe(false);
  expect(state.turn.currentPhase).toBe(Phase.UPKEEP); // Advanced after untap
});

it("should not untap permanents with 'doesn't untap' effect", () => {
  let state = createGameWithTappedLand();
  // Apply "doesn't untap during next untap step" effect
  state = applyEffect(state, landId, { type: "no_untap", duration: "next_untap" });
  state.turn.currentPhase = Phase.UNTAP;

  state = performUntapStep(state);

  const land = state.cards.get(landId);
  expect(land?.isTapped).toBe(true); // Still tapped
});
```

---

## Rules Reference

- **CR 502:** Untap Step
- **CR 502.2:** During the untap step, the active player untaps all permanents they control.
- **CR 502.3:** "At the beginning of the untap step" triggered abilities trigger.

---

## Related Issues

- #618 (Priority system — untap step has no priority, but other steps do)
- #625 (Legendary rule — also an SBA that could fire during untap)
