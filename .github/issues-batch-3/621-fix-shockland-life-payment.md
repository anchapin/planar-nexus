# Fix Shockland Life Payment & ETB Cleanup

**Priority:** 🟡 MEDIUM  
**Labels:** `medium`, `gameplay`, `engine`, `rules`, `lands`  
**Milestone:** v0.2.0 Game Rules  
**Estimated Effort:** < 1 day  

---

## Description

Two related issues with shockland and conditional ETB tapped lands:

1. **Life payment is implemented as damage** — `handleShocklandPayLife` calls `dealDamageToPlayer(..., 2)`. Shockland payment is life **loss**, not damage. It should not interact with damage prevention, "when dealt damage" triggers, or lifelink.

2. **Conditional ETB auto-tap is heuristic-based** — We recently fixed shocklands by checking for "unless" / "may pay" / "if you don't", but similar conditional ETB effects (fastlands, checklands) may still have edge cases.

---

## Affected Files

- `src/app/(app)/game/[id]/page.tsx` (`handleShocklandPayLife`)
- `src/lib/game-state/mana.ts` (`playLand` auto-tap logic)
- `src/lib/game-state/player.ts` or `game-state.ts` (add `loseLife`)
- `src/lib/game-state/__tests__/mana.test.ts`

---

## Fix 1: Add `loseLife` Function

Create a new function distinct from `dealDamageToPlayer`:

```typescript
export function loseLife(
  state: GameState,
  playerId: PlayerId,
  amount: number,
  sourceCardId?: CardInstanceId
): GameState {
  const player = state.players.get(playerId);
  if (!player) return state;

  const updatedPlayers = new Map(state.players);
  updatedPlayers.set(playerId, {
    ...player,
    life: player.life - amount,
  });

  return {
    ...state,
    players: updatedPlayers,
    lastModifiedAt: Date.now(),
  };
}
```

**Key difference from damage:**
- No damage prevention can apply
- Does not trigger "when dealt damage" abilities
- Cannot be redirected
- Not affected by lifelink, infect, etc.

### Update Shockland Handler

```typescript
// page.tsx
newState = loseLife(
  newState,
  player.id,
  2,
  shocklandChoice.cardId,
);
```

---

## Fix 2: Verify Conditional ETB Coverage

Ensure `playLand` correctly handles all conditional ETB patterns:

| Land Type | Pattern | Should Auto-Tap? |
|-----------|---------|------------------|
| Basic tapland | "enters tapped" | ✅ Yes |
| Shockland | "may pay 2 life... enters tapped" | ❌ No |
| Fastland | "enters tapped unless..." | ❌ No |
| Checkland | "enters tapped unless..." | ❌ No |
| Pathway | "enters tapped" (one side) | ✅ Yes |
| MDFC land | "enters tapped" (land side) | ✅ Yes |

Add unit tests for each pattern.

---

## Acceptance Criteria

- [ ] `loseLife` function exists and is separate from damage
- [ ] Shockland payment uses `loseLife`, not `dealDamageToPlayer`
- [ ] Unit test: shockland payment does not count as damage
- [ ] Unit test: basic taplands still auto-tap
- [ ] Unit test: shocklands do not auto-tap
- [ ] Unit test: fastlands do not auto-tap
- [ ] Unit test: checklands do not auto-tap

---

## Test Cases

```typescript
it("should use loseLife for shockland payment (not damage)", () => {
  const state = playShocklandPayLife(overgrownTombId);
  // Player life should decrease by 2
  // No damage marked on player
  // No "dealt damage" triggers
});

it("should not prevent shockland life loss with damage prevention", () => {
  // Give player damage prevention shield
  // Pay shockland life
  // Life still decreases by 2
});
```

---

## Related Issues

- #619 (Mana system fixes)
- #616 (Static analysis — gap detection)
