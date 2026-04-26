# Build Property-Based Rules Fuzzing Framework

**Priority:** 🟠 HIGH  
**Labels:** `high`, `testing`, `gameplay`, `engine`, `fuzzing`  
**Milestone:** v0.3.0 Engine Robustness  
**Estimated Effort:** 2–3 days  

---

## Description

After fixing the obvious bugs, we need to catch edge cases. Property-based testing generates random game states and actions, then verifies that MTG invariants always hold. This finds bugs that manual testing misses.

The project already has `property-based.test.ts` with basic tests. This issue extends it into a comprehensive fuzzing framework.

---

## Affected Files

- `src/lib/game-state/__tests__/property-based.test.ts`
- `src/lib/game-state/testing/` (new fuzzing utilities)
- `package.json` (verify `fast-check` is available)

---

## Game Invariants to Test

These should **always** be true, no matter what random valid actions are taken:

### Life & State
1. `player.life <= 0 → player.hasLost === true`
2. `player.poison >= 10 → player.hasLost === true`
3. `player.commanderDamage >= 21 → player.hasLost === true`

### Creatures
4. `creature.damageMarked >= creature.toughness → creature is in graveyard` (after SBA)
5. `creature.toughness <= 0 → creature is in graveyard` (after SBA)
6. `creature.hasSummoningSickness && !creature.hasHaste → cannot attack`

### Lands & Mana
7. `land.isTapped → cannot tap for mana again`
8. `player.landsPlayedThisTurn <= maxLandsPerTurn`
9. `manaPool is empty at start of each phase`
10. `only one land can be played per turn` (by default)

### Stack & Priority
11. `stack resolves in LIFO order`
12. `countered spell never resolves`
13. `only player with priority can cast spells/activate abilities`

### Combat
14. `tapped creature cannot attack` (unless vigilance)
15. `creature with defender cannot attack`
16. `blocked creature deals no damage to player` (unless trample)
17. `creature that attacked and survived is tapped` (unless vigilance)

### Zones
18. `card cannot be in multiple zones simultaneously`
19. `graveyard cards are face-up`
20. `library order is preserved` (except shuffle effects)

---

## Framework Design

### Arbitrary Generators

```typescript
// Generate random valid game states
const arbitraryGameState = fc.record({
  players: fc.array(arbitraryPlayer, { min: 2, max: 2 }),
  cards: fc.array(arbitraryCard),
  zones: arbitraryZones,
  turn: arbitraryTurn,
  stack: fc.array(arbitraryStackItem),
});

// Generate random valid actions
const arbitraryAction = fc.oneof(
  arbitraryPlayLand,
  arbitraryCastSpell,
  arbitraryActivateAbility,
  arbitraryDeclareAttacker,
  arbitraryDeclareBlocker,
  arbitraryPassPriority,
);
```

### Property Runner

```typescript
function assertInvariant(
  name: string,
  invariant: (state: GameState) => boolean
) {
  it(name, () => {
    fc.assert(
      fc.property(arbitraryGameState, arbitraryAction, (state, action) => {
        if (!isValidAction(state, action)) return true;
        const result = applyAction(state, action);
        return invariant(result.state);
      }),
      { numRuns: 1000 }
    );
  });
}
```

### Shrinking

`fast-check` automatically shrinks failing cases to minimal reproductions. When a property fails, output:
1. The minimal game state
2. The minimal action sequence
3. Which invariant was violated

---

## Acceptance Criteria

- [ ] All 20 invariants listed above are implemented as properties
- [ ] Each property runs at least 1000 random iterations
- [ ] Failing cases are automatically shrunk to minimal reproduction
- [ ] Output format includes state + action for reproduction
- [ ] Properties run in CI (can be configured with `numRuns: 100` for speed)
- [ ] Properties skip gracefully when no valid action exists for a state

---

## Example Property

```typescript
describe("Mana Invariants", () => {
  assertInvariant(
    "tapped land cannot be tapped again for mana",
    (state) => {
      for (const [cardId, card] of state.cards) {
        if (isLand(card) && card.isTapped && card.zone === "battlefield") {
          const result = activateManaAbility(state, card.controllerId, cardId, 0);
          if (result.success) return false;
        }
      }
      return true;
    }
  );
});
```

---

## Related Issues

- #616 (Static analysis — provides gap list to focus fuzzing)
- All other gameplay issues — fuzzing validates fixes
