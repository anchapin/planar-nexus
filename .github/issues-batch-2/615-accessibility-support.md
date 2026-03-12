# Add Accessibility Support to Game Board

**Priority:** 🟠 HIGH  
**Labels:** `high`, `accessibility`, `a11y`, `ui`  
**Milestone:** v0.2.0 Accessibility  
**Estimated Effort:** 3-4 days

---

## Description

Game board components **lack ARIA labels, keyboard navigation, and screen reader support**, violating WCAG 2.1 guidelines and excluding users with disabilities.

---

## Affected Files

- `src/components/game-board.tsx`
- `src/components/hand-display.tsx`
- `src/components/zone-display.tsx`
- `src/app/(app)/game/[id]/page.tsx`
- All interactive game components

---

## Missing Features

### 1. ARIA Labels
- [ ] No labels on card buttons
- [ ] No labels on zone containers
- [ ] No labels on phase indicators
- [ ] No live regions for game state changes

### 2. Keyboard Navigation
- [ ] Cannot navigate with Tab key
- [ ] Cannot activate cards with Enter/Space
- [ ] Cannot navigate zones with arrow keys
- [ ] No focus indicators

### 3. Screen Reader Support
- [ ] No announcements for game state changes
- [ ] No descriptions for card abilities
- [ ] No context for current phase
- [ ] No feedback for actions

---

## Required Changes

### Step 1: Add ARIA Labels

```typescript
// src/components/game-board.tsx

// ❌ Before
<div className="battlefield">
  {battlefield.map(card => (
    <Card key={card.id} card={card} />
  ))}
</div>

// ✅ After
<div 
  className="battlefield"
  role="region"
  aria-label="Battlefield"
  aria-describedby="battlefield-description"
>
  <span id="battlefield-description" className="sr-only">
    {battlefield.length} permanents on battlefield
  </span>
  {battlefield.map(card => (
    <Card 
      key={card.id} 
      card={card}
      aria-label={`${card.name}, ${card.power}/${card.toughness} creature`}
    />
  ))}
</div>
```

### Step 2: Add Keyboard Navigation

```typescript
// src/components/hand-display.tsx

interface HandDisplayProps {
  cards: Card[];
  onCardSelect: (card: Card) => void;
}

export function HandDisplay({ cards, onCardSelect }: HandDisplayProps) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  
  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault();
        onCardSelect(cards[index]);
        break;
      case 'ArrowRight':
        event.preventDefault();
        setFocusedIndex((prev) => (prev + 1) % cards.length);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        setFocusedIndex((prev) => (prev - 1 + cards.length) % cards.length);
        break;
    }
  };
  
  return (
    <div 
      className="hand"
      role="list"
      aria-label="Your hand"
    >
      {cards.map((card, index) => (
        <button
          key={card.id}
          role="listitem"
          aria-label={card.name}
          aria-current={index === focusedIndex ? 'true' : undefined}
          tabIndex={index === focusedIndex ? 0 : -1}
          onFocus={() => setFocusedIndex(index)}
          onKeyDown={(e) => handleKeyDown(e, index)}
          className={cn(
            'card',
            index === focusedIndex && 'focused'
          )}
        >
          <CardImage card={card} />
        </button>
      ))}
    </div>
  );
}
```

### Step 3: Add Live Regions

```typescript
// src/app/(app)/game/[id]/page.tsx

export function GamePage() {
  const [gameState, setGameState] = useState<GameState>(initialState);
  const [lastAction, setLastAction] = useState('');
  
  useEffect(() => {
    // Update screen readers when game state changes
    setLastAction(`Game state updated: ${getCurrentPhase(gameState)}`);
  }, [gameState]);
  
  return (
    <div>
      {/* Live region for screen readers */}
      <div 
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {lastAction}
      </div>
      
      {/* Game board */}
      <GameBoard gameState={gameState} />
    </div>
  );
}
```

### Step 4: Add Focus Indicators

```css
/* tailwind.config.ts */
module.exports = {
  theme: {
    extend: {
      ringColor: {
        focus: 'var(--focus-ring-color)',
      },
    },
  },
}
```

```css
/* globals.css */
:focus {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: 2px;
}

:focus:not(:focus-visible) {
  outline: none;
}

:focus-visible {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: 2px;
}
```

---

## Acceptance Criteria

- [ ] **WCAG 2.1 AA compliant**
- [ ] **Fully navigable** with keyboard only
- [ ] **Screen reader** announces game state
- [ ] **Focus indicators** visible on all interactive elements
- [ ] **Accessibility tests** pass
- [ ] **Tested with** NVDA/VoiceOver

---

## Testing

### Manual Testing Checklist

#### Keyboard Navigation
- [ ] Can navigate all elements with Tab
- [ ] Can activate buttons with Enter/Space
- [ ] Can navigate hand with arrow keys
- [ ] Can exit game with Escape
- [ ] Focus is always visible

#### Screen Readers
- [ ] Card names announced
- [ ] Game state changes announced
- [ ] Current phase announced
- [ ] Action feedback provided

#### Visual
- [ ] Focus indicators visible
- [ ] High contrast mode works
- [ ] Text is readable at 200% zoom

### Automated Testing

```typescript
// src/__tests__/accessibility.test.tsx
import { axe, toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

describe('Accessibility', () => {
  it('should have no accessibility violations', async () => {
    const { container } = render(<GameBoard gameState={testState} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
  
  it('should be keyboard navigable', async () => {
    const { user } = render(<GameBoard gameState={testState} />);
    
    // Tab through all elements
    await user.tab();
    expect(screen.getByRole('button', { name: /forest/i })).toHaveFocus();
    
    await user.tab();
    expect(screen.getByRole('button', { name: /plains/i })).toHaveFocus();
  });
});
```

---

## Related Issues

- None - this is a new feature

---

## Resources

### Guidelines
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)

### Tools
- [axe DevTools](https://www.deque.com/axe/devtools/)
- [WAVE](https://wave.webaim.org/)
- [Lighthouse Accessibility Audit](https://developer.chrome.com/docs/lighthouse/overview/)

### Screen Readers
- [NVDA (Windows, Free)](https://www.nvaccess.org/download/)
- [VoiceOver (macOS, Built-in)](https://www.apple.com/accessibility/mac/vision/)
- [JAWS (Windows, Paid)](https://www.freedomscientific.com/products/software/jaws/)

---

## Implementation Order

1. **Day 1:** Add ARIA labels to all components
2. **Day 2:** Implement keyboard navigation
3. **Day 3:** Add live regions and screen reader support
4. **Day 4:** Test with screen readers, fix issues

---

## Priority Features

### Must Have (MVP)
- Keyboard navigation
- ARIA labels
- Focus indicators
- Live regions for game state

### Should Have
- High contrast mode
- Zoom support
- Reduced motion support

### Nice to Have
- Customizable key bindings
- Audio descriptions
- Haptic feedback
