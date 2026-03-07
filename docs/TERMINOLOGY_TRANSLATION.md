# Terminology Translation Layer

## Overview

The Terminology Translation Layer (Issue #442) provides a comprehensive system for translating Magic: The Gathering-specific terminology into generic equivalents. This ensures the game remains legally distinct while maintaining core gameplay mechanics.

## Purpose

- Transform MTG-specific terminology into generic equivalents for legal and design reasons
- Maintain backward compatibility with existing code and card data
- Provide user-facing displays with generic terminology
- Support round-trip translation for internal processing

## Translation Mappings

### Core Terminology

| MTG Term | Generic Term |
|----------|-------------|
| tap | activate |
| untap | deactivate |
| tapped | activated |
| untapped | deactivated |
| tapping | activating |
| untapping | deactivating |

### Zones

| MTG Term | Generic Term |
|----------|-------------|
| battlefield | play area |
| graveyard | discard pile |
| library | deck |
| exile | void |
| stack | action stack |
| command zone | reserve zone |

### Game Mechanics

| MTG Term | Generic Term |
|----------|-------------|
| summoning sickness | deployment restriction |
| cast | play |
| casting | playing |
| spell | card effect |
| counter | marker |

### Card Types

| MTG Term | Generic Term |
|----------|-------------|
| planeswalker | champion |
| planeswalkers | champions |

### Phases

| MTG Term | Generic Term |
|----------|-------------|
| untap step | reactivation step |
| upkeep step | maintenance step |

### Resources

| MTG Term | Generic Term |
|----------|-------------|
| mana pool | energy pool |
| mana | energy |

## Usage

### Basic Translation

```typescript
import {
  translateToGeneric,
  translateFromGeneric,
  translateTerm,
} from '@/lib/game-state';

// Translate text from MTG to generic
const genericText = translateToGeneric('Tap this creature on the battlefield');
// Result: 'Activate this creature on the play area'

// Translate back from generic to MTG
const mtgText = translateFromGeneric('Activate this creature');
// Result: 'Tap this creature'

// Translate a single term
const term = translateTerm('graveyard');
// Result: 'discard pile'
```

### Zone Translation

```typescript
import { translateZone } from '@/lib/game-state';

const zoneName = translateZone('battlefield');
// Result: 'Play Area'
```

### Phase Translation

```typescript
import { translatePhase } from '@/lib/game-state';

const phaseName = translatePhase('untap');
// Result: 'Reactivation'
```

### Action Translation

```typescript
import { translateAction } from '@/lib/game-state';

const actionName = translateAction('tap_card');
// Result: 'Activate card'
```

### Card State Translation

```typescript
import { translateCardState, getCardStateDescription } from '@/lib/game-state';

const state = translateCardState({
  isTapped: true,
  hasSummoningSickness: false,
  isPhasedOut: false,
});
// Result: { activation: 'activated', deployment: 'ready', visibility: 'visible' }

const description = getCardStateDescription({
  isTapped: true,
  hasSummoningSickness: true,
});
// Result: 'Activated, Has deployment restriction'
```

### Rule Text Translation

```typescript
import { translateRuleText } from '@/lib/game-state';

const rule = 'At the beginning of your upkeep, tap target creature an opponent controls.';
const translated = translateRuleText(rule);
// Result: 'At the beginning of your maintenance, activate target creature an opponent controls.'
```

### Batch Translation

```typescript
import { translateBatch } from '@/lib/game-state';

const texts = ['Tap this card', 'Untap that card', 'Move to graveyard'];
const translated = translateBatch(texts);
// Result: ['Activate this card', 'Deactivate that card', 'Move to discard pile']
```

### Utility Functions

```typescript
import { isMTGTerm, getAllMTGTerms } from '@/lib/game-state';

// Check if a term needs translation
if (isMTGTerm('battlefield')) {
  console.log('This is an MTG term');
}

// Get all MTG terms that need translation
const terms = getAllMTGTerms();
// Returns: ['tap', 'untap', 'battlefield', 'graveyard', ...]
```

## Implementation Details

### Internal vs. User-Facing Terminology

The codebase maintains a clear distinction between:

1. **Internal terminology**: Type names, variable names, and internal logic continue to use MTG terminology for compatibility with card data and existing code.

2. **User-facing terminology**: All text displayed to users is translated through the translation layer.

### Case Preservation

The translation functions preserve the case of the original text:

- `Tap` → `Activate` (title case)
- `tap` → `activate` (lowercase)
- `TAP` → `ACTIVATE` (uppercase)

### Type Updates

Core type definitions have been updated to include comments indicating when MTG terminology is used internally:

```typescript
/**
 * Whether the permanent is activated (internally tracked as "tapped" for compatibility)
 */
isTapped: boolean;
```

### Backward Compatibility

The translation layer includes:
- Reverse mapping for translating generic terminology back to MTG terms
- Round-trip translation support
- Type definitions that maintain internal compatibility

## Testing

Comprehensive tests are provided in `src/lib/game-state/__tests__/terminology-translation.test.ts`:

- All 60 tests passing
- Covers all translation functions
- Tests round-trip translation
- Validates case preservation
- Tests edge cases

## When to Use Translation

### Use Translation When:
- Displaying text to users
- Showing zone names in the UI
- Displaying phase names
- Showing action descriptions
- Translating card rules
- Creating user-facing documentation

### Don't Use Translation When:
- Working with internal type definitions
- Processing card data from external sources
- Implementing game logic
- Writing tests that verify internal behavior

## Future Enhancements

Potential improvements for the translation layer:

1. **Localization Support**: Extend the system to support multiple languages
2. **Custom Terminology**: Allow users to customize terminology mappings
3. **Context-Aware Translation**: Improve translation based on context
4. **Pluralization**: Handle plural forms more intelligently
5. **Abbreviations**: Support for common abbreviations

## Related Files

- `/src/lib/game-state/terminology-translation.ts` - Main translation module
- `/src/lib/game-state/types.ts` - Updated type definitions with translation notes
- `/src/lib/game-state/evergreen-keywords.ts` - Updated keyword comments
- `/src/lib/game-state/__tests__/terminology-translation.test.ts` - Comprehensive tests

## References

- Issue #442: Unit 8 - Terminology Translation Layer
- CR 702 - Keyword Abilities (MTG Comprehensive Rules)
