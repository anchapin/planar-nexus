# Game Board Component - Phase 2.1

## Overview

The Game Board component is the visual foundation for gameplay in Planar Nexus. It provides a responsive, accessible layout for displaying all game zones across multiple player configurations.

## Features Implemented

### 1. Responsive Layouts
- **2-Player Layout**: Top/bottom split for 1v1 games
- **4-Player Layout**: Commander-style arrangement with top, left, right, and bottom positions
- **Automatic orientation**: Player areas adjust orientation (horizontal/vertical) based on position

### 2. Zone Display
All Magic: The Gathering game zones are displayed:
- **Battlefield**: Large central area showing creature/land cards
- **Hand**: Player's current hand (face-down for opponents)
- **Graveyard**: Cards that have been put into the graveyard
- **Exile**: Exiled cards
- **Library**: Player's deck (face-down)
- **Command Zone**: Commander/planechase cards (for Commander format)

### 3. Player Information
- Life total with heart icon
- Poison counters (when present)
- Commander damage tracking (for Commander format)
- Active turn indicator with animated badge
- Player name display

### 4. Interactive Elements
- Hover tooltips showing zone information
- Click handlers for cards and zones
- Visual feedback on hover states
- Card count indicators for each zone

### 5. Visual Design
- Color-coded zones for easy identification:
  - Battlefield: Green tint
  - Library: Blue tint
  - Graveyard: Stone/brown tint
  - Exile: Sky blue tint
  - Hand: Primary color tint
  - Command Zone: Yellow/gold tint
- Card placeholders on battlefield showing creature positions
- Tapped/untapped visual indicators
- Border highlighting for current player (bottom position)

## Component Architecture

### Types (`/src/types/game.ts`)

```typescript
- PlayerCount: 1 | 2 | 4
- GameFormat: "commander" | "standard" | "modern" | etc.
- TurnPhase: "beginning" | "precombat_main" | etc.
- ZoneType: "battlefield" | "hand" | "graveyard" | "exile" | "library" | "command"
- CardState: Card data with zone, tap status, counters, etc.
- PlayerState: All zone data and player metadata
- GameState: Complete game state with all players and turn info
```

### GameBoard Component (`/src/components/game-board.tsx`)

Main component that renders the game board based on player count.

**Props:**
- `players: PlayerState[]` - Array of player states
- `playerCount: PlayerCount` - Number of players (2 or 4)
- `currentTurnIndex: number` - Index of player whose turn it is
- `onCardClick?: (cardId: string, zone: ZoneType) => void` - Card click handler
- `onZoneClick?: (zone: ZoneType, playerId: string) => void` - Zone click handler

**Layout Strategy:**
- 2-player: Uses CSS Grid with `grid-rows-[1fr_auto_1fr]` for top/middle/bottom
- 4-player: Uses CSS Grid with `grid-cols-[200px_1fr_200px] grid-rows-[1fr_1fr]`

### PlayerArea Component

Sub-component that renders a single player's area with all their zones.

**Props:**
- `player: PlayerState` - Player data
- `isCurrentTurn: boolean` - Whether it's this player's turn
- `position: "top" | "bottom" | "left" | "right"` - Board position
- `orientation: "horizontal" | "vertical"` - Layout orientation
- `onCardClick` / `onZoneClick` - Interaction handlers

### ZoneDisplay Component

Micro-component for rendering individual zones with tooltips and click handlers.

## Demo Page (`/src/app/(app)/game-board/page.tsx`)

Interactive demonstration page featuring:
- Player count selector (2 or 4 players)
- Mock data generator for realistic card distributions
- Turn advancement controls
- Life total adjustment buttons (+/- 1, +/- 5)
- Toast notifications for interactions
- Feature checklist and instructions

**Access:** Navigate to `/game-board` in the app, or click "Game Board Demo" in the sidebar.

## Usage Example

```tsx
import { GameBoard } from "@/components/game-board";
import { PlayerState } from "@/types/game";

function MyGamePage() {
  const players: PlayerState[] = [ /* player data */ ];
  const currentTurnIndex = 0;

  const handleCardClick = (cardId: string, zone: ZoneType) => {
    console.log(`Clicked ${cardId} in ${zone}`);
  };

  const handleZoneClick = (zone: ZoneType, playerId: string) => {
    console.log(`Clicked ${zone} for player ${playerId}`);
  };

  return (
    <GameBoard
      players={players}
      playerCount={2}
      currentTurnIndex={currentTurnIndex}
      onCardClick={handleCardClick}
      onZoneClick={handleZoneClick}
    />
  );
}
```

## Future Enhancements (Phase 2.2+)

- [ ] Card face rendering with actual card images
- [ ] Card selection and multi-select functionality
- [ ] Stack display in the center
- [ ] Turn phase indicator
- [ ] Mana pool display
- [ ] Detailed zone viewers (modal/panel)
- [ ] Card dragging and drop
- [ ] Combat phase visual indicators
- [ ] Animated card movements between zones
- [ ] Commander casting cost display
- [ ] Experience counters and other commander-specific trackers

## Accessibility Features

- Semantic HTML structure
- ARIA labels via Radix UI primitives
- Keyboard navigation support (via Shadcn/ui components)
- Tooltip providers for additional information
- High contrast visual indicators
- Clear visual hierarchy

## Browser Support

- Modern browsers with CSS Grid support
- Responsive design works on tablets and desktops
- Mobile layout improvements planned for Phase 5

## Performance Considerations

- React.memo recommended for PlayerArea if many re-renders
- Virtual scrolling recommended for large zones (100+ cards)
- Lazy loading for card images in future phases
- Optimized re-render via proper key usage

## Related Components

- `/src/app/(app)/single-player/page.tsx` - Will integrate GameBoard
- `/src/app/(app)/multiplayer/page.tsx` - Will integrate GameBoard
- `/src/components/ui/` - Shadcn/ui components used throughout
- `/src/lib/game-rules.ts` - Format rules for game configuration
