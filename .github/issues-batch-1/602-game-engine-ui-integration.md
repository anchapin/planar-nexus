# Critical - Connect Game Engine to UI for Playable Gameplay

**Priority:** 🔴 CRITICAL  
**Labels:** `critical`, `gameplay`, `ui-integration`, `engine`  
**Milestone:** v0.2.0 Core Gameplay  
**Estimated Effort:** 5-7 days

---

## Description

The game board UI uses **mock data** instead of the actual game state engine. Users **cannot actually play the game** despite the README claiming "Complete" status for all phases.

This is the **single biggest gap** between the codebase and a functional product. The game engine is well-tested and complete, but it's never used in the actual UI.

---

## Affected Files

### Primary Files to Fix
- `src/app/(app)/game-board/page.tsx` (entire file, lines 1-753)
- `src/app/(app)/single-player/page.tsx` (lines 1-129)
- `src/app/(app)/game/[id]/page.tsx` (partial implementation, needs completion)

### Engine Files to Integrate
- `src/lib/game-state/game-state.ts` - Core game state management
- `src/lib/game-state/spell-casting.ts` - Spell casting logic
- `src/lib/game-state/combat.ts` - Combat system
- `src/lib/game-state/mana.ts` - Mana system
- `src/lib/game-state/turn-phases.ts` - Turn progression

---

## Evidence of Mock Data Usage

### game-board/page.tsx - Line 330
```typescript
// ❌ Uses mock data instead of real game state
const [players, setPlayers] = useState<PlayerState[]>(() => generateMockPlayer(2));
```

### single-player/page.tsx - Line 19
```typescript
// ❌ Just shows a toast, no actual game initialization
const handleStartGame = (mode: "self-play" | "ai") => {
  toast({
    title: "Starting Game (Prototype)",
    description: `Game board would be initialized for ${mode}...`,
  });
  // No actual game initialization!
};
```

---

## Required Changes

### Phase 1: Replace Mock Data (2-3 days)

#### 1.1 Initialize Real Game State
```typescript
// ✅ Should use real game state
import { createInitialGameState, loadDeckForPlayer } from '@/lib/game-state';

const [gameState, setGameState] = useState<GameState | null>(null);

useEffect(() => {
  // Initialize actual game state
  const initialGameState = createInitialGameState({
    playerCount: 2,
    playerDecks: [playerDeck, aiDeck],
  });
  setGameState(initialGameState);
}, []);
```

#### 1.2 Remove Mock Generators
- [ ] Remove `generateMockPlayer()` function
- [ ] Remove `generateMockBattlefield()` function
- [ ] Remove all mock data generators

### Phase 2: Implement Game Loop (2-3 days)

#### 2.1 Action Handler
```typescript
const handleGameAction = useCallback((action: GameAction) => {
  setGameState(prev => {
    if (!prev) return null;
    
    // Validate action
    const validation = ValidationService.validateAction(prev, action);
    if (!validation.valid) {
      toast({ title: 'Invalid Action', description: validation.error });
      return prev;
    }
    
    // Apply action to game state
    return applyGameAction(prev, action);
  });
}, []);
```

#### 2.2 Connect UI Interactions
- [ ] `handleCardClick()` → `castSpell()`, `playLand()`, `activateAbility()`
- [ ] `handleAttack()` → `declareAttackers()`
- [ ] `handleBlock()` → `declareBlockers()`
- [ ] `handlePhaseAdvance()` → `advancePhase()`
- [ ] `handlePassPriority()` → `passPriority()`

### Phase 3: UI Updates (1-2 days)

#### 3.1 Subscribe to Game State Changes
```typescript
// Display actual game state
const battlefield = gameState?.zones.battlefield.cards || [];
const hand = gameState?.players[currentPlayerId]?.hand || [];
const life = gameState?.players[currentPlayerId]?.life || 20;
```

#### 3.2 Update All Zones
- [ ] Hand display uses real hand from game state
- [ ] Battlefield uses real permanents
- [ ] Graveyard uses real graveyard
- [ ] Library count from real library
- [ ] Life total from real game state

---

## Acceptance Criteria

### Core Gameplay
- [ ] User can **play a land** from hand (one per turn)
- [ ] User can **tap lands for mana**
- [ ] User can **cast a creature spell** (paying mana cost)
- [ ] User can **declare attackers** during combat
- [ ] User can **declare blockers** during combat
- [ ] **Combat damage** is dealt correctly
- [ ] **Life totals** update correctly
- [ ] **Turn phases** progress correctly

### State Management
- [ ] Game state **persists** between actions
- [ ] Game state **serializes** correctly
- [ ] **No mock data** in production code
- [ ] **All actions** validated by engine

### UI Feedback
- [ ] UI **updates** when game state changes
- [ ] **Invalid actions** show error messages
- [ ] **Priority** is clearly indicated
- [ ] **Current phase** is displayed

---

## Testing Steps

### Manual Testing
1. Start a new single-player game
2. Play a land - verify it appears on battlefield
3. Tap land for mana - verify mana appears in pool
4. Cast a creature - verify mana is spent, creature enters battlefield
5. Move to combat - verify phase changes
6. Declare attackers - verify creatures tap, attack
7. Declare blockers - verify blockers assigned
8. Complete combat - verify damage dealt, life updated

### Automated Testing
```typescript
describe('Game Integration', () => {
  it('should play a land from hand', async () => {
    const { gameState, user } = setupGame();
    
    await user.click(screen.getByText('Forest'));
    await user.click(screen.getByText('Play Land'));
    
    expect(gameState.zones.battlefield.cards).toHaveLength(1);
    expect(gameState.players['player1'].hand).toHaveLength(6);
  });
  
  it('should cast a creature spell', async () => {
    // Test spell casting
  });
  
  it('should resolve combat correctly', async () => {
    // Test combat resolution
  });
});
```

---

## Technical Notes

### Game State Flow
```
User Action → handleGameAction() → ValidationService.validateAction()
           → applyGameAction() → checkStateBasedActions()
           → update UI → Check for win/loss
```

### Key Engine Functions to Use
- `createInitialGameState()` - Initialize new game
- `startGame()` - Start the game (mulligans, etc.)
- `playLand()` - Play a land
- `castSpell()` - Cast a spell
- `activateManaAbility()` - Tap for mana
- `declareAttackers()` - Declare attackers
- `declareBlockers()` - Declare blockers
- `resolveCombatDamage()` - Deal combat damage
- `passPriority()` - Pass priority
- `advancePhase()` - Move to next phase

---

## Related Issues

- #521 (Connect single-player UI)
- #541 (Game engine integration)
- #560 (Bridge game engine with UI)
- #604 (Unify GameState types)
- #614 (Complete combat system)

---

## Blockers

This issue **blocks** all gameplay features:
- Single player mode
- Multiplayer mode
- AI opponent gameplay
- Any feature requiring actual game state

---

## Success Metrics

After this issue is complete:
- ✅ Users can play a complete game of Magic
- ✅ Game engine is actually used in production
- ✅ No more "Prototype" labels on game screens
- ✅ README accurately reflects implemented features
