# Game Board Visual Design Specification

## Design Philosophy

The game board follows MTG's spatial conventions while optimizing for digital play:
- **Opponent at top** - Traditional digital game convention
- **Your area at bottom** - Full visibility, easy interaction
- **Battlefield center** - Clear visual hierarchy
- **Zone positioning** - Logical MTG layout: library→battlefield→graveyard (left-to-right flow)

## Layout Specifications

### 2-Player Layout (1v1)

```
┌─────────────────────────────────────────────────────────────┐
│  [Opponent Name] [Life: 20]                    [Active Turn] │
│  ┌─────────┬─────────┬─────────┬─────────┐                   │
│  │ Library │ Grave   │ Exile   │ Hand (?)│                   │
│  │   40    │   12    │    3    │    5    │                   │
│  └─────────┴─────────┴─────────┴─────────┘                   │
│  ┌─────────────────────────────────────────┐                │
│  │          Battlefield (7 cards)          │                │
│  └─────────────────────────────────────────┘                │
├─────────────────────────────────────────────────────────────┤
│                   [Turn: Opponent]                          │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│  [Your Name] [Life: 20]                                     │
│  ┌─────────┬─────────┬─────────┬─────────┐                   │
│  │ Library │ Grave   │ Exile   │ Hand    │                   │
│  │   36    │    8    │    1    │    7    │                   │
│  └─────────┴─────────┴─────────┴─────────┘                   │
│  ┌─────────────────────────────────────────┐                │
│  │          Battlefield (6 cards)          │                │
│  └─────────────────────────────────────────┘                │
└─────────────────────────────────────────────────────────────┘
```

### 4-Player Layout (Commander)

```
┌─────────────────────────────────────────────────────────────────┐
│                          ┌───────────────────┐                  │
│                          │  Player 1 (Top)   │                  │
│                          │  [Life: 40]       │                  │
│                          │  Cmdr: 3 dmg      │                  │
│                          └───────────────────┘                  │
├────────────┬──────────────────────────────────┬────────────────┤
│            │       ┌──────────────────┐       │                │
│  Player 2  │       │   Turn: P1       │       │   Player 3     │
│  (Left)    │       │   Stack: 0       │       │   (Right)      │
│  [Life: 38]│       └──────────────────┘       │   [Life: 35]   │
│  Cmdr: 0   │                                  │   Cmdr: 8      │
│            │                                  │                │
│  Library   │                                  │   Library      │
│  Grave     │                                  │   Grave        │
│  Exile     │                                  │   Exile        │
│  Hand (?)  │                                  │   Hand (?)     │
│  Battlefield│                                 │  Battlefield   │
│            │                                  │                │
├────────────┴──────────────────────────────────┴────────────────┤
│                        ┌───────────────────┐                   │
│                        │   Player 4 (You)  │                   │
│                        │   [Life: 32]      │                   │
│                        │   Cmdr: 0, 5, 0   │                   │
│                        │   [Active Turn]   │                   │
│                        └───────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

## Zone Sizing

### Desktop (> 1280px)
- Battlefield: 320px height (large)
- Hand: 96px height (default) / 64px (small)
- Library/Grave/Exile: 64px height (small)
- Command Zone: 64px height (small)

### Tablet (768px - 1280px)
- All zones scaled to 80%
- Reduced card placeholder sizes
- Smaller fonts

### Mobile (< 768px)
- Vertical stacking planned for Phase 5
- Zone tabs/accordion for space efficiency

## Color Scheme

| Zone | Background | Border | Purpose |
|------|------------|--------|---------|
| Battlefield | `bg-green-500/10` | `border-primary/30` | Creature presence |
| Library | `bg-blue-500/10` | Default | Card drawing |
| Graveyard | `bg-stone-500/10` | Default | Death theme |
| Exile | `bg-sky-500/10` | Default | Out of game |
| Hand | `bg-primary/10` | `border-primary/30` | Current actions |
| Command | `bg-yellow-500/10` | `border-yellow-500/30` | Special zone |

## Typography

- Player names: `font-medium text-sm`
- Life totals: `font-mono font-bold text-2xl`
- Zone labels: Tooltips on hover
- Counters: `font-mono font-bold` with color coding

## Icons

- Life: `<Heart className="text-red-500" />`
- Poison: `<Skull className="text-purple-500" />`
- Active turn: `<Crown className="animate-pulse" />`
- Library: `<Library />`
- Graveyard: `<Skull />`
- Exile: `<Ban />`
- Hand: `<Hand />`
- Command: `<Crown />`

## Interactive States

### Hover
- Zones: `hover:border-primary/50`
- Cards: `hover:scale-105`
- Buttons: Standard Shadcn hover

### Active/Focus
- Current player: `border-2 border-primary/20`
- Tapped cards: Reduced opacity
- Selected cards: Highlight border (future)

### Disabled
- Opponent's hand: Click-through (no interaction)
- Face-down cards: No card details

## Animation

- Turn indicator: `animate-pulse` on active player badge
- Card interactions: `transition-all duration-200`
- Zone hover: `transition-colors`
- Future: Card movement animations between zones

## Accessibility

- All zones have `aria-label` via Tooltip
- Keyboard navigation: Tab through interactive zones
- High contrast mode support via CSS variables
- Screen reader announcements for turn changes
- Focus indicators on all interactive elements

## Responsive Breakpoints

```css
/* Desktop - Full layout */
@media (min-width: 1280px) { /* Current implementation */ }

/* Tablet - Scaled layout */
@media (min-width: 768px) and (max-width: 1279px) { /* Scale to 80% */ }

/* Mobile - Redesigned layout */
@media (max-width: 767px) { /* Phase 5 implementation */ }
```

## Future Phases

### Phase 2.2 - Card Rendering
- Actual card images from Scryfall
- Card face/face-down toggle
- Token representation
- Card size variations

### Phase 2.3 - Zone Viewers
- Modal popups for zone contents
- Card search/filter within zones
- Graveyard viewer with card details
- Exile zone inspector

### Phase 2.4 - Stack Display
- Central stack visualization
- Priority indicator
- Resolve order display
- Stack size badge

### Phase 2.5 - Mana System
- Mana pool display
- Color-coded mana indicators
- Floating mana display
- Mana payment UI

## Component Dependencies

```
GameBoard
├── PlayerArea
│   └── ZoneDisplay
│       ├── Tooltip (Shadcn)
│       ├── Badge (Shadcn)
│       └── Button (Shadcn)
├── Card (Shadcn)
└── Separator (Shadcn)
```
