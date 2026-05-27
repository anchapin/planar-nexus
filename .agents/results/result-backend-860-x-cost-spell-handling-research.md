# Research Summary: X-Cost Spell Handling (Issue #860)

## Status: Implementation Exists - Gaps Identified

## Overview

X-cost spells (e.g., "Fireball deals X damage", "Draw X cards") are **partially implemented** in the codebase. The core flow for **spell casting** works correctly, but **activated abilities with X costs** are not handled.

---

## Current Implementation State

### 1. X-Cost Parsing

**File:** `src/lib/game-state/oracle-text-parser.ts:1435-1465`

```typescript
export function parseXCost(
  card: ScryfallCard,
  availableMana: number = 10,
): XCostInfo;
```

- Detects `{X}` in `mana_cost`
- Calculates `maxX = availableMana - otherCosts`
- Extracts description from oracle text using regex: `/(create|deal|draw|put|add|remove|choose)\s+(x|a\s+x|x\s+[a-z]+)/i`

**Gap:** Description regex only matches specific verbs. Cards using different phrasing may get generic "Choose a value for X".

### 2. UI X-Value Selection

**File:** `src/app/(app)/game/[id]/page.tsx:1691-1702`

- Detects X-cost via `parseXCost`
- Opens `xCostChoice` dialog for player to select X (lines 3578-3651)
- Validates X ≤ `maxX`
- Calls `castSpell` with selected `xValue`

### 3. Spell Casting with X

**File:** `src/lib/game-state/spell-casting.ts:217-443`

```typescript
export function castSpell(..., xValue: number = 0, ...): { success: boolean; state: GameState; error?: string }
```

- Line 308: `let totalGeneric = manaCost.generic + xValue;`
- Line 443: `variableValues: new Map([["X", xValue]])` - stored on StackObject
- Mana spending handles X correctly

### 4. Effect Resolution with X

**File:** `src/lib/game-state/effect-resolution.ts:311-443`

```typescript
export function parseSpellEffects(
  oracleText: string,
  variableValues?: Map<string, number>,
): StackEffect[];
```

X is consumed for these effect types:

- **Card draw** (line 332): `xValue !== undefined ? xValue : amount`
- **Life gain** (line 353): `xValue !== undefined ? xValue : amount`
- **Life loss** (line 374): `xValue !== undefined ? xValue : amount`
- **Damage** (line 418): `"deal x damage"` uses `variableValues?.get("X") ?? 0`

### 5. AI X-Value Decision

**File:** `src/ai/stack-interaction-ai.ts:2577-2611`

```typescript
): { xValue?: number; shouldKick?: boolean; recommendedCost: number }
```

- AI calculates X based on `threatLevel * 5` and available extra mana

---

## Files Involved with Line References

| File                                       | Lines                           | Purpose                                            |
| ------------------------------------------ | ------------------------------- | -------------------------------------------------- |
| `src/lib/game-state/oracle-text-parser.ts` | 1435-1465                       | `parseXCost()` function                            |
| `src/app/(app)/game/[id]/page.tsx`         | 1691-1702, 2403-2445, 3578-3651 | X-cost UI dialog                                   |
| `src/lib/game-state/spell-casting.ts`      | 217-443                         | `castSpell()` with xValue                          |
| `src/lib/game-state/effect-resolution.ts`  | 311-443                         | `parseSpellEffects()` consumes X                   |
| `src/lib/game-state/mana.ts`               | 928-950                         | `getSpellManaCost()` handles X separately          |
| `src/lib/game-state/types.ts`              | 374, 486                        | `StackObject.variableValues`, `StackObject.xValue` |
| `src/ai/ai-action-executor.ts`             | 48, 96, 176, 200, 206           | AI xValue handling                                 |
| `src/ai/stack-interaction-ai.ts`           | 2577-2611                       | AI X value decision logic                          |

### Test Coverage

- `src/lib/game-state/__tests__/spell-casting.test.ts:398-427` - X spell casting test (Fireball)
- `src/lib/game-state/__tests__/oracle-text-parser.test.ts:571-624` - `parseXCost` tests
- `src/lib/game-state/__tests__/effect-resolution.test.ts:599-608` - X in effect parsing

---

## Gaps Identified

### GAP 1: Activated Abilities with X Costs

**Severity:** Medium

Activated abilities that require X mana (e.g., cards with "{X}" ability costs) are **not handled**.

**Affected Function:** `activateAbility` (`abilities.ts:253`)

```typescript
export function activateAbility(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  abilityIndex: number,
  targets: { type: string; targetId: string }[] = [],
): ActivateAbilityResult;
```

- No `xValue` parameter
- Line 434: `variableValues: new Map()` is hardcoded empty
- Mana cost parsing in `parseManaFromAbilityCost` doesn't handle X

**Example cards affected:**

- "Desperate Ritual" - {R}, put X mana into pool (actually not X cost)
- "Mogg Infestation" - {3}{R}{R}, create X 1/1 tokens (actually not X cost)
- Cards like "Banefire" with {X} in mana cost for abilities

### GAP 2: X Value in Oracle Description Extraction

**Severity:** Low

The regex in `parseXCost` for extracting X description only matches:

```typescript
/(?:create|deal|draw|put|add|remove|choose)\s+(?:x|a\s+x|x\s+[a-z]+)/i;
```

Some X-cost cards may have different phrasing and get generic "Choose a value for X" description.

### GAP 3: Comprehensive X Pattern Matching in Resolution

**Severity:** Low

`parseSpellEffects` only handles X for specific effect types. If an X-cost spell has effects not in this list, X may not be applied correctly:

- card_draw ✓
- life_gain ✓
- life_loss ✓
- damage ✓
- Others (token creation, etc.) - X not applied even if spelled as "Create X tokens"

---

## Recommendations

### For Spells (Current Implementation - Works)

The spell casting flow is **complete and functional**:

1. UI prompts for X value ✓
2. X validated against maxX ✓
3. X stored on StackObject.variableValues ✓
4. parseSpellEffects consumes X correctly ✓

### For Activated Abilities (Needs Implementation)

To fix GAP 1, these changes needed:

1. **Add xValue parameter to `activateAbility`**:

   ```typescript
   export function activateAbility(
     ...,
     xValue: number = 0,
   ): ActivateAbilityResult
   ```

2. **Parse X cost from activated abilities** in `getActivatedAbilities` / `parseManaFromAbilityCost`

3. **Store X in variableValues** on ability StackObject:

   ```typescript
   variableValues: new Map([["X", xValue]]),
   ```

4. **Update UI** to prompt for X when activating abilities with X costs

### Design Decision Needed

- Should activated abilities with X costs be triggered similarly to X-cost spells?
- Should the AI's `stack-interaction-ai.ts` be updated to handle X in abilities?

---

## Test X-Cost Cards

From the codebase:

- **Fireball** (`spell-casting.test.ts:401`) - `{X}{R}`, "Fireball deals X damage to any target"
- **Generic X spells** tested in `oracle-text-parser.test.ts:572-624`

---

## Conclusion

**Can be implemented:** Yes, spell casting with X costs works correctly.

**Needs design decisions:** Activated abilities with X costs require additional work to:

1. Parse X from ability costs
2. Add UI prompting for X on ability activation
3. Pass X value through activateAbility → stack → resolution

The core X-cost spell handling infrastructure (parseXCost, xCostChoice UI, castSpell with xValue, variableValues on stack, parseSpellEffects consuming X) is **sound architecture** following the Repository/Service/Router pattern with proper separation of concerns.
