# Test Utilities Library

A comprehensive testing utilities library for consistent, maintainable tests across the Planar Nexus codebase.

## Overview

This library provides:

- **React Component Test Helpers** - Wrap components with providers, custom queries
- **Mock Implementations** - Fetch, localStorage, sessionStorage, Next.js Router
- **Test Data Factories** - Create consistent card, deck, and game state data
- **User Event Helpers** - Pre-configured userEvent with custom card game interactions

## Installation

The test-utils are available via the `@/test-utils` path alias:

```typescript
import { renderWithProviders, createCard, mockFetch } from '@/test-utils';
```

## Usage

### Render with Providers

Wrap components with all necessary providers:

```typescript
import { renderWithProviders } from '@/test-utils/helpers/render';
import { MyComponent } from '@/components/MyComponent';

test('renders correctly', () => {
  const { rerender, unmount } = renderWithProviders(<MyComponent />);
  
  // Component is rendered with SidebarProvider and Toaster
  
  unmount();
});
```

### Custom Providers

Override default providers:

```typescript
import { renderWithProviders } from '@/test-utils/helpers/render';

test('with custom provider', () => {
  const { rerender } = renderWithProviders(<MyComponent />, {
    wrapper: ({ children }) => (
      <CustomProvider>
        {children}
      </CustomProvider>
    ),
  });
});
```

### Screen Queries

Use custom query helpers:

```typescript
import { cardQueries, deckQueries, roleQueries } from '@/test-utils/helpers/queries';
import { renderWithProviders } from '@/test-utils/helpers/render';

test('card queries work', () => {
  renderWithProviders(<CardList />);
  
  // Query by card name
  const card = cardQueries.getByCardName('Lightning Bolt');
  
  // Query by deck title
  const deck = deckQueries.getByDeckTitle('My Commander Deck');
  
  // Role-based queries
  const button = roleQueries.getButton('Submit');
});
```

### User Event

Pre-configured user event with card game helpers:

```typescript
import { setupUserEvent, renderWithProviders } from '@/test-utils';

test('click card', async () => {
  const { user, clickCard, addToDeck } = setupUserEvent();
  renderWithProviders(<CardComponent />);
  
  const card = screen.getByTestId('card-lightning-bolt');
  await clickCard(card);
  
  // Or use the full setup
  const card2 = screen.getByTestId('card-shock');
  await addToDeck(card2, screen.getByTestId('deck-my-deck'));
});
```

### Mock Fetch

Mock Scryfall API responses:

```typescript
import { mockFetch, mockScryfallSearch, MOCK_CARDS } from '@/test-utils/__mocks__/fetch';

beforeEach(() => {
  mockGlobalFetch();
});

test('search cards', async () => {
  mockScryfallSearch([MOCK_CARDS.lightningBolt, MOCK_CARDS.birdsOfParadise]);
  
  const response = await fetch('https://api.scryfall.com/cards/search?q=lightning');
  const data = await response.json();
  
  expect(data.data).toHaveLength(2);
});
```

### Mock Storage

Mock localStorage and sessionStorage:

```typescript
import { 
  mockStorageForTesting, 
  setLocalStorageData,
  getLocalStorageData 
} from '@/test-utils/__mocks__/storage';

beforeEach(() => {
  mockStorageForTesting();
});

test('localStorage works', () => {
  setLocalStorageData({ 'my-deck': JSON.stringify({ name: 'Test Deck' }) });
  
  const data = getLocalStorageData();
  expect(data['my-deck']).toBe('{"name":"Test Deck"}');
});
```

### Mock Router

Mock Next.js useRouter:

```typescript
import { mockUseRouter } from '@/test-utils/__mocks__/next-router';

test('navigation works', () => {
  const mockPush = jest.fn();
  mockUseRouter({ 
    pathname: '/deck-builder',
    push: mockPush 
  });
  
  // Component uses useRouter
  render(<MyComponent />);
  
  expect(mockPush).toHaveBeenCalledWith('/dashboard');
});
```

### Card Factory

Create test card data:

