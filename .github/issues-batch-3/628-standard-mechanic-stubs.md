# Implement Standard Mechanic Gameplay Stubs

**Priority:** 🟡 MEDIUM  
**Labels:** `medium`, `gameplay`, `engine`, `standard`, `ux`  
**Milestone:** v0.2.0 Game Rules  
**Estimated Effort:** 2–3 days  

---

## Description

18+ Standard mechanics are detected by the parser but have **zero gameplay effect**. When a player tries to use them, nothing happens — no feedback, no error, just silence. This is a terrible UX.

This issue adds minimal "stub" implementations:
1. **Toast notification** — `"Cycling is not yet fully implemented"`
2. **No-op engine handler** — Prevents crashes when mechanic is triggered
3. **`@todo` markers** — Document what's needed for full implementation

This is NOT about fully implementing all mechanics — it's about making the engine honest about what's supported.

---

## Affected Files

- `src/lib/game-state/oracle-text-parser.ts` (mechanic detection)
- `src/lib/game-state/keyword-actions.ts` (new stub handlers)
- `src/app/(app)/game/[id]/page.tsx` (toast notifications)
- `src/lib/game-state/__tests__/standard-mechanics.test.ts` (stub tests)

---

## Mechanics Requiring Stubs

| Mechanic | Detection | Current Behavior | Stub Action |
|----------|-----------|------------------|-------------|
| **Cycling** | ✅ | Nothing | Toast: "Cycling not yet implemented" |
| **Flashback** | ✅ | Nothing | Toast: "Flashback not yet implemented" |
| **Convoke** | ✅ | Nothing | Toast: "Convoke not yet implemented" |
| **Explore** | ✅ | Nothing | Toast: "Explore not yet implemented" |
| **Surveil** | ✅ | Nothing | Toast: "Surveil not yet implemented" |
| **Investigate** | ✅ | Nothing | Toast: "Investigate not yet implemented" |
| **Disguise** | ✅ | Nothing | Toast: "Disguise not yet implemented" |
| **Plot** | ✅ | Nothing | Toast: "Plot not yet implemented" |
| **Offspring** | ✅ | Nothing | Toast: "Offspring not yet implemented" |
| **Saddle** | ✅ | Nothing | Toast: "Saddle not yet implemented" |
| **Food** | ✅ | Nothing | Toast: "Food not yet implemented" |
| **Treasure** | ✅ | Nothing | Toast: "Treasure not yet implemented" |
| **Learn** | ✅ | Nothing | Toast: "Learn not yet implemented" |
| **Valiant** | ✅ | Nothing | Toast: "Valiant not yet implemented" |
| **Bargain** | ✅ | Nothing | Toast: "Bargain not yet implemented" |
| **Backup** | ✅ | Nothing | Toast: "Backup not yet implemented" |
| **Incubate** | ✅ | Nothing | Toast: "Incubate not yet implemented" |

---

## Implementation Plan

### Step 1: Create Stub Handler Registry

```typescript
// src/lib/game-state/mechanic-stubs.ts

export interface MechanicStub {
  keyword: string;
  handler: (state: GameState, cardId: string) => { success: boolean; message: string };
}

export const MECHANIC_STUBS: Record<string, MechanicStub> = {
  cycling: {
    keyword: "Cycling",
    handler: (state, cardId) => ({
      success: false,
      message: "Cycling is not yet fully implemented. Card remains in hand.",
    }),
  },
  flashback: {
    keyword: "Flashback",
    handler: (state, cardId) => ({
      success: false,
      message: "Flashback is not yet fully implemented. Cannot cast from graveyard.",
    }),
  },
  // ... etc for all 17 mechanics
};

export function handleMechanicStub(
  state: GameState,
  cardId: string,
  keyword: string
): { success: boolean; message: string } {
  const stub = MECHANIC_STUBS[keyword.toLowerCase()];
  if (!stub) {
    return { success: false, message: `Unknown mechanic: ${keyword}` };
  }
  return stub.handler(state, cardId);
}
```

### Step 2: Integrate into Card Play Flow

In `page.tsx`, when a card with an unimplemented mechanic is clicked:

```typescript
function handleCardClick(cardId: string, zone: string) {
  const card = gameState.cards.get(cardId);
  if (!card) return;

  // Check if card has unimplemented mechanics
  const unimplemented = getUnimplementedMechanics(card);
  if (unimplemented.length > 0) {
    const mechanic = unimplemented[0];
    const result = handleMechanicStub(gameState, cardId, mechanic);
    toast({
      title: `${mechanic} — Not Implemented`,
      description: result.message,
      variant: "destructive",
    });
    return;
  }

  // ... normal card play flow ...
}
```

### Step 3: Add `@todo` Comments

For each stub, add a JSDoc comment documenting full implementation requirements:

```typescript
/**
 * @todo Full Cycling implementation:
 * - Add cycling cost parser (e.g., "Cycling {2}")
 * - Deduct cycling cost from mana pool
 * - Discard card from hand
 * - Draw a card
 * - Handle triggered abilities from cycling
 */
cycling: {
  keyword: "Cycling",
  handler: ...
}
```

### Step 4: Tests

Each stub should have a test:

```typescript
it("should show stub message for Cycling", () => {
  const state = createGameWithCard("Cycling Drake");
  const result = handleMechanicStub(state, drakeId, "cycling");
  expect(result.success).toBe(false);
  expect(result.message).toContain("not yet fully implemented");
});
```

---

## Acceptance Criteria

- [ ] All 17 unimplemented Standard mechanics have stub handlers
- [ ] Clicking a card with an unimplemented mechanic shows a toast
- [ ] Toast message clearly states the mechanic and that it's not implemented
- [ ] Card remains in its current zone (no partial/incorrect state change)
- [ ] Each stub has a `@todo` comment with full implementation notes
- [ ] Unit tests verify all stubs return appropriate messages
- [ ] No console errors when stub is triggered

---

## Why Stubs Instead of Full Implementation?

Full implementation of 17 mechanics would take weeks. Stubs provide immediate value:

1. **Player transparency** — Players know why a mechanic doesn't work
2. **Crash prevention** — No-op handlers prevent undefined behavior
3. **Implementation roadmap** — `@todo` comments guide future work
4. **Test foundation** — E2E tests can be written against stubs and upgraded later

---

## Related Issues

- #623 (Standard mechanic E2E tests — tests will trigger these stubs)
- #616 (Static analysis — identifies which mechanics need stubs)
- #617 (Oracle text audit — provides the card list)
