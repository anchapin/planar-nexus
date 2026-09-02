# Game State Module

This module provides the foundational data structures for the Planar Nexus MTG game engine.

## Overview

The game state module implements a complete, type-safe representation of a Magic: The Gathering game, including:

- **Card Instances**: Individual cards in play with state tracking
- **Zones**: All game zones (library, hand, battlefield, graveyard, exile, stack, command)
- **Players**: Complete player state including life, mana, counters
- **Turn Phases**: Full turn structure with all phases and steps
- **Combat**: Attackers, blockers, damage assignment
- **Stack**: Spell and ability resolution
- **Priority**: Tracking priority passes

## Core Types

### GameState

The main `GameState` interface contains:

```typescript
interface GameState {
  gameId: string;
  players: Map<PlayerId, Player>;
  cards: Map<CardInstanceId, CardInstance>;
  zones: Map<string, Zone>;
  stack: StackObject[];
  turn: Turn;
  combat: Combat;
  waitingChoice: WaitingChoice | null;
  priorityPlayerId: PlayerId | null;
  // ... more
}
```

### CardInstance

Represents a single physical card with all its state:

```typescript
interface CardInstance {
  id: CardInstanceId;
  oracleId: string;
  cardData: ScryfallCard;
  controllerId: PlayerId;
  ownerId: PlayerId;
  isTapped: boolean;
  counters: Counter[];
  damage: number;
  // ... and more
}
```

## Usage

### Creating a New Game

```typescript
import { createInitialGameState, startGame } from "@/lib/game-state";

// Create game with 2 players
let state = createInitialGameState(["Alice", "Bob"], 20, false);

// Load decks
state = loadDeckForPlayer(state, player1Id, deck1Cards);
state = loadDeckForPlayer(state, player2Id, deck2Cards);

// Start the game
state = startGame(state);
```

### Card Operations

```typescript
import {
  tapCard,
  addCounters,
  attachCard,
  isCreature,
  getPower,
  getToughness,
} from "@/lib/game-state";

// Tap a permanent
const tapped = tapCard(creature);

// Add +1/+1 counters
const buffed = addCounters(creature, "+1/+1", 2);

// Attach Equipment
const equipped = attachCard(equipment, creatureId);

// Check creature stats
if (isCreature(card)) {
  console.log(getPower(card), getToughness(card));
}
```

### Zone Management

```typescript
import { drawCard, moveCardBetweenZones, exileCards } from "@/lib/game-state";

// Draw a card
state = drawCard(state, playerId);

// Move card from battlefield to graveyard
state = moveCardBetweenZones(
  state.zones.get("battlefield"),
  state.zones.get("graveyard"),
  cardId,
);

// Exile multiple cards
state = exileCards(fromZone, exileZone, [cardId1, cardId2]);
```

### Turn Phases

```typescript
import {
  advancePhase,
  isMainPhase,
  canCastSorcerySpeedSpells,
} from "@/lib/game-state";

// Check phase
if (isMainPhase(state.turn.currentPhase)) {
  // Can cast sorcery-speed spells
}

// Advance phase
const nextTurn = advancePhase(state.turn);
```

### Priority and Stack

```typescript
import { passPriority } from "@/lib/game-state";

// Player passes priority
state = passPriority(state, playerId);
```

## Game Flow

### 1. Setup

1. Create initial game state
2. Load player decks
3. Shuffle libraries
4. Draw starting hands

### 2. Turn Structure

Each turn follows this phase order:

1. **Untap** - No priority
2. **Upkeep** - Priority, triggers go on stack
3. **Draw** - Priority, active player draws (except first turn)
4. **Pre-combat Main** - Priority, can cast sorceries
5. **Begin Combat** - Priority
6. **Declare Attackers** - Priority
7. **Declare Blockers** - Priority
8. **Combat Damage** - Priority
9. **End Combat** - Priority
10. **Post-combat Main** - Priority, can cast sorceries
11. **End** - Priority, triggers resolve
12. **Cleanup** - No priority normally

### 3. State-Based Actions

Checked whenever a player receives priority:

- Creatures with lethal damage
- Creatures with toughness 0 or less
- Players with 0 or less life
- Players with 10+ poison counters
- Empty library when drawing

### 4. Winning and Losing

Players lose when:

- Life total reaches 0 or less
- Accumulates 10 poison counters
- Attempts to draw from empty library
- Concedes

Game ends when:

- Only one player remains
- All players lose simultaneously (draw)

## Design Decisions

### Immutable Updates

The game state uses immutable updates. Functions return new state objects rather than mutating existing ones:

```typescript
// Good
const newState = drawCard(state, playerId);

// Bad - don't do this
state.zones.get("hand")?.cardIds.push(cardId);
```

This enables:

- Time travel debugging
- Easy state serialization
- Undo/redo functionality
- Deterministic multiplayer sync

### Zone IDs

Zones are identified by `{playerId}-{zoneType}`:

- `p1-library` - Player 1's library
- `p2-battlefield` - Player 2's battlefield
- `stack` - Shared stack zone

### Timestamps

All timestamp-based effects use Unix epoch milliseconds:

- `enteredBattlefieldTimestamp` - For "last in, first out" effects
- `attachedTimestamp` - For attachment ordering

## Future Enhancements

This foundation will support:

1. **Card Mechanics** (Phase 1.2)
   - Land playing
   - Spell casting
   - Stack resolution
   - Combat system
   - Activated/triggered abilities

2. **Rules Engine** (Phase 1.3)
   - Oracle text parsing
   - Evergreen keywords
   - Replacement effects
   - Layer system

3. **Multiplayer** (Phase 4)
   - Game state serialization
   - Deterministic sync
   - Replay system

## Testing

Example test structure:

```typescript
describe("GameState", () => {
  it("should create initial game state", () => {
    const state = createInitialGameState(["Alice", "Bob"]);
    expect(state.players.size).toBe(2);
    expect(state.turn.turnNumber).toBe(1);
  });

  it("should draw cards correctly", () => {
    let state = createInitialGameState(["Alice"]);
    state = loadDeckForPlayer(state, playerId, deckCards);
    const beforeHand = getPlayerHand(state, playerId);
    state = drawCard(state, playerId);
    const afterHand = getPlayerHand(state, playerId);
    expect(afterHand.cardIds.length).toBe(beforeHand.cardIds.length + 1);
  });
});
```

## Related Files

- `/src/lib/game-rules.ts` - Format rules and deck construction
- `/src/lib/card-database.ts` - ScryfallCard, DeckCard, and SavedDeck types
- `/src/ai/flows/` - AI deck generation
