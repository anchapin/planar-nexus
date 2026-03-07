# Enhanced Opponent Deck Generator

## Overview

The Enhanced Opponent Deck Generator is a client-side, heuristic-based system for generating varied, balanced AI opponent decks without requiring AI providers or external APIs. This module is part of Issue #441: Server Action Elimination - Opponent Generation.

## Key Features

### 1. Archetype-Based Generation

The system supports 10 distinct deck archetypes, each with unique strategic characteristics:

- **Aggro**: Fast-paced decks that win quickly through aggressive creatures and burn
- **Control**: Defensive decks that control the board and win through card advantage
- **Midrange**: Balanced decks with threats and answers for all game stages
- **Combo**: Synergistic decks that combine cards for powerful interactions
- **Ramp**: Mana-focused decks that accelerate into powerful late-game threats
- **Prison**: Lockdown decks that restrict opponent's resources and options
- **Tempo**: Aggressive control decks that disrupt opponents while applying pressure
- **Tokens**: Decks focused on generating and utilizing token creatures
- **Aristocrats**: Synergy decks that sacrifice creatures for value
- **Stompy**: Aggressive decks with powerful, efficient creatures

### 2. Strategic Themes

Each archetype includes multiple strategic themes for variety:

- **Burn**: Direct damage focus
- **White Weenie**: Efficient white creatures
- **Fairies**: Blue/white flying synergies
- **Zombies**: Black graveyard synergies
- **Dragons**: Big flying threats
- **Tokens**: Token generation focus
- **Mill**: Decking the opponent
- **Lifegain**: Life gain synergies
- **Artifacts**: Artifact-focused strategies
- **Enchantments**: Enchantment synergies
- **Counters**: Counterspell-heavy control
- **Reanimator**: Graveyard recursion
- **Elves**: Elf tribal synergies
- **Goblins**: Goblin tribal aggro
- **Control**: Traditional control strategies
- **Midrange**: Value-based midrange
- **Storm**: Storm combo
- **Scapeshift**: Land-based combo
- **Trample**: Trample threats
- **Haste**: Haste creatures
- **Flash**: Flash creatures
- **Toolbox**: Silver bullet creatures

### 3. Difficulty Levels

Four difficulty levels that affect deck quality and complexity:

- **Easy**: Simpler decks with basic synergies, more randomization
- **Medium**: Balanced decks with reasonable synergies, moderate complexity
- **Hard**: Strong decks with strong synergies, higher consistency
- **Expert**: Optimal decks with maximum synergies, highest consistency

Each difficulty level adjusts:
- Mana curve optimization
- Synergy weight (theme-specific cards)
- Removal spell count
- Creature spell count
- Land count and mana fixing
- Overall deck consistency

### 4. Format Support

Supports multiple Magic: The Gathering formats:

- **Commander**: 100-card singleton format (default)
- **Standard**: Current Standard-legal cards
- **Modern**: Eighth Edition onward
- **Pioneer**: Return to Ravnica onward
- **Legacy**: Almost all Magic cards
- **Vintage**: All Magic cards with restricted list
- **Pauper**: Common cards only

### 5. Color Identity System

Enforces color identity rules based on selected colors:
- Supports mono-color, two-color, and three-color decks
- Automatically selects appropriate basic lands
- Includes dual lands based on difficulty
- Respects format-specific color restrictions

## Architecture

### Core Components

#### 1. Card Pool

A comprehensive pool of cards organized by:
- Color and cost (e.g., `W_one_drops`, `R_burn`)
- Strategic category (e.g., `creatures`, `spells`, `removal`)
- Theme-specific additions (e.g., `goblins`, `elves`)

#### 2. Archetype Configurations

Each archetype includes:
- Preferred colors
- Creature categories
- Spell categories
- Available themes
- Description
- Strategic approach guidance

#### 3. Theme Modifiers

Each theme includes:
- Additional creatures
- Additional spells
- Key cards that define the theme

#### 4. Difficulty Configurations

Each difficulty level specifies:
- Mana curve distribution
- Synergy weight
- Card counts (creatures, spells, removal)
- Land count
- Mana fixing quality
- Overall consistency

### Generation Process

1. **Input Processing**: Parse format, archetype, theme, colors, and difficulty
2. **Color Selection**: Select colors if not specified
3. **Theme Selection**: Select theme if not specified
4. **Land Generation**: Generate appropriate lands for format and colors
5. **Mana Curve Calculation**: Calculate optimal curve for archetype and difficulty
6. **Creature Selection**: Select creatures based on curve, archetype, and theme
7. **Spell Selection**: Select spells based on archetype, theme, and difficulty
8. **Synergy Integration**: Add theme-specific cards
9. **Utility Addition**: Add mana rocks and utility artifacts
10. **Deck Validation**: Ensure correct deck size and format compliance
11. **Name Generation**: Generate descriptive deck name
12. **Strategy Generation**: Generate strategic approach text

## Usage

### Basic Generation

