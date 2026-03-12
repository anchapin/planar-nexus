# Complete Combat System Implementation

**Priority:** 🟠 HIGH  
**Labels:** `high`, `gameplay`, `engine`, `rules`  
**Milestone:** v0.2.0 Game Rules  
**Estimated Effort:** 4-5 days

---

## Description

Combat system (`src/lib/game-state/combat.ts`) is **missing full implementation** of:
- Blocker ordering (CR 509.2)
- Trample damage assignment (CR 702.19)
- First strike damage step (CR 510.1)
- Double strike damage steps (CR 702.4)
- Multiple blocker damage assignment (CR 510.1)

---

## Affected Files

- `src/lib/game-state/combat.ts` (lines 1-630)
- `src/lib/game-state/state-based-actions.ts` (combat damage)
- `src/lib/game-state/evergreen-keywords.ts` (trample, first strike, etc.)

---

## Missing Features

### 1. First Strike / Double Strike Damage Steps

**Current State:** Single damage step only

**Required:**
```typescript
interface CombatDamageStep {
  name: 'first-strike' | 'regular';
  creatures: CreatureInstance[];
  damageAssigned: Map<CreatureId, DamageAssignment>;
}

// Two damage steps needed:
// 1. First strike damage (creatures with first/double strike)
// 2. Regular damage (creatures without first strike, and double strike again)
```

**Rules Reference:** CR 510.1, 702.4

---

### 2. Trample Damage Assignment

**Current State:** Not implemented

**Required:**
```typescript
function assignTrampleDamage(
  attacker: CreatureInstance,
  blockers: CreatureInstance[],
  damage: number
): DamageAssignment {
  // Sort blockers by toughness (attacker's choice)
  const sortedBlockers = sortBlockersByToughness(blockers);
  
  // Assign lethal damage to each blocker in order
  let remainingDamage = damage;
  const assignment: DamageAssignment = {};
  
  for (const blocker of sortedBlockers) {
    const lethalDamage = blocker.toughness - blocker.damageMarked;
    const toAssign = Math.min(lethalDamage, remainingDamage);
    assignment[blocker.id] = toAssign;
    remainingDamage -= toAssign;
    
    if (remainingDamage <= 0) break;
  }
  
  // Excess damage goes to defending player
  if (remainingDamage > 0) {
    assignment[defendingPlayerId] = remainingDamage;
  }
  
  return assignment;
}
```

**Rules Reference:** CR 702.19

---

### 3. Multiple Blocker Damage Assignment

**Current State:** Not implemented

**Required:**
```typescript
interface DamageAssignmentOrder {
  attacker: CreatureId;
  blockers: CreatureId[]; // Order matters
  assignments: Map<CreatureId, number>;
}

function assignDamageToMultipleBlockers(
  attacker: CreatureInstance,
  blockers: CreatureInstance[],
  attackingPlayer: Player
): DamageAssignmentOrder {
  // Attacking player chooses damage assignment order
  // Must assign at least lethal damage to each before next
  // See CR 510.1c
}
```

**Rules Reference:** CR 510.1

---

### 4. Blocker Ordering

**Current State:** Not implemented

**Required:**
```typescript
function orderBlockers(
  blockers: CreatureInstance[],
  attackingCreature: CreatureInstance
): CreatureId[] {
  // Attacking player chooses order of blockers
  // This matters for trample and damage assignment
  // See CR 509.2
}
```

**Rules Reference:** CR 509.2

---

## Required Changes

### Step 1: Add Combat Phase Data Structures

```typescript
// src/lib/game-state/combat.ts

export interface CombatData {
  attackingPlayer: PlayerId;
  defendingPlayer: PlayerId;
  attackers: AttackerData[];
  blockers: BlockerData[];
  currentStep: CombatStep;
  damageAssignments: Map<CreatureId, DamageAssignment>;
}

export type CombatStep =
  | 'beginning-of-combat'
  | 'declare-attackers'
  | 'declare-blockers'
  | 'first-strike-damage'
  | 'regular-damage'
  | 'end-of-combat';

export interface AttackerData {
  creature: CreatureInstance;
  isTapped: boolean;
  hasFirstStrike: boolean;
  hasDoubleStrike: boolean;
  hasTrample: boolean;
  assignedBlockers: CreatureId[];
}

export interface BlockerData {
  creature: CreatureInstance;
  blocking: CreatureId; // Creature being blocked
  damageOrder: CreatureId[]; // For multiple blockers
}
```

### Step 2: Implement First Strike Damage

```typescript
async function firstStrikeDamageStep(combat: CombatData): Promise<GameState> {
  // Get creatures with first strike or double strike
  const firstStrikers = combat.attackers.filter(
    a => a.hasFirstStrike || a.hasDoubleStrike
  );
  
  // Assign and deal damage
  for (const attacker of firstStrikers) {
    await dealCombatDamage(attacker, combat);
  }
  
  // Check state-based actions
  checkStateBasedActions(gameState);
  
  return gameState;
}
```