```typescript
import { createCard, createLand, createCreature, createSpell } from '@/test-utils/factories/card';

// Basic card
const card = createCard({ name: 'Lightning Bolt' });

// Creature with stats
const creature = createCreature({ 
  name: 'Grizzly Bears',
  power: '2',
  toughness: '2'
});

// Land
const land = createLand({ name: 'Forest' });

// Spell
const spell = createSpell({ name: 'Counterspell' });
```

### Deck Factory

Create test deck data:

```typescript
import { createDeck, createCommanderDeck, createLimitedDeck } from '@/test-utils/factories/deck';

// Basic deck
const deck = createDeck({ name: 'My Deck' });

// Commander deck (100 cards)
const commander = createCommanderDeck({ name: 'Jhoira Tribal' });

// Limited deck (40 cards)
const limited = createLimitedDeck();

// Standard deck (60 cards)
const standard = createStandardDeck();
```

### Game State Factory

Create test game state:

```typescript
import { createGameState, createCombatState, createMulliganState } from '@/test-utils/factories/game-state';

// Basic game state
const state = createGameState();

// During combat
const combat = createCombatState();

// During mulligan
const mulligan = createMulliganState({ playerHandSize: 7 });
```

## API Reference

### Helpers

| Export | Description |
|--------|-------------|
| `renderWithProviders` | Render with SidebarProvider and Toaster |
| `renderInAppContext` | Render within app layout context |
| `cardQueries` | Query helpers for card components |
| `deckQueries` | Query helpers for deck components |
| `zoneQueries` | Query helpers for game zones |
| `playerQueries` | Query helpers for players |
| `asyncQueries` | Async query helpers for loading states |
| `roleQueries` | Role-based queries (button, link, etc.) |
| `setupUserEvent` | Create configured user event with helpers |

### Mocks

| Export | Description |
|--------|-------------|
| `mockFetch` | Mock global fetch with Scryfall responses |
| `mockScryfallSearch` | Mock card search results |
| `mockScryfallCard` | Mock single card response |
| `mockLocalStorage` | localStorage mock instance |
| `mockSessionStorage` | sessionStorage mock instance |
| `mockStorageForTesting` | Setup both storage mocks |
| `mockUseRouter` | Mock Next.js useRouter hook |

### Factories

| Export | Description |
|--------|-------------|
| `createCard` | Create a basic card |
| `createLand` | Create a land card |
| `createCreature` | Create a creature card |
| `createSpell` | Create a spell card |
| `createDeck` | Create a basic deck |
| `createCommanderDeck` | Create a 100-card Commander deck |
| `createLimitedDeck` | Create a 40-card Limited deck |
| `createStandardDeck` | Create a 60-card Standard deck |
| `createGameState` | Create a game state |
| `createCombatState` | Create a combat phase game state |
| `createMulliganState` | Create a mulligan phase game state |

## Best Practices

1. **Use factories for test data** - Ensures consistency and reduces boilerplate
2. **Reset mocks between tests** - Call cleanup functions in `beforeEach`
3. **Use renderWithProviders** - Components depend on providers
4. **Use setupUserEvent in each test** - Ensures fresh event state
5. **Prefer role queries over test IDs** - More accessible tests

## Writing Tests

```typescript
import { 
  renderWithProviders, 
  setupUserEvent,
  createDeck,
  mockUseRouter,
  mockStorageForTesting 
} from '@/test-utils';
import { DeckBuilder } from '@/components/DeckBuilder';

describe('DeckBuilder', () => {
  beforeEach(() => {
    mockStorageForTesting();
    mockUseRouter({ pathname: '/deck-builder' });
  });

  it('adds card to deck', async () => {
    const { user } = setupUserEvent();
    const testDeck = createDeck({ name: 'Test Deck' });
    
    renderWithProviders(<DeckBuilder initialDeck={testDeck} />);
    
    const card = screen.getByTestId('card-lightning-bolt');
    const addButton = screen.getByRole('button', { name: 'Add to Deck' });
    
    await user.click(card);
    await user.click(addButton);
    
    expect(screen.getByText('1 card added')).toBeInTheDocument();
  });
});
```
