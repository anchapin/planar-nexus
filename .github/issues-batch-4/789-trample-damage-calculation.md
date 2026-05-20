# Fix Issue #789 - Trample Damage Calculation Incomplete

**Priority:** 🟡 MEDIUM  
**Labels:** `bug`, `gameplay`, `engine`, `combat`, `rules`  
**Milestone:** v0.2.0 Game Rules  
**Estimated Effort:** 1 day  
**PR:** #789

---

## Description

Trample damage calculation doesn't properly account for damage already assigned to blockers when determining excess damage.

**Per CR 702.19b**: When a creature with trample is blocked, the attacker assigns lethal damage to the blocker first. Only the REMAINING damage (after subtracting damage assigned to blocker) can trample through to the defending player/planeswalker.

### Example

A 5/5 with trample blocked by a 2/2:

- 2 damage assigned to blocker (lethal)
- 3 excess damage tramples through to player (5-2=3)

---

## Root Cause

The combat damage resolution in `combat.ts` correctly calculates `remainingDamage` after dealing to blockers. The issue was a lack of comprehensive test coverage to verify CR 702.19b compliance across multiple scenarios.

---

## Fix

1. Added comprehensive test cases for trample damage calculation per CR 702.19b
2. Tests verify:
   - 5/5 trample blocked by 2/2 → 3 excess tramples through (5-2=3)
   - 3/3 trample blocked by 3/3 → 0 excess (all damage absorbed by blocker)
   - 4/4 trample blocked by 1/1 → 3 excess (4-1=3)
   - Deathtouch + trample with multiple blockers

---

## Affected Files

- `src/lib/game-state/__tests__/combat.test.ts` (tests added)

---

## Test Cases Added

```typescript
it(
  "should handle trample damage correctly - 5/5 trample blocked by 2/2 (CR 702.19b)",
);
it(
  "should handle trample when blocker has enough toughness to survive - 3/3 blocked by 3/3 (0 excess)",
);
it("should handle trample with overkill - 4/4 blocked by 1/1 (3 excess)");
it(
  "should handle trample with deathtouch - 5/5 deathtouch trampler blocked by 2/2 and 3/3",
);
```

---

## Acceptance Criteria

- [x] Verify trample calculation matches CR 702.19b
- [x] Add test: 5/5 trample blocked by 2/2 should deal exactly 5 total (2 to blocker, 3 tramples through)
- [x] Add test: 3/3 trample blocked by 3/3 (0 excess)
- [x] Add test: 4/4 trample blocked by 1/1 (3 excess)
- [x] Add test: deathtouch + trample with multiple blockers

---

## Rules Reference

- **CR 702.19b:** Trample — The rest of the damage is dealt to the defending player/planeswalker
- **CR 702.2b:** Deathtouch — Any nonzero amount of damage is lethal

---

## Related Issues

- #627 (Trample blocker ordering — follow-up)
- #626 (First strike / double strike)
- #614 (Complete combat system)
