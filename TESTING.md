# Testing Guide

This document outlines the testing philosophy, patterns, and best practices for the Planar Nexus project.

## Testing Stack

- **Jest** - Test runner and assertion library
- **React Testing Library** - Component testing utilities
- **MSW (Mock Service Worker)** - API mocking for integration tests
- **Playwright** - E2E testing framework

## Running Tests

```bash
# Run all tests
npm test

# Run tests with coverage
npm test -- --coverage

# Run tests in watch mode
npm test -- --watch

# Run specific test file
npm test -- --testPathPattern="component-name"

# Run E2E tests
npm run test:e2e
```

## Project Structure

```
src/
├── __tests__/           # Unit tests colocated with source
│   └── utils/
│       └── some-util.test.ts
├── test-utils/          # Shared test utilities
│   ├── index.ts         # Main exports
│   ├── helpers/         # Test helper functions
│   ├── factories/       # Test data factories
│   ├── mocks/           # Mock implementations
│   └── msw/             # MSW handlers
tests/
├── integration/         # Integration tests
│   └── server-actions.test.ts
└── e2e/                # E2E tests
    └── user-flow.spec.ts
```

## Test File Naming

- Unit tests: `*.test.ts` or `*.test.tsx` colocated with source
- Integration tests: `*.test.ts` in `tests/integration/`
- E2E tests: `*.spec.ts` in `tests/e2e/`

## Testing Patterns

### Basic Test Structure

```typescript
describe('ModuleName', () => {
  describe('functionName', () => {
    it('should do something specific', () => {
      // Arrange
      const input = ...;
      
      // Act
      const result = functionName(input);
      
      // Assert
      expect(result).toBe(expected);
    });

    it('should handle error case', async () => {
      await expect(asyncFunction()).rejects.toThrow('error');
    });
  });
});
```

### Testing React Components

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { ComponentName } from './ComponentName';

