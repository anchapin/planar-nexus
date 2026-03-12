# Unify GameState Type Definitions

**Priority:** 🔴 CRITICAL  
**Labels:** `critical`, `typescript`, `refactor`, `technical-debt`  
**Milestone:** v0.2.0 Architecture  
**Estimated Effort:** 3-4 days

---

## Description

Two **incompatible** `GameState` type definitions exist in the codebase:

1. **`src/types/game.ts`** - Used by UI components
2. **`src/lib/game-state/types.ts`** - Used by game engine

This creates:
- Maintenance burden (changes must be made in two places)
- Potential for bugs during conversion
- Compromised type safety
- Manual conversion functions throughout codebase

---

## Evidence of Type Duplication

### UI GameState (src/types/game.ts)
```typescript
export interface GameState {
  id: string;
  players: PlayerState[];
  currentTurnIndex: number;
  phase: Phase;
  // ... UI-focused fields
}

export interface PlayerState {
  id: string;
  name: string;
  life: number;
  hand: CardState[];
  battlefield: CardState[];
  // ...
}
```

### Engine GameState (src/lib/game-state/types.ts)
```typescript
export interface GameState {
  id: string;
  players: Record<PlayerId, Player>;
  zones: Record<ZoneId, Zone>;
  stack: StackObject[];
  turn: Turn;
  // ... Engine-focused fields
}

export interface Player {
  id: PlayerId;
  name: string;
  life: number;
  zones: PlayerZones;
  // ...
}
```

### Manual Conversion Required (src/app/(app)/game/[id]/page.tsx:129-176)
```typescript
// ❌ Manual conversion function needed
function convertToAIGameState(gameState: GameState): AIGameState {
  return {
    players: {
      player1: {
        life: gameState.players[0].life,
        hand: gameState.players[0].hand.map(convertCard),
        // ... manual field-by-field conversion
      },
      player2: {
        // ...
      }
    },
    // ...
  };
}
```

---

## Required Changes

### Option A: Unify Types (Recommended)

#### Step 1: Choose Single Source of Truth
Use `src/lib/game-state/types.ts` as the canonical GameState type since:
- It's more complete
- It's tested
- It's the actual game engine

#### Step 2: Update UI Components
```typescript
// ❌ Before
import type { GameState } from '@/types/game';

// ✅ After
import type { GameState } from '@/lib/game-state/types';
```

#### Step 3: Update UI-Focused Fields
Add UI-specific fields to engine types if needed:
```typescript
// src/lib/game-state/types.ts
export interface GameState {
  // Engine fields
  id: string;
  players: Record<PlayerId, Player>;
  zones: Record<ZoneId, Zone>;
  
  // UI fields (add these)
  isGameOver?: boolean;
  winnerId?: PlayerId;
  hasActiveDrawOffer?: boolean;
  // ...
}
```

#### Step 4: Remove Duplicate Types
- [ ] Delete `src/types/game.ts`
- [ ] Update all imports to use engine types
- [ ] Remove conversion functions

### Option B: Create Proper Conversion Utilities

If unification is not feasible, create robust conversion:

#### Step 1: Create Conversion Module
```typescript
// src/lib/game-state/conversion.ts
export function engineToUIGameState(engine: EngineGameState): UIGameState {
  // Properly typed conversion
}

export function uiToEngineGameState(ui: UIGameState): EngineGameState {
  // Properly typed conversion
}
```

#### Step 2: Add Type Guards
```typescript
export function isEngineGameState(state: any): state is EngineGameState {
  return 'zones' in state && 'stack' in state;
}
```

#### Step 3: Add Tests
```typescript
describe('GameState Conversion', () => {
  it('should convert engine to UI state', () => {
    const engine = createTestEngineState();
    const ui = engineToUIGameState(engine);
    expect(ui.players).toHaveLength(2);
  });
  
  it('should round-trip convert', () => {
    const original = createTestEngineState();
    const ui = engineToUIGameState(original);
    const back = uiToEngineGameState(ui);
    expect(back).toEqual(original);
  });
});
```

---

## Files to Update

### Imports to Change
- [ ] `src/app/(app)/game/[id]/page.tsx`
- [ ] `src/app/(app)/game-board/page.tsx`
- [ ] `src/components/game-board.tsx`
- [ ] `src/components/hand-display.tsx`
- [ ] `src/hooks/use-game-state.ts`
- [ ] `src/hooks/use-state-sync.ts`
- [ ] `src/lib/saved-games.ts`
- [ ] `src/lib/replay-sharing.ts`
- [ ] All other files importing GameState

### Conversion Functions to Remove
- [ ] `convertToAIGameState()` in `src/app/(app)/game/[id]/page.tsx`
- [ ] Any other manual conversion functions

---

## Acceptance Criteria

- [ ] **Single** GameState type used throughout codebase
- [ ] **No** manual conversion functions needed
- [ ] **All** existing tests pass
- [ ] **Type checking** passes with no errors
- [ ] **No** runtime errors from type mismatches
- [ ] **Documentation** updated to reflect single type

---

## Testing Strategy

### Type Checking
```bash
npm run typecheck
# Should pass with no errors
```

### Runtime Testing
```bash
npm test
# All 726 tests should pass
```

### Integration Testing
1. Start a game
2. Play cards
3. Verify state updates correctly
4. Verify no type errors in console

---

## Risks and Mitigation

### Risk: Breaking Changes
**Mitigation:** Update all imports in single PR, test thoroughly

### Risk: Missing Fields
**Mitigation:** Add UI fields to engine types as needed

### Risk: Bundle Size
**Mitigation:** Tree-shaking should remove unused types

---

## Related Issues

- #516 (Add TypeScript types to AI flows)
- #565 (Enforce strict typing)
- #602 (Connect game engine to UI)

---

## Recommendation

**Use Option A (Unify Types)**. The benefits are:
- Simpler codebase
- No conversion overhead
- Single source of truth
- Easier to maintain
- Better type safety

The short-term effort is higher but long-term maintenance is significantly reduced.
