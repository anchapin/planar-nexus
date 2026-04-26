# Create Standard Mechanic E2E Functionality Tests

**Priority:** 🔴 CRITICAL  
**Labels:** `critical`, `testing`, `e2e`, `standard`, `gameplay`  
**Milestone:** v0.2.0 Game Rules  
**Estimated Effort:** 4–6 days  

---

## Description

Current `e2e/standard-mechanics.spec.ts` only verifies that mechanic cards are **visible in hand**. This is "presence testing" — it doesn't test whether the mechanics actually work.

We need E2E tests that **exercise each mechanic in actual gameplay**. These tests will reveal which mechanics are broken, stubbed, or missing.

---

## Affected Files

- `e2e/standard-mechanics.spec.ts` (current — only presence tests)
- `e2e/fixtures/test-cards.json` (may need new test cards)
- `src/app/(app)/game/[id]/page.tsx` (UI hooks for testing)

---

## Test Matrix

| Mechanic | Card(s) Needed | Test Scenario | Priority |
|----------|---------------|---------------|----------|
| **Cycling** | Cycling Drake | Click card → choose "Cycle" → discard → draw | High |
| **Flashback** | Flashback Bolt | Cast from graveyard → spell resolves → card exiled | High |
| **Convoke** | Convoke Angel | Cast with convoke → tap creatures → cost reduced | High |
| **Ward** | Ward Beetle | Target with spell → pay {2} or fizzle | High |
| **Explore** | Explore Ranger | Cast → reveal top → if land, play; else +1/+1 | Medium |
| **Surveil** | Surveil Scout | Cast → look at top 2 → choose mill/bottom for each | Medium |
| **Investigate** | Investigate Mage | Cast → create Clue token → sac to draw | Medium |
| **Disguise** | Disguised Agent | Cast face-down → flip for cost | Medium |
| **Plot** | Plotting Goblin | Exile → cast from exile on later turn | Medium |
| **Offspring** | Offspring Beast | Pay extra → create 1/1 copy token | Medium |
| **Saddle** | Saddle Horse | Tap creatures → saddle → enable attack | Medium |
| **Food** | Food Maker | Create Food token → sac for life | Low |
| **Treasure** | Treasure Hoard | Create Treasure token → sac for mana | Low |
| **Learn** | Learn Spell | Choose: draw or fetch Lesson | Low |
| **Valiant** | Valiant Knight | Targeted → trigger buff | Low |
| **Bargain** | Bargain Elf | Sac artifact/enchantment → upgrade spell | Low |
| **Backup** | Backup Soldier | ETB distribute +1/+1 counters | Low |
| **Incubate** | Incubate Drone | Create Incubator → transform for {2} | Low |

---

## Test Template

Each mechanic test follows this pattern:

```typescript
test("[Mechanic]: [scenario]", async ({ page }) => {
  // 1. Start game with test deck containing mechanic card
  await startGameWithDeck(page, "starter-test");

  // 2. Verify card is in hand
  const card = page.locator('[data-testid="hand-card"]').filter({ hasText: "CardName" });
  await expect(card).toBeVisible();

  // 3. Perform mechanic action
  await card.click();
  // ... mechanic-specific interactions ...

  // 4. Verify expected outcome
  // ... assertions ...
});
```

---

## Priority Order

### Phase 1: Core Mechanics (High Priority)
Do these first — they appear frequently in Standard and are fundamental:

1. **Ward** — Targeting is core to spell casting
2. **Cycling** — Card filtering is fundamental
3. **Flashback** — Graveyard interaction is fundamental
4. **Convoke** — Cost reduction affects mana system
5. **Explore** — Library interaction is fundamental

### Phase 2: Secondary Mechanics (Medium Priority)
6. Surveil
7. Investigate
8. Disguise
9. Plot
10. Offspring

### Phase 3: Tertiary Mechanics (Lower Priority)
11. Saddle
12. Food
13. Treasure
14. Learn
15. Valiant
16. Bargain
17. Backup
18. Incubate

---

## Acceptance Criteria

### Phase 1
- [ ] Ward E2E test passes
- [ ] Cycling E2E test passes
- [ ] Flashback E2E test passes
- [ ] Convoke E2E test passes
- [ ] Explore E2E test passes

### Phase 2
- [ ] Surveil E2E test passes
- [ ] Investigate E2E test passes
- [ ] Disguise E2E test passes
- [ ] Plot E2E test passes
- [ ] Offspring E2E test passes

### Phase 3
- [ ] Remaining 8 mechanics have E2E tests
- [ ] All tests document expected vs actual behavior
- [ ] Failing tests are marked with `test.fixme` and link to the implementation issue

---

## Handling Unimplemented Mechanics

If a mechanic is not yet implemented:
1. Write the test anyway
2. Mark it `test.fixme("Mechanic not yet implemented — see #628")`
3. The test documents the expected behavior for when it IS implemented

---

## Example: Ward Test

```typescript
test("Ward: targeting requires payment or fizzles", async ({ page }) => {
  await startGameWithDeck(page, "starter-test");

  // Verify Ward Beetle is on battlefield
  const beetle = page.locator('[data-testid="battlefield-card"]').filter({ hasText: "Ward Beetle" });
  await expect(beetle).toBeVisible();

  // Cast a spell targeting Ward Beetle
  const bolt = page.locator('[data-testid="hand-card"]').filter({ hasText: "Lightning Bolt" });
  await bolt.click();
  await beetle.click(); // Target it

  // Should see Ward payment dialog
  const wardDialog = page.locator('[data-testid="ward-payment-dialog"]');
  await expect(wardDialog).toBeVisible();

  // Choose not to pay
  await page.click('text=Decline');

  // Spell should fizzle, Beetle should survive
  await expect(beetle).toBeVisible();
  const stack = page.locator('[data-testid="stack-count"]');
  await expect(stack).toHaveText("0");
});
```

---

## Related Issues

- #628 (Standard mechanic stubs — provides toast/handling for unimplemented mechanics)
- #617 (Oracle text audit — tells us which cards to test)