describe('ComponentName', () => {
  const defaultProps = { /* ... */ };

  beforeEach(() => {
    // Common setup
  });

  it('renders correctly', () => {
    render(<ComponentName {...defaultProps} />);
    expect(screen.getByText('Expected')).toBeInTheDocument();
  });

  it('handles user interaction', () => {
    const onClick = vi.fn();
    render(<ComponentName onClick={onClick} {...defaultProps} />);
    
    fireEvent.click(screen.getByRole('button'));
    
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
```

### Testing Server Actions

```typescript
import { actionName } from '@/app/actions';
import { server } from '@/test-utils/msw';
import { http, HttpResponse } from 'msw';

describe('server action', () => {
  beforeAll(() => {
    // Setup MSW
    server.use(
      http.get('/api/endpoint', () => {
        return HttpResponse.json({ data: 'mocked' });
      })
    );
  });

  it('returns expected data', async () => {
    const result = await actionName();
    expect(result).toEqual({ data: 'mocked' });
  });
});
```

### Using Test Factories

```typescript
import { createMockCard, createMockDeck } from '@/test-utils';

// Create test data quickly
const card = createMockCard({ name: 'Lightning Bolt' });
const deck = createMockDeck({
  name: 'Test Deck',
  cards: [card, createMockCard()],
});
```

### Mocking Dependencies

```typescript
// Mock a module
vi.mock('@/some/module', () => ({
  someFunction: vi.fn().mockReturnValue('mocked'),
}));

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
global.localStorage = localStorageMock;
```

## When to Use Different Test Types

### Unit Tests

**Use for:**
- Pure functions and utilities
- Custom React hooks
- Business logic
- Fast feedback during development

**Example:**
```typescript
// src/lib/utils.test.ts
import { calculateManaCurve } from './utils';

describe('calculateManaCurve', () => {
  it('should calculate correct curve from deck', () => {
    const deck = { cards: [/* cards with cmc 1, 1, 2, 3 */] };
    const curve = calculateManaCurve(deck);
    expect(curve).toEqual({ 1: 2, 2: 1, 3: 1 });
  });
});
```

### Integration Tests

**Use for:**
- Server actions and API routes
- Component interactions
- Database operations
- Testing multiple units working together

**Example:**
```typescript
// tests/integration/deck-creation.test.ts
import { createDeck, saveDeck } from '@/app/actions';

describe('Deck Creation Flow', () => {
  it('should create and persist a deck', async () => {
    // Create deck
    const deck = await createDeck({ name: 'My Deck' });
    expect(deck.id).toBeDefined();
    
    // Add cards
    const updated = await addCard(deck.id, 'Lightning Bolt');
    expect(updated.cards).toHaveLength(1);
  });
});
```

### E2E Tests

**Use for:**
- Critical user flows
- Full-stack interactions
- Browser-specific behavior
- Payment flows (if applicable)

**Example:**
```typescript
// tests/e2e/deck-builder.spec.ts
import { test, expect } from '@playwright/test';

test('complete deck building flow', async ({ page }) => {
  await page.goto('/deck-builder');
  
  // Search for cards
  await page.fill('[data-testid="search"]', 'Lightning');
  await page.click('[data-testid="search-button"]');
  
  // Add card to deck
  await page.click('[data-testid="add-card"]:first-child');
  
  // Verify card added
  await expect(page.locator('.deck-list')).toContainText('Lightning');
});
```

## Decision Guide

### Quick Decision Matrix

| Scenario | Test Type |
|----------|-----------|
| Pure function/utility | Unit |
| Custom hook | Unit |
| Single component | Unit/Integration |
| Component + state | Integration |
| Server action | Integration |
| API endpoint | Integration |
| User flow | E2E |
| Critical path | E2E |

### When to Choose E2E over Integration

Choose E2E when:
- Testing requires real browser behavior
- Need to verify DOM rendering in real browser
- Testing complex user interactions
- Validating actual network requests (not mocked)
- Critical path that must work in production

Choose Integration when:
- Can mock external dependencies
- Faster feedback needed
- Testing implementation details acceptable
- Isolated testing sufficient

## Test Utilities

The project provides common utilities in `@/test-utils`:

### Main Exports

```typescript
// src/test-utils/index.ts
export * from './helpers/render';
export * from './helpers/wait-for';
export * from './factories/card';
export * from './factories/deck';
export * from './msw/server';
export * from './msw/handlers';
```

### Available Helpers

- `renderWithProviders` - Render component with all providers
- `createMockStore` - Create mock Redux/store state
- `waitForLoadingToFinish` - Wait for loading states
- `mockRouter` - Mock Next.js router

### Available Factories

- `createMockCard` - Create test card data
- `createMockDeck` - Create test deck data
- `createMockPlayer` - Create test player data
- `createMockGameState` - Create test game state

### MSW Setup

```typescript
// Setup in test file
import { server } from '@/test-utils/msw/server';

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

## Coverage Goals

The project enforces the following coverage thresholds:

| Metric | Target |
|--------|--------|
| Lines | 70% |
| Functions | 70% |
| Statements | 70% |
| Branches | 60% |

Run coverage report:

```bash
npm test -- --coverage
```

Reports are generated in:
- `coverage/lcov-report/index.html` - HTML report
- `coverage/lcov.info` - LCOV format for CI tools

## Best Practices

1. **Test behavior, not implementation** - Focus on what, not how
2. **Use meaningful test names** - `it('should create deck with name')` not `it('works')`
3. **AAA pattern** - Arrange, Act, Assert
4. **One assertion per test** - Easier to debug failures
5. **Avoid testing implementation details** - Test user-visible behavior
6. **Keep tests fast** - Unit tests should run in milliseconds
7. **Mock external dependencies** - Don't rely on external APIs
8. **Use data-testid for complex queries** - More stable than DOM selectors

## Debugging Tests

```bash
# Run single test
npm test -- --testNamePattern="test name"

# Debug in browser
npm test -- --watch

# Print console logs in tests
npm test -- --verbose

# Coverage report
npm test -- --coverage --coverageReporters=text
```

## CI Integration

Tests run automatically on:
- Pull requests
- Push to main branch
- Pre-commit hooks (lint-staged)

See `.github/workflows/ci.yml` for configuration.
