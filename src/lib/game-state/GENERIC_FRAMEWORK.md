# Generic Card Game Framework

## Overview

This module provides a framework-agnostic foundation for managing card game state, designed to support multiple game systems (Magic: The Gathering, Hearthstone, etc.) through abstraction and configuration.

## Architecture

### Core Components

1. **Generic Types** (`generic-types.ts`) - Framework-agnostic type definitions
2. **MTG Adapter** (`mtg-adapter.ts`) - MTG-specific implementations and mappings
3. **Legacy Types** (`types.ts`) - Backward-compatible MTG types

### Terminology Mapping

The framework abstracts MTG-specific terminology into generic concepts:

| MTG Terminology | Generic Equivalent |
|----------------|-------------------|
| Commander | Legendary Leader |
| mana | resources |
| lands | sources |
| command zone | leader zone |
| life | health |
| play land | play source |
| gain life | gain health |
| pay mana | pay resource |
| add mana | add resource |

## Usage

### Working with Generic Types

```typescript
import { GameState, Player, CardInstance, GameSystemConfig } from '@/lib/game-state';

// Use generic types for framework-agnostic code
const state: GameState = {
  gameId: 'game-1',
  players: new Map(),
  cards: new Map(),
  zones: new Map(),
  stack: [],
  turn: { /* ... */ },
  combat: { /* ... */ },
  waitingChoice: null,
  priorityPlayerId: null,
  consecutivePasses: 0,
  status: 'not_started',
  winners: [],
  endReason: null,
  format: 'standard',
  createdAt: Date.now(),
  lastModifiedAt: Date.now(),
};

// Generic player with generic fields
const player: Player = {
  id: 'player-1',
  name: 'Player 1',
  health: 20, // Generic "health" instead of MTG "life"
  poisonCounters: 0,
  leaderDamage: new Map(), // Generic "leaderDamage" instead of MTG "commanderDamage"
  maxHandSize: 7,
  currentHandSizeModifier: 0,
  hasLost: false,
  lossReason: null,
  sourcesPlayedThisTurn: 0, // Generic "sources" instead of MTG "lands"
  maxSourcesPerTurn: 1,
  resources: { resources: new Map() }, // Generic "resources" instead of MTG "manaPool"
  isInLeaderZone: false, // Generic "leaderZone" instead of MTG "commandZone"
  experienceCounters: 0,
  leaderCastCount: 0,
  hasPassedPriority: false,
  hasActivatedResourceAbility: false, // Generic "resourceAbility" instead of MTG "manaAbility"
  additionalCombatPhase: false,
  additionalMainPhase: false,
  hasOfferedDraw: false,
  hasAcceptedDraw: false,
};
```

### Working with MTG-Specific Types

```typescript
import {
  CardInstance,
  Player,
  ManaPool,
  MTGCardInstance,
  MTGPlayer,
  MTG_CONFIG,
  MTGCardDataAdapter,
  MTGResourcePoolAdapter,
} from '@/lib/game-state';

// Use MTG-specific types for MTG code
const mtgPlayer: MTGPlayer = {
  id: 'player-1',
  name: 'Player 1',
  life: 20, // MTG-specific "life"
  poisonCounters: 0,
  commanderDamage: new Map(), // MTG-specific "commanderDamage"
  maxHandSize: 7,
  currentHandSizeModifier: 0,
  hasLost: false,
  lossReason: null,
  landsPlayedThisTurn: 0, // MTG-specific "lands"
  maxLandsPerTurn: 1,
  manaPool: { // MTG-specific "manaPool"
    colorless: 0,
    white: 0,
    blue: 0,
    black: 0,
    red: 0,
    green: 0,
    generic: 0,
  },
  isInCommandZone: false, // MTG-specific "commandZone"
  experienceCounters: 0,
  commanderCastCount: 0,
  hasPassedPriority: false,
  hasActivatedManaAbility: false, // MTG-specific "manaAbility"
  additionalCombatPhase: false,
  additionalMainPhase: false,
  hasOfferedDraw: false,
  hasAcceptedDraw: false,
};

// Convert Scryfall card to generic card data
import { ScryfallCard } from '@/app/actions';
const scryfallCard: ScryfallCard = { /* ... */ };
const genericCardData = MTGCardDataAdapter.toGenericCard(scryfallCard);

// Work with MTG mana pool
const manaPool = MTGResourcePoolAdapter.createEmpty();
const updatedPool = MTGResourcePoolAdapter.addMana(manaPool, 'white', 2);
const canPay = MTGResourcePoolAdapter.hasEnoughMana(updatedPool, { white: 2 });
```

### Configuration

```typescript
import { MTG_CONFIG, MTG_COMMANDER_CONFIG } from '@/lib/game-state';

// Standard MTG configuration
const standardConfig = MTG_CONFIG;
// {
//   name: "mtg",
//   leaderDamageThreshold: 21,
//   startingHealth: 20,
//   startingHandSize: 7,
//   maxSourcesPerTurn: 1,
// }

// Commander configuration
const commanderConfig = MTG_COMMANDER_CONFIG;
// {
//   name: "mtg-commander",
//   leaderDamageThreshold: 21,
//   startingHealth: 40,
//   startingHandSize: 7,
//   maxSourcesPerTurn: 1,
// }

// Get format-specific values
import { MTGGameStateHelpers } from '@/lib/game-state';

const startingLife = MTGGameStateHelpers.getStartingLife('commander'); // 40
const maxSources = MTGGameStateHelpers.getMaxSourcesPerTurn('standard'); // 1
```

