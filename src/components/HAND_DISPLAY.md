# Hand Display Component

## Overview

The `HandDisplay` component provides an interactive, feature-rich interface for displaying and managing a player's hand in Magic: The Gathering gameplay. It supports both face-up display for the current player and card-back display for opponents, with full multi-select capabilities.

## Features

### Current Player Hand (Face-Up)
- **Card Visualization**: Displays full card images from Scryfall
- **Multi-Select**: Click to select/deselect multiple cards
- **Visual Feedback**: Selected cards show ring indicator and scale effect
- **Mana Cost Overlay**: Shows mana cost on card images
- **Color Indicators**: Color badges for card colors
- **Hover Effects**: Scale and lift animations
- **Tooltips**: Detailed card information on hover

### Opponent Hand (Card Backs)
- **Hidden Information**: Shows stylized card backs
- **Card Count**: Displays total number of cards
- **Clickable**: Card backs are still interactive for game actions

### Sorting & Organization
- **Sort by Name**: Alphabetical order
- **Sort by Mana Cost**: Low to high CMC
- **Sort by Type**: Card type line
- **Sort by Color**: WUBRG order
- **Display Modes**:
  - Overlapping: Horizontal scrolling, compact
  - Spread: Wrapping layout, more space

### UI Controls
- **Sort Button**: Cycles through sort options
- **Display Mode Toggle**: Switch between overlapping/spread
- **Clear Selection**: Remove all selected cards (when active)
- **Selection Counter**: Shows number of selected cards

## API Reference

### Props

```typescript
interface HandDisplayProps {
  cards: CardState[];              // Cards to display
  isCurrentPlayer: boolean;        // Show face-up or card backs
  onCardSelect?: (cardIds: string[]) => void;  // Multi-select callback
  onCardClick?: (cardId: string) => void;      // Single card click
  selectedCardIds?: string[];      // Controlled selection state
  className?: string;              // Additional CSS classes
}
```

### Types

```typescript
export type HandSortOption = "name" | "manaCost" | "type" | "color";
export type HandDisplayMode = "overlapping" | "spread";
```

## Usage Examples

### Basic Usage

```tsx
import { HandDisplay } from "@/components/hand-display";

function GameComponent() {
  const [selectedCards, setSelectedCards] = useState<string[]>([]);

  return (
    <HandDisplay
      cards={player.hand}
      isCurrentPlayer={true}
      onCardSelect={setSelectedCards}
      onCardClick={(cardId) => console.log("Clicked:", cardId)}
      selectedCardIds={selectedCards}
    />
  );
}
```

### Opponent Hand

```tsx
<HandDisplay
  cards={opponent.hand}
  isCurrentPlayer={false}
  onCardClick={(cardId) => handleOpponentCardInteraction(cardId)}
/>
```

### With Custom Styling

```tsx
<HandDisplay
  cards={player.hand}
  isCurrentPlayer={true}
  className="min-h-[200px] bg-primary/5"
  onCardSelect={handleCardSelection}
/>
```

## Integration with Game Board

The hand display is integrated into the game board component. For the local player (bottom position), it uses the full `HandDisplay` component with face-up cards and selection capabilities. For opponents, it shows card backs to maintain hidden information.

### Key Integration Points

1. **Position Detection**: The game board passes `isLocalPlayer` to determine display mode
2. **Selection State**: Each player area manages its own selection state
3. **Event Propagation**: Card clicks propagate to the parent game board
4. **Layout Adaptation**: Hand display adapts to horizontal/vertical layouts

## Design Decisions

### Card Aspect Ratio
- Uses MTG standard aspect ratio (5:7)
- Responsive sizing with min/max width constraints
- Maintains readability at different sizes

### Selection UX
- Click to toggle selection (multi-select)
- Visual ring indicator for selected cards
- Scale effect for immediate feedback
- Clear selection button for bulk deselection

### Performance
- Uses React.useMemo for sorting calculations
- Efficient re-renders with proper dependency arrays
- ScrollArea for large hands (12+ cards)

### Accessibility
- Keyboard navigation support
- ARIA labels via Shadcn components
- Focus indicators on interactive elements
- High contrast visual feedback

## Future Enhancements

Potential improvements for future iterations:

1. **Drag and Drop**: Drag cards to reorder or cast
2. **Hand Filtering**: Filter by card type, color, etc.
3. **Card Grouping**: Group lands, creatures, spells
4. **Keyboard Shortcuts**: Ctrl+A to select all, Escape to clear
5. **Card Inspection**: Modal view for detailed card info
6. **Tap Indicators**: Show tapped/untapped state for cards with abilities
7. **Hint System**: Suggest cards based on available mana
8. **Animated Transitions**: Smooth card draw/discard animations

## Testing

Manual testing checklist:

- [ ] Display works with 0 cards
- [ ] Display works with 1-7 cards (normal hand)
- [ ] Display works with 8-12 cards (large hand)
- [ ] Card selection toggles correctly
- [ ] Multiple cards can be selected
- [ ] Clear selection removes all selections
- [ ] Sort options work correctly
- [ ] Display mode toggle works
- [ ] Opponent hands show card backs
- [ ] Tooltips display correctly
- [ ] Mana cost overlays appear
- [ ] Color indicators show correctly
- [ ] Responsive layout works on mobile
- [ ] Clicking card backs triggers callbacks

## Dependencies

- React 18+ (hooks: useState, useEffect, useMemo)
- Next.js Image component
- Lucide React icons
- Shadcn/ui components (Badge, Button, ScrollArea, Tooltip)
- Internal types from `@/types/game`
- Scryfall card types from `@/app/actions`
