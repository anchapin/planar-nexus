# Testing Guide

This is the **canonical** testing guide for Planar Nexus. It covers the testing
stack, where tests live, the patterns we expect, the video-derived fixture
pipeline, and how coverage is measured and enforced.

> If you are writing code, you are writing tests. See
> [Contributing › Testing requirements](./CONTRIBUTING.md#7-testing) for the
> rules that gate every pull request.

---

## Table of Contents

1. [Testing Stack](#1-testing-stack)
2. [Running Tests](#2-running-tests)
3. [Where Tests Live](#3-where-tests-live)
4. [Unit Tests (Jest)](#4-unit-tests-jest)
5. [Component Tests (React Testing Library)](#5-component-tests-react-testing-library)
6. [Integration Tests](#6-integration-tests)
7. [E2E Tests (Playwright)](#7-e2e-tests-playwright)
8. [Test Utilities (`@/test-utils`)](#8-test-utilities-testutils)
9. [Video-Derived Fixture Pipeline](#9-video-derived-fixture-pipeline)
10. [Coverage](#10-coverage)
11. [Decision Guide](#11-decision-guide)
12. [Debugging](#12-debugging)
13. [CI Integration](#13-ci-integration)

---

## 1. Testing Stack

| Layer            | Tool                                            | Config                  |
| ---------------- | ----------------------------------------------- | ----------------------- |
| Unit / component | [Jest](https://jestjs.io/) + `ts-jest`          | `jest.config.js`        |
| DOM assertions   | [React Testing Library](https://testing-library.com/) | `jest.setup.js`  |
| API mocking      | [MSW](https://mswjs.io/) (Mock Service Worker)  | `src/test-utils/msw/`   |
| E2E              | [Playwright](https://playwright.dev/)           | `playwright.config.ts`  |

The Jest test environment is `jsdom` (see `jest.config.js`). Path alias `@/*`
maps to `src/*`, matching `tsconfig.json`.

---

## 2. Running Tests

All commands below are defined in `package.json` (`scripts`):

```bash
# Run the full Jest suite
npm test

# Watch mode (re-runs on change)
npm run test:watch

# Coverage report (HTML + lcov + text-summary)
npm run test:coverage

# Run a single file / pattern
npm test -- --testPathPattern="archetype-detector"

# Run a single test by name
npm test -- --testNamePattern="should detect Burn"

# Playwright E2E (boots the dev server on port 9002 automatically)
npm run test:e2e

# Playwright UI mode
npx playwright test --ui

# Type-check + lint (always run before pushing)
npm run typecheck
npm run lint
```

---

## 3. Where Tests Live

Jest discovers tests via `testMatch` in `jest.config.js`, with `roots` set to
`<rootDir>/src` and `<rootDir>/tests`. There are three physical locations:

```
planar-nexus/
├── src/
│   ├── lib/
│   │   ├── game-state/
│   │   │   ├── types.ts
│   │   │   └── __tests__            ← co-located unit tests (preferred)
│   │   │       └── *.test.ts
│   │   └── __tests__/               ← lib-wide unit tests
│   ├── components/__tests__/        ← component unit tests
│   ├── ai/flows/__tests__/          ← AI flow unit tests
│   └── app/api/.../__tests__/       ← route handler unit tests
├── tests/                           ← repo-root INTEGRATION tests
│   ├── *.integration.test.ts
│   └── helpers/
└── e2e/                             ← Playwright E2E (testDir: './e2e')
    ├── *.spec.ts
    └── fixtures/
```

### Conventions

- **Co-located unit tests** — `__tests__/*.test.ts` (or `.test.tsx`) sitting
  next to the module under test. This is the default for new unit tests.
  Examples: `src/lib/game-state/__tests__/`, `src/ai/flows/__tests__/`.
- **`src/lib/__tests__/`** — unit tests that cover `src/lib` utilities and
  don't belong to a single sub-package.
- **Repo-root `tests/`** — integration tests (`*.integration.test.ts`) that
  exercise real cross-module workflows (see issue #931). Picked up by the
  `<rootDir>/tests/**/*.test.ts` matcher.
- **`e2e/`** — Playwright specs (`.spec.ts`). Driven by `playwright.config.ts`
  (`testDir: './e2e'`). Shared page objects/fixtures live in `e2e/fixtures/`.

### Naming

| Type         | Pattern                 | Location            |
| ------------ | ----------------------- | ------------------- |
| Unit         | `*.test.ts` / `.test.tsx` | co-located `__tests__/` |
| Integration  | `*.integration.test.ts` | `tests/`            |
| E2E          | `*.spec.ts`             | `e2e/`              |

---

## 4. Unit Tests (Jest)

Use the **Arrange / Act / Assert** shape and `describe`/`it`. Group by module,
then by function.

```typescript
// src/ai/__tests__/archetype-detector.test.ts
import { detectArchetype } from '../archetype-detector';

describe('detectArchetype', () => {
  it('should detect the Burn archetype', () => {
    // Arrange
    const deck = [
      { name: 'Lightning Bolt', count: 4 },
      { name: 'Goblin Guide', count: 4 },
    ];

    // Act
    const result = detectArchetype(deck);

    // Assert
    expect(result.primary).toBe('Burn');
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it('should throw on an empty deck', () => {
    expect(() => detectArchetype([])).toThrow('empty');
  });
});
```

### Mocking modules

The project uses Jest, so prefer `jest.mock` / `jest.fn` (not vitest's `vi`):

```typescript
jest.mock('@/lib/card-database', () => ({
  getCard: jest.fn().mockResolvedValue({ name: 'Lightning Bolt' }),
}));
```

### Mocking browser APIs

`jest.setup.js` already configures `jsdom` globals. For `localStorage` /
`sessionStorage` use the reusable mocks from `@/test-utils`:

```typescript
import { mockLocalStorage } from '@/test-utils';

beforeEach(() => {
  mockLocalStorage({ theme: 'dark' });
});
```

---

## 5. Component Tests (React Testing Library)

```typescript
// src/components/__tests__/deck-statistics-charts.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { DeckStatisticsCharts } from '../deck-statistics-charts';

describe('DeckStatisticsCharts', () => {
  it('renders the mana curve', () => {
    render(<DeckStatisticsCharts curve={{ 1: 2, 2: 1 }} />);
    expect(screen.getByText('Mana Curve')).toBeInTheDocument();
  });

  it('calls onSelect when a bar is clicked', () => {
    const onSelect = jest.fn();
    render(<DeckStatisticsCharts curve={{ 1: 2 }} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /1-drop/i }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
```

Prefer `renderWithProviders` from `@/test-utils` when a component needs app
providers (router, context):

```typescript
import { renderWithProviders } from '@/test-utils';

renderWithProviders(<MyComponent />);
```

Query by **accessible role and text** (`getByRole`, `getByText`) before reaching
for `data-testid`. Reserve `data-testid` for elements that have no stable
accessible name.

---

## 6. Integration Tests

Integration tests live in the repo-root `tests/` directory and exercise real
cross-module workflows (server actions + persistence + serialization, etc.).
They use **MSW** to intercept network calls instead of hitting real APIs.

```typescript
// tests/deck-construction.integration.test.ts
import { createMockDeck } from '@/test-utils/integration';

describe('Deck construction flow', () => {
  it('builds and validates a deck end-to-end', async () => {
    const deck = createMockDeck({ name: 'Burn' });
    // ... drive the real code paths, assert on the resulting deck
  });
});
```

MSW setup (server handlers in `src/test-utils/msw/`):

```typescript
import { createServer } from '@/test-utils/msw/server';
import { http, HttpResponse } from 'msw';

const server = createServer(
  http.get('/api/cards/search', () => HttpResponse.json({ data: [] })),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

---

## 7. E2E Tests (Playwright)

E2E specs live in `e2e/` and are discovered by `playwright.config.ts`
(`testDir: './e2e'`). Playwright boots the Next.js dev server on port **9002**
automatically (`webServer` config), so you do not need to start it manually.

```typescript
// e2e/deck-builder.spec.ts
import { test, expect } from '@playwright/test';

test('complete deck building flow', async ({ page }) => {
  await page.goto('/deck-builder');

  await page.fill('[data-testid="card-search"]', 'Lightning');
  await page.click('[data-testid="add-card"]:first-child');

  await expect(page.locator('.deck-list')).toContainText('Lightning');
});
```

Run a single spec:

```bash
npx playwright test deck-builder.spec.ts
```

---

## 8. Test Utilities (`@/test-utils`)

Shared helpers, factories, and mocks live in [`src/test-utils/`](../src/test-utils/)
and are re-exported from `@/test-utils`. Use them instead of hand-rolling data —
it keeps fixtures consistent across the suite.

### Factories

```typescript
import {
  createCard,
  createCreature,
  createLand,
  createSpell,
  createDeck,
  createStandardDeck,
  createLimitedDeck,
  createGameState,
  createCombatState,
  createMulliganState,
} from '@/test-utils';

const bolt = createCard({ name: 'Lightning Bolt' });
const deck = createDeck({ name: 'Burn', cards: [bolt] });
const state = createGameState({ players: 2 });
```

For integration tests, the convenience wrappers live in
`@/test-utils/integration`:

```typescript
import { createMockDeck, createMockCard } from '@/test-utils/integration';
```

### Helpers

- `renderWithProviders` — render a component with all required providers.
- `createUserEvent`, `clickCard`, `addToDeck` — user-interaction helpers.
- queries from `@/test-utils/helpers/queries`.

### Mocks

- `mockFetch`, `mockScryfallSearch`, `mockScryfallCard`
- `mockLocalStorage`, `mockSessionStorage`, `createStorageMock`
- `mockUseRouter`, `createMockRouter` (Next.js router)

### MSW

- `createServer` / `serverHandlers` — Node server for Jest (`src/test-utils/msw/server.ts`).
- `createWorker` / `handlers` — browser worker (`src/test-utils/msw/handlers.ts`).

See [`src/test-utils/README.md`](../src/test-utils/README.md) for the full API.

---

## 9. Video-Derived Fixture Pipeline

Some game-state fixtures are derived from recorded gameplay videos and turned
into Jest tests automatically. This catches regressions in the rules engine
against real play sessions.

### How it works

```
recorded game state JSON
   │
   ▼
src/lib/__fixtures__/video-derived/*.json        ← inputs (hand-curated)
   │
   │  scripts/generate-test-fixture.ts
   ▼
src/lib/game-state/__tests__/video-derived/*.test.ts   ← generated tests
   │
   │  npm test -- --testPathPattern=video-derived
   ▼
Jest run + coverage
```

- **Generator**: [`scripts/generate-test-fixture.ts`](../scripts/generate-test-fixture.ts) —
  reads each fixture JSON from `src/lib/__fixtures__/video-derived/` and emits a
  matching `*.test.ts` into `src/lib/game-state/__tests__/video-derived/`.
- **CI workflow**: [`.github/workflows/video-derived-tests.yml`](../.github/workflows/video-derived-tests.yml) —
  runs on `push` and `pull_request`, generates the tests, runs them, collects
  coverage, comments the result on the PR, and updates the README badge on
  `main`.

### Fixture format

```json
{
  "id": "turn-three-kill",
  "name": "Turn-three kill scenario",
  "description": "Burn deck lethal on turn 3",
  "gameState": { "...": "full GameState object" },
  "expectedBehaviors": [
    "attacker deals lethal damage",
    "no priority violations"
  ]
}
```

### Running locally

```bash
# Generate (write) the test files
npx ts-node scripts/generate-test-fixture.ts \
  --fixtures-dir src/lib/__fixtures__/video-derived

# Preview what would be generated without writing
npx ts-node scripts/generate-test-fixture.ts --dry-run

# Run only the generated tests
npm test -- --testPathPattern=video-derived

# With coverage
npm test -- --testPathPattern=video-derived --coverage
```

### Adding a new fixture

1. Drop a `.json` file into `src/lib/__fixtures__/video-derived/` (use the
   schema above).
2. Run the generator (command above) or let CI generate it.
3. Run `npm test -- --testPathPattern=video-derived` to validate.

> See also [`docs/VIDEO_DERIVED_TESTS_WORKFLOW.md`](./VIDEO_DERIVED_TESTS_WORKFLOW.md)
> for the full CI workflow reference.

---

## 10. Coverage

### Target vs. enforced floor

| Metric      | Project target | CI-enforced floor (`jest.config.js`) |
| ----------- | -------------- | ------------------------------------ |
| Lines       | **70%**        | 29%                                  |
| Functions   | **70%**        | 23%                                  |
| Statements  | **70%**        | 29%                                  |
| Branches    | **60%**        | 22%                                  |

- The **target** is 70% across all metrics (60% for branches). This is the
  documented project goal and is referenced from `README.md`,
  `docs/CONTRIBUTING.md`, and `jest.config.js`.
- The **CI-enforced floor** is set *just below currently-measured coverage* so
  the gate catches real regressions without being flaky. It is raised toward
  the 70% target as coverage improves (tracked via issue #922).

> **Do not** raise a threshold above currently-measured coverage or CI will
> fail. Always re-measure with `npm run test:coverage` before adjusting
> `coverageThreshold`.

### What is measured

`collectCoverageFrom` in `jest.config.js`:

```
src/**/*.{ts,tsx}
!src/**/*.d.ts
!src/**/__tests__/**
```

Test files themselves are excluded from coverage.

### Reading the report

```bash
npm run test:coverage
```

Outputs:

- `coverage/lcov-report/index.html` — browsable HTML report.
- `coverage/lcov.info` — LCOV format (consumed by CI / editors).
- `coverage/coverage-summary.json` — machine-readable totals.

The video-derived workflow additionally writes `coverage-final.json` and posts
a coverage delta comment on pull requests.

---

## 11. Decision Guide

| Scenario                  | Test type      |
| ------------------------- | -------------- |
| Pure function / utility   | Unit (co-located) |
| Custom hook               | Unit           |
| Single React component    | Unit (RTL)     |
| Component + providers     | Unit (`renderWithProviders`) |
| Server action / route     | Integration (`tests/`) |
| Cross-module workflow     | Integration (`tests/`) |
| Critical user flow in browser | E2E (`e2e/`)   |
| Game-state regression     | Video-derived fixture |

**Choose E2E** when you need a real browser, real DOM, or unmocked network.
**Choose integration** when you can mock external dependencies and want faster
feedback. Default to **unit** for everything else.

---

## 12. Debugging

```bash
# Run one test by name
npm test -- --testNamePattern="should detect Burn"

# Watch a single file
npm test -- --watch --testPathPattern="archetype-detector"

# Verbose console output
npm test -- --verbose

# Text coverage for one run
npm run test:coverage -- --coverageReporters=text

# Playwright headed + debug
npx playwright test --headed --debug
```

---

## 13. CI Integration

Tests run automatically on:

- **Pull requests** and **pushes to `main`** — `.github/workflows/ci.yml`
  (lint, typecheck, unit tests with coverage, enforcing `coverageThreshold`).
- **Video-derived tests** — `.github/workflows/video-derived-tests.yml`
  (generates + runs video-derived tests, posts coverage delta on PRs).
- **Pre-commit** — `husky` + `lint-staged` (see `.husky/`).

A coverage regression that drops a metric below the `coverageThreshold` floor
will fail CI and block the merge.