## Type Hierarchy

### Generic Types (Framework-Agnostic)

- `CardData` - Generic card definition
- `CardInstance` - Generic card instance
- `Player` - Generic player with `health`, `leaderDamage`, `resources`, `sources`
- `ResourcePool` - Generic resource pool
- `ZoneType` - Generic zone types (includes "leader" zone)
- `ActionType` - Generic action types (includes "play_source", "gain_health", "pay_resource")

### MTG-Specific Types

- `ScryfallCard` - MTG card data from Scryfall API
- `MTGCardInstance` - MTG card instance with `oracleId`, `cardData: ScryfallCard`
- `MTGPlayer` - MTG player with `life`, `commanderDamage`, `manaPool`, `lands`
- `ManaPool` - MTG mana pool with color-specific fields
- `MTGZoneType` - MTG zone types (includes "command" zone)
- `MTGActionType` - MTG action types (includes "play_land", "gain_life", "pay_mana")

## Migration Guide

### Converting MTG Code to Generic Code

**Before (MTG-specific):**
```typescript
const manaCost = { white: 2, blue: 1 };
const pool = player.manaPool;
const canCast = pool.white >= manaCost.white && pool.blue >= manaCost.blue;
```

**After (Generic):**
```typescript
const resourceCost = { white: 2, blue: 1 };
const pool = player.resources;
const canCast = MTGResourcePoolAdapter.hasEnoughMana(pool, resourceCost);
```

**Before (MTG-specific):**
```typescript
const commander = players[playerId].commanderDamage.get(commanderId);
```

**After (Generic):**
```typescript
const leader = players[playerId].leaderDamage.get(leaderId);
```

**Before (MTG-specific):**
```typescript
const landsPlayed = player.landsPlayedThisTurn;
```

**After (Generic):**
```typescript
const sourcesPlayed = player.sourcesPlayedThisTurn;
```

## Backward Compatibility

The framework maintains full backward compatibility with existing MTG code:

1. **Type Aliases** - MTG-specific types remain available as before
2. **Dual Fields** - Objects include both MTG-specific and generic fields
3. **Adapter Functions** - Convert between MTG and generic representations
4. **Gradual Migration** - Can migrate code incrementally

### Using MTG Types with Generic Framework

```typescript
import { CardInstance, MTGCardInstance } from '@/lib/game-state';

// MTG code continues to work
function isLand(card: CardInstance): boolean {
  return card.cardData.type_line?.toLowerCase().includes('land');
}

// Generic code works with both
function isSource(card: CardInstance): boolean {
  // Uses generic card data if available
  const genericData = card.genericCardData;
  if (genericData) {
    return genericData.types.includes('land');
  }
  // Falls back to MTG data
  return card.cardData.type_line?.toLowerCase().includes('land');
}
```

## Adding New Game Systems

To support a new game system:

1. Create a configuration object:
```typescript
import { GameSystemConfig } from '@/lib/game-state';

export const HEARTHSTONE_CONFIG: GameSystemConfig = {
  name: 'hearthstone',
  startingHealth: 30,
  startingHandSize: 4,
  maxSourcesPerTurn: 1, // One card per turn
};
```

2. Create an adapter for game-specific data:
```typescript
export class HearthstoneCardDataAdapter {
  static toGenericCard(hsCard: HearthstoneCard): CardData {
    return {
      id: hsCard.id,
      name: hsCard.name,
      types: ['minion', 'spell', 'weapon'].filter(t =>
        hsCard.type === t
      ),
      cost: hsCard.cost?.toString(),
      metadata: {
        attack: hsCard.attack,
        health: hsCard.health,
        rarity: hsCard.rarity,
        _hearthstone: hsCard,
      },
    };
  }
}
```

3. Implement game-specific utilities:
```typescript
export class HearthstoneResourcePoolAdapter {
  static createEmpty(): ResourcePool {
    return { resources: new Map([['crystals', 0]]) };
  }

  static addCrystals(pool: ResourcePool, amount: number): ResourcePool {
    const updated = { ...pool };
    updated.resources.set('crystals', (pool.resources.get('crystals') || 0) + amount);
    return updated;
  }
}
```

## Testing

The framework includes comprehensive tests for:

- Generic type definitions
- MTG adapter functionality
- Type conversions and mappings
- Backward compatibility

Run tests with:
```bash
npm test -- src/lib/game-state/__tests__/
```

## Future Enhancements

1. **Additional Game Systems** - Add adapters for Hearthstone, Yu-Gi-Oh!, etc.
2. **Validation Layer** - Add generic validation framework
3. **Serialization** - Enhanced serialization for game state persistence
4. **Diff/Patch System** - Track changes between game states
5. **Performance Optimization** - Optimize for large-scale games

## References

- Magic: The Gathering Comprehensive Rules
- Scryfall API Documentation
- Generic Card Game Design Patterns
