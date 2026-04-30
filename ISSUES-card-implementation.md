# Card Implementation Issues - Standard Format

## Issue 1: Modal Spell Choice Handling (choose_mode)
**Priority:** High
**Problem:** Modal spells (cards with multiple modes) require a "choose_mode" waiting choice type that's not implemented.

**Cards affected:**
- Valiant Veteran (SLL)
- Sunfall
- Endless Punishment
- Chandra, Torch of Defiance
- Kaya, Intangible Slayer

**Implementation plan:**
1. Add ModeChoiceDialog component similar to CardChoiceDialog
2. Create handler in spell-casting.ts for resolveWaitingChoice with type "choose_mode"
3. Wire into game-board page with useEffect

**Waiting choice structure:**
```typescript
type: "choose_mode"
// choices: [{ label: "Deal 3 damage", value: 0, isValid: true }, ...]
// minChoices: 1, maxChoices: 1
```

---

## Issue 2: X Value Selection (choose_value)
**Priority:** High
**Problem:** Cards with variable X costs require an X value to be chosen before casting.

**Cards affected:**
- Hydroid Krasis (X = how much life you gain)
- Explosive Vegetation (X = number of lands)
- Serpentine (X = power)
- Craterize (X = number of lands destroyed)

**Implementation plan:**
1. Create XValueInputDialog component
2. Validate X value bounds (min/max from card or mana available)
3. Handle in resolveWaitingChoice for type "choose_value"

---

## Issue 3: Board Sweeper Verification
**Priority:** Medium
**Problem:** Board sweeper spells may have bugs in targeting or destruction logic.

**Cards to test:**
- Supreme Verdict (destroy all creatures - can't be countered)
- Wrath of God
- Sunfall
- Cleansing Nova
- Farewell

**Test scenarios:**
1. Cast sweeper with creatures on battlefield - verify all destroyed
2. Cast sweeper with indestructible creatures
3. Verify sweeper can't be countered (Split Second)
4. Test with protection effects

---

## Issue 4: Planeswalker Loyalty Abilities
**Priority:** Medium
**Problem:** Planeswalker loyalty abilities need proper activation targeting.

**Cards to test:**
- Chandra, Torch of Defiance
- Kaya, Intangible Slayer
- Nahiri, the Unforgiving

**Key mechanics:**
- Damage to planeswalker reduces loyalty (CR 119.3c)
- Abilities target creatures/players/planeswalkers

---

## Issue 5: Token Generation
**Priority:** Medium
**Problem:** Token generation from triggered abilities may not work correctly.

**Cards to test:**
- Fable of the Mirror-Breaker
- Dragonic Lava Axe

**Test scenarios:**
1. Trigger ability - verify token appears
2. Verify token characteristics (P/T, colors, types)
3. Test tokens with "when dies" triggers

---

## Issue 6: Damage Spell Target Validation
**Priority:** High
**Problem:** Damage spells need proper target validation.

**Cards to test:**
- Lightning Bolt (3 damage to any target)
- Lightning Strike
- Shock
- Fire Prophecy

**Target rules:**
- CAN target: players, creatures, planeswalkers, battles
- CANNOT target: lands, artifacts (unless creatures)

---

## Existing Working Implementation
- **Hand targeting (Duress, Thoughtseize, Inquisition):** IMPLEMENTED ✓
- Damage dealing to players/creatures
- Zone movement (hand, battlefield, graveyard, library, stack)
- Basic spell casting on stack

## Known Gaps
1. Cycling mechanic - stubbed, not implemented
2. Ward mechanic - stubbed, not implemented
3. Combat blocking resolution - may need work
4. Split cards - limited parsing
5. Modal cards - not implemented
6. X cost selection - not implemented
