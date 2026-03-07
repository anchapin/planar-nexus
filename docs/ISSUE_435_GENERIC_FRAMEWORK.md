# Issue #435: Generic Card Game Framework Core

## Overview

This document describes the implementation of Unit 1: Generic Card Game Framework Core, which provides a generic abstraction layer for the Planar Nexus game state management system. This implementation enables the framework to support different game systems while maintaining backward compatibility with existing MTG-like mechanics.

## Implementation Summary

### 1. Enhanced Terminology Translation Layer (`terminology-translation.ts`)

**New Mappings Added:**
- `Commander` → `Legendary Leader`
- `Mana` → `Resource`
- `Lands` → `Sources`
- `Mana Pool` → `Resource Pool`
- `Mana Cost` → `Resource Cost`
- `Planeswalker` → `Champion`

**New Translation Functions:**
- `translateResourceType()` - Translates resource types for display
- `translateCardType()` - Translates card types for display
- `translateWinCondition()` - Translates win condition descriptions
- `translateGameSystemText()` - Context-aware translation with optional parameters

### 2. Generic Type Definitions (`types.ts`)

**New Generic Interfaces:**
```typescript
// Generic resource pool abstraction
interface ResourcePool {
  type: string;
  total: number;
  resources: Map<string, number>;
  maximum: number;
}

// Generic resource cost abstraction
interface ResourceCost {
  resourceType: string;
  amount: number;
  requirements: Map<string, number>;
}

// Generic legendary leader abstraction
interface LegendaryLeader {
  id: CardInstanceId;
  name: string;
  ownerId: PlayerId;
  identity: string[];
  damageDealt: Map<PlayerId, number>;
  castCount: number;
  isInReserveZone: boolean;
}
```

**Enhanced Documentation:**
- All core types now include Issue #435 context
- Clear documentation of internal vs display terminology
- Design principles explained in type definitions

### 3. Game System Adapter (`game-system-adapter.ts`)

**New Module Purpose:**
Provides an abstraction layer that adapts the internal game state to different rule sets, resource systems, and win conditions.

**Key Features:**

#### Game System Registry
- Register custom game systems
- Retrieve game system configurations
- Pre-configured systems: MTG-like, Legendary Commander

#### Resource System Abstraction
- `adaptManaPoolToResourcePool()` - Convert MTG mana to generic resources
- `adaptResourcePoolToManaPool()` - Convert generic resources to MTG mana
- `canPayResourceCost()` - Generic cost checking
- `getCardResourceCost()` - Parse costs for different systems

#### Game System Configuration
```typescript
interface GameSystemConfig {
  id: string;
  name: string;
  description: string;

  // Resource system
  resourceType: string;
  maxResourcesPerTurn: number;
  emptyResourcesAtEndOfTurn: boolean;

  // Win conditions
  startingLife: number;
  leaderDamageThreshold: number | null;
  poisonThreshold: number | null;
  loseOnEmptyDeck: boolean;

  // Deck construction
  minDeckSize: number;
  maxDeckSize: number;
  maxCopiesPerCard: number;
  usesLeader: boolean;
  leaderZoneName: string;

  // Card types
  cardTypeMappings: Record<string, string>;
  resourceCardTypes: string[];
}
```

#### Win/Loss Condition Checking
- `checkWinConditions()` - Generic win condition verification
- `checkLossConditions()` - Generic loss condition verification
- Supports multiple win/loss conditions per game system

#### Resource Source Playing
- `canPlayResourceSource()` - Generic resource source playability check
- Respects game system rules (max per turn, card types, etc.)

### 4. Test Suite (`__tests__/generic-framework.test.ts`)

Comprehensive test coverage for:
- Resource system adaptation
- Game system registry
- Terminology translations
- Win/loss condition checking
- Resource source playing
- System differences

## Design Principles

### 1. Backward Compatibility
- Internal implementation uses MTG-like terminology for familiarity
- All existing code continues to work without modification
- Translation layer provides generic terminology for user-facing text

### 2. Abstraction Layer
- Generic interfaces support multiple game systems
- Resource system is pluggable (mana, energy, action-points, etc.)
- Win conditions are configurable per game system

### 3. Extensibility
- New game systems can be registered without modifying core logic
- Resource systems can be swapped via configuration
- Custom card type mappings supported

### 4. Clear Separation
- Generic framework logic is separate from specific implementations
- Translation layer handles all terminology conversions
- Game system adapter manages rule differences

## Usage Examples

### Registering a Custom Game System

```typescript
import { registerGameSystem } from '@/lib/game-state/game-system-adapter';

const energySystem = {
  id: 'energy-based',
  name: 'Energy-Based Card Game',
  description: 'Uses energy points instead of mana',
  resourceType: 'energy',
  maxResourcesPerTurn: 3,
  emptyResourcesAtEndOfTurn: false,
  startingLife: 25,
  leaderDamageThreshold: null,
  poisonThreshold: 15,
  loseOnEmptyDeck: false,
  minDeckSize: 50,
  maxDeckSize: 70,
  maxCopiesPerCard: 3,
  usesLeader: false,
  leaderZoneName: 'reserve',
  cardTypeMappings: {
    'land': 'generator',
  },
  resourceCardTypes: ['generator'],
};

registerGameSystem(energySystem);
```