### Step 3: Implement Regular Damage

```typescript
async function regularDamageStep(combat: CombatData): Promise<GameState> {
  // Creatures without first strike deal damage
  const regularCreatures = combat.attackers.filter(
    a => !a.hasFirstStrike || a.hasDoubleStrike
  );
  
  // Also creatures that survived first strike
  const survivingBlockers = combat.blockers.filter(
    b => b.creature.isOnBattlefield
  );
  
  // Deal damage
  for (const creature of [...regularCreatures, ...survivingBlockers]) {
    await dealCombatDamage(creature, combat);
  }
  
  checkStateBasedActions(gameState);
  
  return gameState;
}
```

### Step 4: Implement Trample

```typescript
function calculateTrampleDamage(
  attacker: CreatureInstance,
  blockers: CreatureInstance[],
  totalDamage: number
): { toBlockers: Map<CreatureId, number>, toPlayer: number } {
  // Sort blockers (attacker chooses order)
  const sortedBlockers = sortBlockers(blockers);
  
  let remaining = totalDamage;
  const toBlockers = new Map<CreatureId, number>();
  
  for (const blocker of sortedBlockers) {
    const lethal = blocker.toughness - (blocker.damageMarked || 0);
    const assign = Math.min(lethal, remaining);
    toBlockers.set(blocker.id, assign);
    remaining -= assign;
  }
  
  return {
    toBlockers,
    toPlayer: Math.max(0, remaining),
  };
}
```

---

## Acceptance Criteria

- [ ] **First strike** creatures deal damage in separate step
- [ ] **Double strike** creatures deal damage in both steps
- [ ] **Trample** damage assigned correctly to player
- [ ] **Multiple blockers** damage assigned in order
- [ ] **Blocker ordering** works correctly
- [ ] **All tests** passing
- [ ] **No rules violations** in combat scenarios

---

## Test Cases

### First Strike Test
```typescript
it('should handle first strike damage', () => {
  const gameState = setupCombat({
    attacker: { name: 'Savannah Lions', firstStrike: true },
    blocker: { name: 'Grizzly Bears' },
  });
  
  // First strike damage
  gameState = firstStrikeDamageStep(gameState);
  
  // Bears should be dead (2 damage from Lions)
  expect(gameState.battlefield).not.toContain('Grizzly Bears');
  
  // Regular damage step - Lions already dealt damage
  gameState = regularDamageStep(gameState);
  
  // Lions survive (bears dead before they could deal damage)
  expect(gameState.battlefield).toContain('Savannah Lions');
});
```

### Trample Test
```typescript
it('should handle trample damage', () => {
  const gameState = setupCombat({
    attacker: { name: 'Terastodon', power: 9, trample: true },
    blocker: { name: 'Grizzly Bears', toughness: 3 },
  });
  
  gameState = dealCombatDamage(gameState);
  
  // 3 damage to blocker (lethal)
  // 6 damage to player (trample)
  expect(gameState.players['defender'].life).toBe(14);
});
```

### Double Strike Test
```typescript
it('should handle double strike', () => {
  const gameState = setupCombat({
    attacker: { name: 'Aurelia', doubleStrike: true },
    blocker: { name: 'Wall of Wood' },
  });
  
  // First strike damage
  gameState = firstStrikeDamageStep(gameState);
  
  // Regular damage
  gameState = regularDamageStep(gameState);
  
  // Aurelia dealt damage twice
});
```

---

## Related Issues

- #602 (Connect game engine to UI)
- #611 (Add integration tests)

---

## Rules References

- **CR 506:** Combat Phase
- **CR 507:** Beginning of Combat Step
- **CR 508:** Declare Attackers Step
- **CR 509:** Declare Blockers Step
- **CR 510:** Combat Damage Step
- **CR 511:** End of Combat Step
- **CR 702.4:** Double Strike
- **CR 702.7:** First Strike
- **CR 702.19:** Trample

---

## Implementation Order

1. **Day 1-2:** Add data structures, first strike/double strike
2. **Day 2-3:** Implement trample damage
3. **Day 3-4:** Implement multiple blocker ordering
4. **Day 4-5:** Write tests, fix bugs

---

## Testing Checklist

- [ ] First strike vs no first strike
- [ ] Double strike vs first strike
- [ ] Trample vs no blockers
- [ ] Trample vs one blocker
- [ ] Trample vs multiple blockers
- [ ] Multiple blockers on one attacker
- [ ] Deathtouch + trample interaction
- [ ] Indestructible vs lethal damage
- [ ] Regeneration in combat
