# Enforce Hexproof & Menace in Gameplay

**Priority:** 🟠 HIGH  
**Labels:** `high`, `gameplay`, `engine`, `rules`, `keywords`  
**Milestone:** v0.2.0 Game Rules  
**Estimated Effort:** 1–2 days  

---

## Description

Hexproof and Menace are detected by the parser and have partial helper functions, but neither is actually **enforced** during gameplay.

- **Hexproof:** A spell/ability controlled by an opponent cannot target a permanent with hexproof.
- **Menace:** A creature with menace cannot be blocked by only one creature.

---

## Affected Files

- `src/lib/game-state/evergreen-keywords.ts`
- `src/lib/game-state/combat.ts` (menace blocking)
- `src/lib/game-state/spell-casting.ts` or targeting system (hexproof)
- `src/app/(app)/game/[id]/page.tsx` (UI targeting)
- `src/lib/game-state/__tests__/evergreen-keywords.test.ts`
- `src/lib/game-state/__tests__/combat.test.ts`

---

## Hexproof Implementation

### Current State

```typescript
// evergreen-keywords.ts
export function hasHexproof(card: CardInstance): boolean {
  return card.keywords?.includes("Hexproof") || false;
}
```

Detection only. No targeting enforcement.

### Required Fix

Add targeting validation. When a player tries to target a permanent:

```typescript
export function canTarget(
  sourceController: PlayerId,
  target: CardInstance
): boolean {
  if (hasHexproof(target) && target.controllerId !== sourceController) {
    return false;
  }
  // ... other targeting restrictions
  return true;
}
```

**Integration points:**
1. Spell casting — validate targets before adding to stack
2. Ability activation — validate targets
3. Combat targeting — validate before declaring attackers (if relevant)
4. UI — gray out invalid targets, show toast on illegal target selection

### Hexproof From Variants

Also handle "Hexproof from [quality]" (e.g., "Hexproof from white"):
- Parse the quality from oracle text
- Check if the source spell/ability matches that quality

---

## Menace Implementation

### Current State

```typescript
// evergreen-keywords.ts
export function getMenaceMinimumBlockers(): number {
  return 2;
}
```

Returns 2 but never checked during blocking.

### Required Fix

In `declareBlockers` or the UI blocking handler:

```typescript
export function canBlockWithCreatures(
  attacker: CardInstance,
  blockers: CardInstance[]
): boolean {
  if (hasMenace(attacker) && blockers.length < getMenaceMinimumBlockers()) {
    return false;
  }
  return true;
}
```

**Integration:**
1. `combat.ts` — validate blocker declarations
2. `page.tsx` — show error if player tries to block menace creature with only 1 blocker

---

## Acceptance Criteria

### Hexproof
- [ ] Cannot target opponent's permanent with hexproof
- [ ] Can target your own permanents with hexproof
- [ ] "Hexproof from [quality]" is enforced
- [ ] UI shows invalid targets as unselectable
- [ ] Toast appears on illegal target attempt
- [ ] Unit tests for all hexproof variants

### Menace
- [ ] Menace creature cannot be blocked by 1 creature
- [ ] Menace creature can be blocked by 2+ creatures
- [ ] UI prevents invalid blocker declarations
- [ ] Unit tests for menace blocking

---

## Test Cases

```typescript
// Hexproof
it("should prevent targeting opponent's hexproof permanent", () => {
  const hexproofCreature = createCreatureWithKeyword("Hexproof");
  const bolt = createSpell("Lightning Bolt");
  expect(canTarget(bolt.controllerId, hexproofCreature)).toBe(false);
});

it("should allow targeting your own hexproof permanent", () => {
  const hexproofCreature = createCreatureWithKeyword("Hexproof");
  const pumpSpell = createSpell("Giant Growth", hexproofCreature.controllerId);
  expect(canTarget(pumpSpell.controllerId, hexproofCreature)).toBe(true);
});

// Menace
it("should require 2 blockers for menace creature", () => {
  const menaceCreature = createCreatureWithKeyword("Menace");
  const blocker1 = createCreature("Blocker 1");
  expect(canBlockWithCreatures(menaceCreature, [blocker1])).toBe(false);
  const blocker2 = createCreature("Blocker 2");
  expect(canBlockWithCreatures(menaceCreature, [blocker1, blocker2])).toBe(true);
});
```

---

## Related Issues

- #616 (Static analysis — will identify these gaps)
- #626 (Combat system — menace is a combat keyword)
