# Implementation Plan: Hand Targeting for Duress-Style Cards

## Problem Statement

**Duress**, **Thoughtseize**, **Inquisition of Kozilek**, and similar cards allow a player to look at and pick a card from an opponent's hand. The current game engine targeting system only supports battlefield permanents (creatures, artifacts, enchantments), not cards in hand.

---

## Phase 1: Type System Extensions

### 1.1 Add Target Zone Types

**File**: `src/types/card-interactions.ts`

```typescript
// Add new targetType options
export type SelectedTarget = {
  targetId: string;
  targetType: "card" | "player" | "stack" | "zone" | "hand_card"; // NEW
  playerId?: PlayerId;
  zoneOwnerId?: PlayerId; // NEW: whose hand contains the card
};

// Extend TargetRequirement
export interface TargetRequirement {
  minTargets: number;
  maxTargets: number;
  validTargetTypes: (
    | "creature" | "artifact" | "enchantment" | "instant" | "sorcery"
    | "player" | "plane" | "planeswalker" | "battle"
    | "nonland" | "creature_or_planeswalker" // NEW filter types
  )[];
  canTargetSelf: boolean;
  targetZone?: "battlefield" | "hand" | "graveyard" | "library" | "any"; // NEW
  rules?: string;
}
```

### 1.2 New Targeting State Properties

**File**: `src/types/card-interactions.ts`

```typescript
export interface TargetingState {
  isActive: boolean;
  sourceCardId: CardInstanceId | null;
  sourceAbilityId: StackObjectId | null;
  selectedTargets: SelectedTarget[];
  maxTargets: number;
  minTargets: number;
  validTargetTypes: string[];
  canTargetPlayer: boolean;
  // NEW FIELDS:
  targetZone: "battlefield" | "hand" | "graveyard" | "library";
  targetPlayerId: PlayerId | null; // whose hand we're targeting
  revealedCards: CardInstanceId[]; // temporarily revealed hand cards
}
```

---

## Phase 2: Hand Card Selection UI

### 2.1 Extend TargetingOverlay

**File**: `src/components/targeting-overlay.tsx`

**Changes needed**:
- Add `targetZone` prop support
- Add `targetPlayerId` prop 
- Add `revealedCards` prop
- New render mode for hand card selection (shows revealed cards with names/types)
- Filter validation for "nonland", "creature_or_planeswalker"

```typescript
interface TargetingOverlayProps {
  // ... existing props
  // NEW:
  targetZone?: "battlefield" | "hand";
  targetPlayerId?: PlayerId;
  opponentHandCards?: HandCardDisplay[]; // Cards in target player's hand
  revealedForTargeting?: string[]; // Card IDs revealed for targeting
}

interface HandCardDisplay {
  cardId: string;
  name: string;
  types: string[];
  cmc: number;
  manaCost?: string;
  oracleText?: string;
  isRevealed: boolean; // true during targeting
}
```

### 2.2 Hand Card Selection Component

**New File**: `src/components/hand-targeting-cards.tsx`

```typescript
interface HandTargetingCardsProps {
  playerId: PlayerId; // whose hand
  targetRequirements: TargetRequirement;
  selectedCardIds: string[];
  onCardSelect: (cardId: string) => void;
  isOpponentHand: boolean;
}

/**
 * Renders opponent hand cards as selectable targets during targeting mode.
 * 
 * Key behaviors:
 * - Cards are face-down (card back) unless revealed by effect
 * - During targeting, reveals cards matching filter (e.g., nonland for Thoughtseize)
 * - Click to select as target
 * - Selected cards show highlight ring
 */
```

### 2.3 Extend HandDisplay for Targeting

**File**: `src/components/hand-display.tsx`

**Changes**:
- Add click handler prop for targeting selection
- Add prop to show cards as "selectable" (with click handler)
- Support "targeting mode" visual state (highlight valid targets)

```typescript
interface HandDisplayProps {
  // ... existing props
  // NEW:
  targetingActive?: boolean;
  selectableCardIds?: string[];
  onCardClickForTargeting?: (cardId: string) => void;
  targetRequirements?: TargetRequirement;
}
```

---

## Phase 3: Game State Integration

### 3.1 Hand Targeting Action

**File**: `src/hooks/use-card-interactions.ts`