```typescript
import { generateOpponentDeck } from '@/lib/opponent-deck-generator';

const deck = generateOpponentDeck({
  format: 'commander',
  archetype: 'aggro',
  difficulty: 'medium',
});

console.log(deck.name);
console.log(deck.strategicApproach);
console.log(deck.cards);
```

### Themed Generation

```typescript
import { generateThemedDeck } from '@/lib/opponent-deck-generator';

const deck = generateThemedDeck('goblins', 'commander', 'hard');
```

### Color-Based Generation

```typescript
import { generateColorDeck } from '@/lib/opponent-deck-generator';

const deck = generateColorDeck(['R', 'W'], 'commander', 'medium');
```

### Random Generation

```typescript
import { generateRandomDeck } from '@/lib/opponent-deck-generator';

const deck = generateRandomDeck('commander');
```

### Server Action Integration

```typescript
import { generateOpponent } from '@/app/actions';

const opponent = await generateOpponent({
  theme: 'aggressive red',
  difficulty: 'medium',
});

console.log(opponent.deckList);
console.log(opponent.strategicApproach);
```

## API Reference

### Main Functions

#### `generateOpponentDeck(input: OpponentDeckGenerationInput): GeneratedDeck`

Generate an opponent deck based on specified parameters.

**Input:**
- `format`: Format to generate for
- `archetype?`: Deck archetype (default: 'midrange')
- `theme?`: Strategic theme (default: random)
- `colorIdentity?`: Color array (default: random)
- `difficulty?`: Difficulty level (default: 'medium')

**Output:**
- `name`: Deck name
- `archetype`: Deck archetype
- `theme`: Strategic theme
- `description`: Archetype description
- `strategicApproach`: How to play the deck
- `cards`: Array of card objects with quantities
- `colorIdentity`: Array of colors
- `difficulty`: Difficulty level
- `format`: Format

#### `generateThemedDeck(theme: StrategicTheme, format: Format, difficulty: DifficultyLevel): GeneratedDeck`

Generate a deck with a specific strategic theme.

#### `generateColorDeck(colors: string[], format: Format, difficulty: DifficultyLevel): GeneratedDeck`

Generate a deck with specific colors.

#### `generateRandomDeck(format: Format): GeneratedDeck`

Generate a completely random deck.

### Helper Functions

#### `getAvailableArchetypes(): DeckArchetype[]`

Get all available deck archetypes.

#### `getAvailableThemes(archetype: DeckArchetype): StrategicTheme[]`

Get available themes for a specific archetype.

#### `getArchetypeConfig(archetype: DeckArchetype): ArchetypeConfig`

Get configuration for a specific archetype.

#### `getDifficultyConfig(difficulty: DifficultyLevel): DifficultyConfig`

Get configuration for a specific difficulty level.

#### `isValidArchetype(archetype: string): boolean`

Validate if a string is a valid archetype.

#### `isValidTheme(theme: string): boolean`

Validate if a string is a valid theme.

#### `isValidDifficulty(difficulty: string): boolean`

Validate if a string is a valid difficulty level.

## Testing

Run the test suite:

```bash
npm test opponent-deck-generator
```

The test suite validates:
- Deck diversity across generated decks
- Archetype accuracy
- Color balance
- Power level consistency
- Format compliance
- Mana curve optimization
- Strategic approach generation

## Performance Considerations

- All generation is client-side with no network calls
- Generation time: < 100ms for typical decks
- Memory usage: Minimal (card pool is in-memory)
- No external dependencies after initial load

## Future Enhancements

Potential improvements for future iterations:

1. **Card Database Integration**: Use actual card database for accurate CMC and type information
2. **Synergy Detection**: Implement automatic synergy detection and scoring
3. **Deck Optimization**: Add hill-climbing or genetic algorithms for optimization
4. **Matchup Analysis**: Generate decks tailored to specific matchups
5. **Meta Simulation**: Generate decks based on simulated meta data
6. **Player Skill Adaptation**: Adjust difficulty based on player performance
7. **Learning System**: Learn from player feedback to improve generation

## Migration from AI-Based Generation

This system replaces the previous AI-based opponent generation. Key differences:

### Previous (AI-Based)
- Required AI provider (Gemini, OpenAI, etc.)
- Network dependency
- Cost per generation
- Limited scalability
- External service dependency

### Current (Heuristic-Based)
- No AI provider required
- Fully offline
- No cost per generation
- Highly scalable
- Self-contained

### API Compatibility

The API remains backward compatible. Existing code using `generateAIOpponentDeck` will continue to work without modifications:

```typescript
// Old API (still works)
const opponent = await generateAIOpponentDeck({
  theme: 'aggressive red',
  difficulty: 'medium',
});

// New direct API
const deck = generateThemedDeck('burn', 'commander', 'medium');
```

## Contributing

When adding new features:

1. Add cards to appropriate categories in `CARD_POOL`
2. Define archetype configurations in `ARCHETYPE_CONFIGS`
3. Add theme modifiers in `THEME_MODIFIERS`
4. Update difficulty configurations if needed
5. Add comprehensive tests
6. Update this documentation

## License

Part of Planar Nexus project. See main LICENSE file for details.
