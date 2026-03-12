# Add Integration Tests for Game Engine + UI

**Priority:** 🟠 HIGH  
**Labels:** `high`, `tests`, `integration`  
**Milestone:** v0.2.0 Testing  
**Estimated Effort:** 5-7 days

---

## Description

All 26 test files are **unit tests**. **No integration tests** exist for game engine + UI interaction, leaving critical integration points untested.

CI passes but the product doesn't work because the engine is never tested with the UI.

---

## Missing Test Coverage

### Critical Integration Points
- [ ] Game engine → UI rendering
- [ ] User actions → Game state updates
- [ ] Multiplayer synchronization
- [ ] AI opponent gameplay
- [ ] Full game flow (start to finish)
- [ ] Card interactions
- [ ] Combat sequence
- [ ] Stack resolution

---

## Required Changes

### Step 1: Set Up Testing Infrastructure

```typescript
// src/__tests__/utils/test-utils.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInitialGameState } from '@/lib/game-state';
import { GameBoard } from '@/components/game-board';

export function setupGame(options: {
  playerCount?: number;
  withAI?: boolean;
  initialLife?: number;
} = {}) {
  const gameState = createInitialGameState({
    playerCount: options.playerCount || 2,
    playerDecks: [createTestDeck(), createTestDeck()],
  });
  
  const utils = render(
    <GameBoard
      gameState={gameState}
      onAction={jest.fn()}
      currentPlayerId="player1"
    />
  );
  
  return {
    gameState,
    ...utils,
    user: userEvent.setup(),
  };
}

export function createTestDeck() {
  return {
    mainDeck: [
      createTestCard('Forest', 'land'),
      createTestCard('Llanowar Elves', 'creature'),
      // ...
    ],
    sideboard: [],
  };
}

export function createTestCard(name: string, type: string) {
  return {
    id: `card-${name}`,
    name,
    type,
    // ... other properties
  };
}
```

### Step 2: Add Core Gameplay Tests

```typescript
// src/__tests__/integration/gameplay.test.tsx
import { setupGame } from '../utils/test-utils';

describe('Gameplay Integration', () => {
  it('should play a land from hand', async () => {
    const { gameState, user } = setupGame();
    
    // Find and click a land in hand
    const land = screen.getByText('Forest');
    await user.click(land);
    
    // Click play land button
    const playButton = screen.getByText('Play Land');
    await user.click(playButton);
    
    // Verify land is on battlefield
    expect(screen.getByText('Forest')).toBeInTheDocument();
    expect(gameState.zones.battlefield.cards).toHaveLength(1);
  });
  
  it('should cast a creature spell', async () => {
    const { gameState, user } = setupGame();
    
    // Tap land for mana
    const forest = screen.getByText('Forest');
    await user.click(forest);
    
    // Cast creature
    const creature = screen.getByText('Llanowar Elves');
    await user.click(creature);
    
    // Verify creature on battlefield
    expect(screen.getByText('Llanowar Elves')).toBeInTheDocument();
  });
  
  it('should resolve combat correctly', async () => {
    const { gameState, user } = setupGame();
    
    // Setup: Both players have creatures
    // ... setup code ...
    
    // Move to combat
    const combatButton = screen.getByText('Begin Combat');
    await user.click(combatButton);
    
    // Declare attackers
    const attacker = screen.getByText('Grizzly Bears');
    await user.click(attacker);
    
    // Declare blockers
    const blocker = screen.getByText('Balduvian Bears');
    await user.click(blocker);
    
    // Verify damage dealt
    expect(gameState.players['player2'].life).toBe(18);
  });
  
  it('should enforce one land per turn', async () => {
    const { gameState, user } = setupGame();
    
    // Play first land
    await user.click(screen.getByText('Forest'));
    await user.click(screen.getByText('Play Land'));
    
    // Try to play second land
    await user.click(screen.getByText('Mountain'));
    
    // Should show error or not allow
    expect(screen.getByText(/already played a land/i)).toBeInTheDocument();
  });
});
```

### Step 3: Add Multiplayer Tests

```typescript
// src/__tests__/integration/multiplayer.test.tsx
describe('Multiplayer Integration', () => {
  it('should sync game state between peers', async () => {
    // Setup two players
    const { gameState: player1State } = setupGame({ playerCount: 2 });
    const { gameState: player2State } = setupGame({ playerCount: 2 });
    
    // Player 1 plays land
    // ... action ...
    
    // Verify player 2 sees the change
    expect(player2State.zones.battlefield.cards).toHaveLength(1);
  });
  
  it('should handle simultaneous actions', async () => {
    // Test conflict resolution
  });
});
```

### Step 4: Add AI Integration Tests

```typescript
// src/__tests__/integration/ai-opponent.test.tsx
describe('AI Opponent Integration', () => {
  it('should execute AI turn correctly', async () => {
    const { gameState, user } = setupGame({ withAI: true });
    
    // Wait for AI turn
    await waitFor(() => {
      expect(screen.getByText(/AI is thinking/i)).toBeInTheDocument();
    });
    
    // Verify AI made a move
    await waitFor(() => {
      expect(gameState.zones.battlefield.cards.length).toBeGreaterThan(0);
    });
  });
  
  it('should respond to player actions', async () => {
    const { gameState, user } = setupGame({ withAI: true });
    
    // Player makes a move
    await user.click(screen.getByText('Forest'));
    
    // AI should respond
    await waitFor(() => {
      expect(gameState.priorityPlayerId).toBe('ai');
    });
  });
});
```

---

## Acceptance Criteria

- [ ] **20+ integration tests** covering core flows
- [ ] **All tests passing** in CI
- [ ] **80%+ code coverage**
- [ ] **Tests run** in under 5 minutes
- [ ] **Tests are reliable** (no flakiness)
- [ ] **Documentation** for writing tests

---

## Test Coverage Goals

| Area | Current | Target |
|------|---------|--------|
| Unit Tests | 726 tests | 726 tests |
| Integration Tests | 0 tests | 20+ tests |
| E2E Tests | 3 tests | 10+ tests |
| Coverage | ~60% | 80%+ |

---

## Testing Infrastructure

### Required Dependencies
```json
{
  "devDependencies": {
    "@testing-library/react": "^15.0.0",
    "@testing-library/user-event": "^14.5.0",
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/dom": "^10.0.0"
  }
}
```

### Jest Configuration
```javascript
// jest.config.js
module.exports = {
  testMatch: [
    '**/__tests__/**/*.test.[jt]s?(x)',
  ],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jsdom',
};
```

---

## Related Issues

- #515 (Fix test coverage failures)
- #542 (Restore CI pipeline)
- #602 (Connect game engine to UI)

---

## CI Integration

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run unit tests
        run: npm test
      
      - name: Run integration tests
        run: npm run test:integration
      
      - name: Run E2E tests
        run: npm run test:e2e
      
      - name: Upload coverage
        uses: codecov/codecov-action@v4
```

---

## Maintenance

### Test Review Checklist
- [ ] Tests are readable
- [ ] Tests are isolated
- [ ] Tests don't depend on timing
- [ ] Tests have clear assertions
- [ ] Tests cover edge cases

### Regular Maintenance
- Run tests weekly to catch flakiness
- Review test coverage monthly
- Update tests when features change