**Add**:
```typescript
// New function to start targeting in opponent's hand
const startHandTargeting = useCallback((
  sourceCardId: CardInstanceId,
  targetPlayerId: PlayerId,
  requirements: {
    minTargets: number;
    maxTargets: number;
    filter: "nonland" | "creature" | "any";
  }
) => {
  setTargetingState({
    isActive: true,
    sourceCardId,
    sourceAbilityId: null,
    selectedTargets: [],
    maxTargets: requirements.maxTargets,
    minTargets: requirements.minTargets,
    validTargetTypes: [requirements.filter],
    canTargetPlayer: false,
    targetZone: "hand",
    targetPlayerId,
    revealedCards: [],
  });
}, [...]);
```

### 3.2 Card Effect Resolution for Hand Targeting

**New File**: `src/lib/game-state/hand-targeting.ts`

```typescript
/**
 * Initiates hand targeting (Duress/Thoughtseize style)
 */
export function initiateHandTargeting(
  gameState: GameState,
  sourceCardId: CardInstanceId,
  targetPlayerId: PlayerId,
  targetingFilter: CardFilter
): HandTargetingResult;

interface HandTargetingResult {
  success: boolean;
  revealedCards: CardInstanceId[];
  targetableCardIds: string[];
}

export function resolveHandTarget(
  gameState: GameState,
  selectedCardId: CardInstanceId,
  sourceCardId: CardInstanceId
): GameState;
```

### 3.3 Update Card Effect Registry

**File**: `src/lib/game-state/keyword-actions.ts`

**Add card effect handlers** for:
- `Duress`: target noncreature, nonland, nonplaneswalker in hand
- `Thoughtseize`: target nonland in hand  
- `Inquisition of Kozilek`: target creature or planeswalker in hand

---

## Phase 4: Card Filter Logic

### 4.1 Hand Card Filter

**File**: `src/lib/game-state/hand-card-filter.ts`

```typescript
export type HandCardFilter = 
  | "any"
  | "nonland"
  | "creature" 
  | "planeswalker"
  | "creature_or_planeswalker"
  | "artifact"
  | "enchantment"
  | "instant_or_sorcery";

/**
 * Returns hand cards matching the filter
 */
export function filterHandCards(
  hand: CardInstance[],
  filter: HandCardFilter
): CardInstance[] {
  // Implementation for each filter type
}
```

### 4.2 Oracle Text Parser Update

**File**: `src/lib/game-state/oracle-text-parser.ts`

**Add parsing rules** for:
- "target card in opponent's hand"
- "you may target a nonland card in hand"
- "target creature or planeswalker in an opponent's hand"

---

## Implementation Order

### Phase 1: Types (Low Risk)
1. Add zone types to TargetingState
2. Add filter types to TargetRequirement
3. Add hand targeting state properties

**Dependent on**: Nothing

### Phase 2: UI Components (Medium Risk)  
1. Extend TargetingOverlay with targetZone prop
2. Create HandTargetingCards component
3. Update HandDisplay with targeting selection

**Dependent on**: Phase 1

### Phase 3: Game State (High Risk)
1. Create hand-targeting.ts action module
2. Update use-card-interactions hook
3. Add card effect handlers for Duress-style cards

**Dependent on**: Phases 1 & 2

### Phase 4: Integration & Testing (High Risk)
1. Update oracle text parser
2. Add test cases for each card type
3. Integration testing

**Dependent on**: Phases 1-3

---

## Test Cases to Implement

```typescript
// hand-targeting.test.ts
describe("Duress-style hand targeting", () => {
  it("reveals opponent's hand with nonland cards for Thoughtseize");
  it("allows selecting a nonland card as target");
  it("resolves target card to exile zone");
  it("maintains opponent hand confidentiality for non-targeting cards");
  
  it("filters correctly for Duress (noncreature, nonland, nonplaneswalker)");
  it("filters correctly for Inquisition (creature or planeswalker)");
  it("filters correctly for Thoughtseize (nonland)");
});
```

---

## File Summary

| File | Action | Risk |
|------|--------|------|
| `src/types/card-interactions.ts` | Modify - Add zone types | LOW |
| `src/components/targeting-overlay.tsx` | Modify - Hand zone support | MEDIUM |
| `src/components/hand-targeting-cards.tsx` | **NEW** | MEDIUM |
| `src/components/hand-display.tsx` | Modify - Targeting selection | MEDIUM |
| `src/hooks/use-card-interactions.ts` | Modify - Hand targeting fn | MEDIUM |
| `src/lib/game-state/hand-targeting.ts` | **NEW** | HIGH |
| `src/lib/game-state/keyword-actions.ts` | Modify - Hand effect handlers | HIGH |
| `src/lib/game-state/hand-card-filter.ts` | **NEW** | MEDIUM |
| `src/lib/game-state/oracle-text-parser.ts` | Modify - Hand targeting parser | HIGH |