### Translating Terminology for UI

```typescript
import { translateToGeneric, translateGameSystemText } from '@/lib/game-state/game-state';

// Simple translation
const text = translateToGeneric('Play a land from your hand');
// Result: "Play a source from your hand"

// Context-aware translation
const resourceText = translateGameSystemText(
  'Add 3 mana to your mana pool',
  'resource'
);
// Result: "Add 3 resources to your resource pool"
```

### Checking Resource Costs

```typescript
import { canPayResourceCost, getCardResourceCost } from '@/lib/game-state/game-system-adapter';
import { DEFAULT_GAME_SYSTEM } from '@/lib/game-state/game-system-adapter';

const card = { mana_cost: '{2}{W}{U}' };
const cost = getCardResourceCost(card, DEFAULT_GAME_SYSTEM);

const available = {
  type: 'mana',
  total: 5,
  resources: new Map([
    ['white', 2],
    ['blue', 2],
  ]),
  maximum: Infinity,
};

const canCast = canPayResourceCost(available, cost);
// Returns: true
```

### Checking Win/Loss Conditions

```typescript
import { checkWinConditions, checkLossConditions } from '@/lib/game-state/game-system-adapter';
import { DEFAULT_GAME_SYSTEM } from '@/lib/game-state/game-system-adapter';

const winCheck = checkWinConditions(gameState, playerId, DEFAULT_GAME_SYSTEM);
if (winCheck.hasWon) {
  console.log(`Player wins: ${winCheck.reason}`);
}

const lossCheck = checkLossConditions(gameState, playerId, DEFAULT_GAME_SYSTEM);
if (lossCheck.hasLost) {
  console.log(`Player loses: ${lossCheck.reason}`);
}
```

## Integration with Existing Code

### No Breaking Changes
All existing code continues to work without modification:
- Internal types still use MTG terminology
- Existing functions and APIs unchanged
- Translation layer handles display terminology

### Gradual Adoption
New code can adopt generic abstractions gradually:
- Use `GameSystemConfig` for new game modes
- Apply translation functions for UI text
- Leverage resource system abstractions for new features

## Testing

### Test Coverage
The implementation includes comprehensive tests in `__tests__/generic-framework.test.ts`:

1. **Resource System Abstraction Tests**
   - ManaPool to ResourcePool conversion
   - ResourcePool to ManaPool conversion
   - Empty resource pool handling

2. **Resource Cost Checking Tests**
   - Affordability checks
   - Resource type validation
   - Complex cost parsing

3. **Game System Registry Tests**
   - System registration and retrieval
   - Default system availability

4. **Terminology Translation Tests**
   - Issue #435 specific translations
   - Resource type translations
   - Card type translations

5. **Win/Loss Condition Tests**
   - Life total loss
   - Poison counter loss
   - Deck depletion
   - Victory conditions

6. **Resource Source Playing Tests**
   - Playability checks
   - Maximum per turn enforcement
   - Card type validation

7. **System Differences Tests**
   - Configuration comparisons
   - Win condition variations

### Running Tests

```bash
# Run all tests
npm test

# Run only generic framework tests
npm test -- generic-framework.test.ts

# Run with coverage
npm test -- --coverage
```

## Migration Guide

### For UI Developers
When displaying game information to users:

```typescript
// Before (MTG terminology)
display.textContent = 'Tap your lands for mana';

// After (Generic terminology)
import { translateGameSystemText } from '@/lib/game-state/game-state';

display.textContent = translateGameSystemText(
  'Activate your sources for resources',
  'resource'
);
```

### For Game Logic Developers
When implementing new game modes:

```typescript
// Define your game system configuration
const customSystem = {
  id: 'my-custom-mode',
  name: 'Custom Mode',
  // ... configuration
};

// Register the system
registerGameSystem(customSystem);

// Use the system for checks
const canPlay = canPlayResourceSource(state, playerId, cardId, customSystem);
const winCheck = checkWinConditions(state, playerId, customSystem);
```

## Future Enhancements

### Potential Extensions
1. **Additional Resource Systems**
   - Action points system
   - Stamina system
   - Hybrid systems

2. **More Game System Configurations**
   - Draft formats
   - Sealed deck formats
   - Multiplayer variants

3. **Advanced Abstractions**
   - Deck building rules per system
   - Card pool restrictions
   - Ban list management

4. **UI Integration**
   - Automatic translation in components
   - Game system selector
   - Rule display system

## Conclusion

The Generic Card Game Framework Core provides a solid foundation for supporting multiple game systems while maintaining backward compatibility. The implementation follows these key principles:

1. **Abstraction** - Generic interfaces support different game systems
2. **Translation** - Clear separation of internal and display terminology
3. **Extensibility** - Easy to add new game systems without modifying core logic
4. **Compatibility** - No breaking changes to existing code

This implementation successfully addresses Issue #435's requirements:
- Created generic type definitions for game state
- Mapped MTG-specific terms to generic equivalents
- Created abstraction layer for different game systems
- Removed MTG-specific terminology from core game state (via translation layer)
- Ensured backward compatibility with existing game logic

The framework is now ready to support different game systems and provides a clean path for future game mode additions.
