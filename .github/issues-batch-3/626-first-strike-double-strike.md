# Implement First Strike / Double Strike Combat Steps

**Priority:** 🔴 CRITICAL  
**Labels:** `critical`, `gameplay`, `engine`, `combat`, `rules`  
**Milestone:** v0.2.0 Game Rules  
**Estimated Effort:** 3–4 days  

---

## Description

Combat currently resolves all damage in a single step. First strike and double strike creatures should deal damage in a separate **first-strike damage step**, followed by state-based actions, then a **regular damage step**.

This is one of the most impactful missing combat features — it changes the outcome of almost every combat involving first/double strike creatures.

---

## Affected Files

- `src/lib/game-state/combat.ts` (major refactor)
- `src/lib/game-state/evergreen-keywords.ts` (`dealsFirstStrikeDamage`, `dealsDoubleStrikeDamage`)
- `src/lib/game-state/state-based-actions.ts` (creature death between steps)
- `src/lib/game-state/turn-phases.ts` (combat damage phases)
- `src/lib/game-state/__tests__/combat.test.ts`
- `e2e/complex-combat.spec.ts`

---

## Current Broken Behavior

```typescript
// combat.ts — all damage in one step
function resolveCombatDamage(state: GameState): GameState {
  // Deals ALL combat damage simultaneously
  // First strikers and regular creatures deal damage at same time
}
```

**Example of bug:**
- Savannah Lions (2/1, first strike) attacks
- Grizzly Bears (2/2, no first strike) blocks
- Current: Both deal damage, Lions die (Bears deal 2, Lions have 1 toughness)
- Correct: Lions deal first-strike damage first, Bears die before dealing damage, Lions survive

---

## Required Fix

### Step 1: Add Combat Damage Step Types

```typescript
export type CombatDamageStep = "first_strike" | "regular";

export interface CombatResolution {
  step: CombatDamageStep;
  assignments: Map<CardInstanceId, DamageAssignment>;
}
```

### Step 2: Split Damage Resolution

```typescript
export function resolveCombat(state: GameState): GameState {
  // Step 1: First strike damage
  let newState = resolveFirstStrikeDamage(state);

  // Check state-based actions (creatures with lethal damage die)
  newState = checkStateBasedActions(newState).state;

  // Step 2: Regular damage
  newState = resolveRegularDamage(newState);

  // Final SBA check
  newState = checkStateBasedActions(newState).state;

  return newState;
}

function resolveFirstStrikeDamage(state: GameState): GameState {
  const firstStrikers = getAttackers(state).filter(
    a => hasFirstStrike(a) || hasDoubleStrike(a)
  );
  const firstStrikeBlockers = getBlockers(state).filter(
    b => hasFirstStrike(b) || hasDoubleStrike(b)
  );

  return dealCombatDamage(state, [...firstStrikers, ...firstStrikeBlockers]);
}

function resolveRegularDamage(state: GameState): GameState {
  // Attackers WITHOUT first strike, plus ALL double strikers (again)
  const regularAttackers = getAttackers(state).filter(
    a => !hasFirstStrike(a) || hasDoubleStrike(a)
  );
  // Blockers that are still alive and don't have first strike
  // (first-strike blockers already dealt damage in step 1)
  const regularBlockers = getBlockers(state).filter(
    b => !hasFirstStrike(b) || hasDoubleStrike(b)
  );

  return dealCombatDamage(state, [...regularAttackers, ...regularBlockers]);
}
```

### Step 3: Handle Double Strike

Double strike creatures deal damage in **both** steps:
- First strike damage step: they deal damage
- Regular damage step: they deal damage again (if still alive)

### Step 4: Update Combat Phase Flow

```typescript
// Combat phases:
Phase.BEGIN_COMBAT
  → Phase.DECLARE_ATTACKERS
  → Phase.DECLARE_BLOCKERS
  → Phase.COMBAT_DAMAGE_FIRST_STRIKE  // NEW
  → Phase.COMBAT_DAMAGE               // Renamed from regular
  → Phase.END_COMBAT
```

### Step 5: Update UI

In `page.tsx`, when advancing through combat:
1. After blockers declared, advance to first-strike damage
2. Show first-strike damage resolution
3. Advance to regular damage
4. Show regular damage resolution

---

## Acceptance Criteria

- [ ] First strike creatures deal damage before non-first-strike creatures
- [ ] Creatures killed by first-strike damage do not deal damage in regular step
- [ ] Double strike creatures deal damage in both steps
- [ ] State-based actions check between first-strike and regular damage
- [ ] Combat log shows separate first-strike and regular damage
- [ ] Unit test: first strike attacker vs. non-first-strike blocker → blocker dies, attacker survives
- [ ] Unit test: double strike attacker → deals damage twice
- [ ] Unit test: first strike vs. first strike → both deal damage in first-strike step only
- [ ] E2E test: combat with first strike creature

---

## Test Cases

```typescript
it("first strike attacker kills blocker before blocker deals damage", () => {
  const state = setupCombat({
    attacker: { name: "Savannah Lions", power: 2, toughness: 1, firstStrike: true },
    blocker: { name: "Grizzly Bears", power: 2, toughness: 2 },
  });

  // First strike damage
  let afterFirstStrike = resolveFirstStrikeDamage(state);
  expect(afterFirstStrike.cards.get(bearsId)?.zone).toBe("graveyard");
  expect(afterFirstStrike.cards.get(lionsId)?.zone).toBe("battlefield");

  // Regular damage — bears are dead, lions survive
  let afterRegular = resolveRegularDamage(afterFirstStrike);
  expect(afterRegular.cards.get(lionsId)?.zone).toBe("battlefield");
});

it("double strike deals damage in both steps", () => {
  const state = setupCombat({
    attacker: { name: "Aurelia", power: 2, toughness: 2, doubleStrike: true },
    blocker: { name: "Wall of Wood", power: 0, toughness: 3 },
  });

  const afterFirstStrike = resolveFirstStrikeDamage(state);
  const wallAfterFirst = afterFirstStrike.cards.get(wallId);
  expect(wallAfterFirst?.damageMarked).toBe(2);

  const afterRegular = resolveRegularDamage(afterFirstStrike);
  const wallAfterRegular = afterRegular.cards.get(wallId);
  expect(wallAfterRegular?.damageMarked).toBe(4); // 2 + 2
  expect(wallAfterRegular?.zone).toBe("graveyard");
});
```

---

## Rules Reference

- **CR 510.1:** Combat damage is dealt in steps
- **CR 510.2:** First strike damage step
- **CR 510.3:** State-based actions after first-strike damage
- **CR 510.4:** Regular damage step
- **CR 702.4:** Double Strike
- **CR 702.7:** First Strike

---

## Related Issues

- #627 (Trample + blocker ordering — depends on this)
- #614 (Complete combat system — batch 2)
