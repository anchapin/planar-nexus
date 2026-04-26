# Fix Legendary Rule — Let Player Choose Which to Keep

**Priority:** 🟡 MEDIUM  
**Labels:** `medium`, `gameplay`, `engine`, `rules`, `state-based-actions`  
**Milestone:** v0.2.0 Game Rules  
**Estimated Effort:** 1–2 days  

---

## Description

The legendary rule in `state-based-actions.ts` currently destroys the **first** legendary permanent and keeps the rest. Per CR 704.5j, the player (legendary permanent's controller) chooses which one to keep.

This matters when:
- A player casts their second copy of a legendary creature
- A clone effect copies a legendary permanent
- A token is created that's legendary

---

## Affected Files

- `src/lib/game-state/state-based-actions.ts`
- `src/app/(app)/game/[id]/page.tsx` (UI for player choice)
- `src/lib/game-state/__tests__/game-state.test.ts`

---

## Current Broken Behavior

```typescript
// state-based-actions.ts (simplified)
function applyLegendRule(state: GameState, cards: CardInstance[]): GameState {
  // BUG: Keeps first, destroys rest — should let player choose
  const toKeep = cards[0];
  const toDestroy = cards.slice(1);
  // ... destroy toDestroy ...
}
```

---

## Required Fix

### Step 1: Detect Legendary Conflicts

When SBA runs, group legendary permanents by name and controller:

```typescript
interface LegendaryConflict {
  name: string;
  controllerId: PlayerId;
  permanents: CardInstance[];
}

function findLegendaryConflicts(state: GameState): LegendaryConflict[] {
  const legendaryByName = new Map<string, CardInstance[]>();
  for (const card of battlefieldCards) {
    if (isLegendary(card)) {
      const list = legendaryByName.get(card.cardData.name) || [];
      list.push(card);
      legendaryByName.set(card.cardData.name, list);
    }
  }
  return Array.from(legendaryByName.entries())
    .filter(([_, cards]) => cards.length > 1)
    .map(([name, cards]) => ({ name, controllerId: cards[0].controllerId, permanents: cards }));
}
```

### Step 2: Prompt Player to Choose

If a conflict exists for the active player (or the player whose turn it is):

```typescript
// Engine side: queue a choice request
function queueLegendaryChoice(
  state: GameState,
  conflict: LegendaryConflict
): GameState {
  return {
    ...state,
    pendingChoices: [
      ...state.pendingChoices,
      {
        type: "legendary_rule",
        playerId: conflict.controllerId,
        options: conflict.permanents.map(p => p.id),
        description: `Choose one ${conflict.name} to keep`,
      }
    ],
  };
}
```

### Step 3: Apply Choice

When player chooses:

```typescript
function applyLegendaryChoice(
  state: GameState,
  choice: { keepId: CardInstanceId }
): GameState {
  // Destroy all legendary permanents with same name except chosen one
}
```

### Step 4: UI Integration

In `page.tsx`, when a `legendary_rule` choice is pending:
1. Show a dialog: "Legendary Rule: Choose which [Name] to keep"
2. Display each legendary permanent with its current stats/attachments
3. Player clicks one to keep
4. Others are destroyed

---

## Acceptance Criteria

- [ ] When a player controls 2+ legendary permanents with same name, they choose which to keep
- [ ] All non-chosen legendary permanents with that name are destroyed
- [ ] Choice is made by the controller (not the opponent)
- [ ] UI shows a clear choice dialog
- [ ] Unit test: 2 legendary creatures → player chooses 1 to keep
- [ ] Unit test: 3 legendary creatures → player chooses 1, 2 destroyed
- [ ] Unit test: different controllers with same legendary name → no conflict (only checks per-controller)

---

## Test Cases

```typescript
it("should let player choose which legendary to keep", () => {
  const state = createGameWithTwoLegendaries("Thalia, Guardian of Thraben");
  const result = checkStateBasedActions(state);

  expect(result.state.pendingChoices).toHaveLength(1);
  expect(result.state.pendingChoices[0].type).toBe("legendary_rule");

  // Simulate choosing the second one
  const chosenId = result.state.pendingChoices[0].options[1];
  const finalState = applyLegendaryChoice(result.state, { keepId: chosenId });

  // First one destroyed, second kept
  expect(finalState.cards.get(options[0])?.zone).toBe("graveyard");
  expect(finalState.cards.get(options[1])?.zone).toBe("battlefield");
});

it("should not trigger legendary rule across different controllers", () => {
  const state = createGameWhereBothPlayersHave("Thalia");
  const result = checkStateBasedActions(state);

  // No pending choices — legendary rule is per-controller
  expect(result.state.pendingChoices).toHaveLength(0);
});
```

---

## Rules Reference

- **CR 704.5j:** If a player controls two or more legendary permanents with the same name, that player chooses one of them, and the rest are put into their owners' graveyards.

---

## Related Issues

- #624 (Untap step — SBAs also run during untap step)
