# Implement Trample Damage Assignment with Blocker Ordering

**Priority:** 🔴 CRITICAL  
**Labels:** `critical`, `gameplay`, `engine`, `combat`, `rules`  
**Milestone:** v0.2.0 Game Rules  
**Estimated Effort:** 4–5 days  

---

## Description

Trample is currently oversimplified. The full rules require:

1. **Blocker ordering** — Attacking player chooses the order in which blockers receive damage
2. **Lethal assignment** — Attacker must assign lethal damage to each blocker before the next
3. **Excess to player** — Remaining damage goes to defending player/planeswalker
4. **Deathtouch interaction** — Deathtouch changes lethal threshold to 1 damage

This issue depends on #626 (First Strike / Double Strike) because damage assignment happens in each damage step.

---

## Affected Files

- `src/lib/game-state/combat.ts` (damage assignment)
- `src/lib/game-state/evergreen-keywords.ts` (trample, deathtouch)
- `src/app/(app)/game/[id]/page.tsx` (blocker ordering UI)
- `src/lib/game-state/__tests__/combat.test.ts`
- `e2e/complex-combat.spec.ts`

---

## Current Broken Behavior

```typescript
// combat.ts — oversimplified trample
function assignTrampleDamage(attacker, blockers) {
  let remaining = attacker.power;
  for (const blocker of blockers) {
    const lethal = blocker.toughness; // BUG: ignores damageMarked
    const assigned = Math.min(lethal, remaining);
    remaining -= assigned;
  }
  // remaining goes to player
}
```

**Bugs:**
1. No player choice in blocker order
2. Doesn't account for `damageMarked` (already damaged creatures)
3. Doesn't account for deathtouch (lethal = 1)
4. Doesn't account for first strike (blockers may already be dead)

---

## Required Fix

### Step 1: Blocker Ordering UI

After blockers are declared, the attacking player must choose the order:

```typescript
// page.tsx — new UI flow
if (declaredBlockers.length > 1) {
  setPendingAction({
    type: "order_blockers",
    attackerId: attacker.id,
    blockerIds: declaredBlockers.map(b => b.id),
  });
  // Show UI: "Choose damage assignment order for blockers"
  // Drag to reorder blockers
}
```

### Step 2: Store Blocker Order

```typescript
interface CombatState {
  // ... existing ...
  blockerOrders: Map<AttackerId, BlockerId[]>;
}
```

### Step 3: Damage Assignment Function

```typescript
function assignCombatDamage(
  attacker: CardInstance,
  blockers: CardInstance[],
  blockerOrder: CardInstanceId[],
  totalDamage: number
): DamageAssignment {
  const assignment = new Map<CardInstanceId, number>();
  let remaining = totalDamage;

  // Sort blockers by attacker-chosen order
  const orderedBlockers = blockerOrder
    .map(id => blockers.find(b => b.id === id))
    .filter(Boolean) as CardInstance[];

  for (const blocker of orderedBlockers) {
    // Calculate lethal damage
    const lethalThreshold = hasDeathtouch(attacker) ? 1 :
      blocker.toughness - (blocker.damageMarked || 0);

    const toAssign = Math.min(lethalThreshold, remaining);
    assignment.set(blocker.id, toAssign);
    remaining -= toAssign;

    if (remaining <= 0) break;
  }

  // Excess to defending player
  if (remaining > 0) {
    assignment.set("defending_player", remaining);
  }

  return assignment;
}
```

### Step 4: Integrate with First Strike

In the first-strike damage step:
1. Apply damage assignments
2. Check SBAs (some blockers may die)
3. In regular damage step, dead blockers are excluded
4. Trample attacker may now have more "excess" damage if blockers died

### Step 5: Multiple Blockers on One Attacker — UI

```typescript
// In the combat UI, when an attacker has multiple blockers:
<BlockedAttacker attacker={attacker}>
  <BlockerOrderList
    blockers={blockers}
    onReorder={(newOrder) => setBlockerOrder(attacker.id, newOrder)}
  />
</BlockedAttacker>
```

---

## Acceptance Criteria

- [ ] Attacking player chooses blocker damage assignment order
- [ ] Lethal damage assigned to each blocker in order before next
- [ ] Excess damage goes to defending player
- [ ] Deathtouch changes lethal threshold to 1
- [ ] First-strike damage can kill blockers, changing regular damage assignment
- [ ] UI allows drag-to-reorder blockers
- [ ] Unit test: trample vs. 1 blocker
- [ ] Unit test: trample vs. 3 blockers with chosen order
- [ ] Unit test: deathtouch + trample
- [ ] Unit test: first strike + trample (blocker dies in first-strike step)
- [ ] E2E test: combat with trample creature and multiple blockers

---

## Test Cases

```typescript
it("should assign excess trample damage to player", () => {
  const state = setupCombat({
    attacker: { name: "Terastodon", power: 9, toughness: 9, trample: true },
    blockers: [{ name: "Grizzly Bears", power: 2, toughness: 3 }],
  });

  const assignment = assignCombatDamage(attacker, blockers, [bearsId], 9);
  expect(assignment.get(bearsId)).toBe(3); // lethal
  expect(assignment.get("defending_player")).toBe(6); // excess
});

it("should assign damage in chosen blocker order", () => {
  const state = setupCombat({
    attacker: { name: "Colossal Dreadmaw", power: 6, toughness: 6, trample: true },
    blockers: [
      { name: "Bear 1", toughness: 2 },
      { name: "Bear 2", toughness: 2 },
      { name: "Bear 3", toughness: 2 },
    ],
  });

  // Order: Bear 2, Bear 1, Bear 3
  const order = [bear2Id, bear1Id, bear3Id];
  const assignment = assignCombatDamage(attacker, blockers, order, 6);

  expect(assignment.get(bear2Id)).toBe(2); // first in order
  expect(assignment.get(bear1Id)).toBe(2); // second
  expect(assignment.get(bear3Id)).toBe(2); // third
  expect(assignment.get("defending_player")).toBe(0); // no excess
});

it("deathtouch + trample: lethal is 1 damage per blocker", () => {
  const state = setupCombat({
    attacker: { name: "Deadly Recluse", power: 4, toughness: 2, trample: true, deathtouch: true },
    blockers: [
      { name: "Bear 1", toughness: 4 },
      { name: "Bear 2", toughness: 4 },
    ],
  });

  const assignment = assignCombatDamage(attacker, blockers, [bear1Id, bear2Id], 4);
  expect(assignment.get(bear1Id)).toBe(1); // deathtouch lethal
  expect(assignment.get(bear2Id)).toBe(1); // deathtouch lethal
  expect(assignment.get("defending_player")).toBe(2); // excess
});
```

---

## Rules Reference

- **CR 702.19:** Trample
- **CR 510.1c:** Multiple blockers — attacker chooses order
- **CR 510.1d:** Lethal damage assignment
- **CR 702.2b:** Deathtouch — lethal damage is 1

---

## Related Issues

- #626 (First strike / double strike — prerequisite)
- #614 (Complete combat system — batch 2)
