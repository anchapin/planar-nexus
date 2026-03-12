# Plan 3.1: Test Suite Completion

## Objective
Achieve comprehensive test coverage with Jest unit tests and Playwright E2E tests for all critical user flows.

## Why This Matters
- Ensures code quality and prevents regressions (REQ-T3)
- Builds confidence for production release
- Enables safe refactoring and future development
- Required for v1.0 release criteria

---

## Tasks

### Task 3.1.1: Audit Current Test Coverage
**Type**: research
**Duration**: ~60 min

**Actions**:
1. Run current test suite:
```bash
npm test -- --coverage
```

2. Generate coverage report:
```bash
npm test -- --coverage --coverageReporters=html
# Open coverage/index.html
```

3. Document coverage by module:
   - AI modules (archetype, synergy, difficulty)
   - Game engine modules
   - UI components
   - Utility functions

4. Identify critical gaps:
   - Untested AI decision logic
   - Untested game state operations
   - Untested UI components

**Deliverable**: Coverage report showing:
- Overall coverage percentage
- Modules with <50% coverage
- Critical untested paths

---

### Task 3.1.2: Add Missing Unit Tests (AI Modules)
**Type**: auto
**Duration**: ~90 min

**Actions**:
1. Add tests for `src/ai/game-state-evaluator.ts`:
   - evaluateGameState() with various board states
   - evaluateCardPriority() for different card types
   - evaluateAttack() with different combat scenarios

2. Add tests for `src/ai/decision-making/combat-decision-tree.ts`:
   - generateAttackPlan() with different board states
   - shouldBlock() logic
   - combat trade evaluation

3. Add tests for `src/ai/ai-difficulty.ts`:
   - shouldBlunder() at each difficulty level
   - applyRandomness() distribution
   - getLookaheadDepth() returns correct values

**Verification**:
```bash
npm test -- --testPathPattern="ai"
# All AI tests pass
```

---

### Task 3.1.3: Add Missing Unit Tests (Game Engine)
**Type**: auto
**Duration**: ~90 min

**Actions**:
1. Add tests for `src/lib/game-state/game-state.ts`:
   - createInitialGameState()
   - startGame()
   - loadDeckForPlayer()
   - Phase transitions

2. Add tests for `src/lib/game-state/serialization.ts`:
   - All conversion functions (already tested, verify coverage)
   - Edge cases (empty game state, single player)

3. Add tests for core game mechanics:
   - Damage assignment
   - Combat resolution
   - Stack resolution

**Verification**:
```bash
npm test -- --testPathPattern="game-state"
# All game-state tests pass
```

---

### Task 3.1.4: Add Missing Unit Tests (UI Components)
**Type**: auto
**Duration**: ~90 min

**Actions**:
1. Add tests for new coach components:
   - `ArchetypeBadge` renders correctly
   - `SynergyList` displays synergies in order
   - `MissingSynergies` shows impact levels
   - `KeyCards` highlights correct cards
   - `ExportButton` triggers download

2. Add tests for critical UI components:
   - Deck builder card search
   - Deck validation
   - Import/export functionality

**Verification**:
```bash
npm test -- --testPathPattern="components"
# Component tests pass
```

---

### Task 3.1.5: Set Up Playwright E2E Testing
**Type**: auto
**Duration**: ~60 min

**Actions**:
1. Install Playwright:
```bash
npm install -D @playwright/test
npx playwright install
```

2. Create `playwright.config.ts`:
```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
  },
  webServer: {
    command: 'npm run dev',
    port: 3000,
  },
});
```

3. Create test directory structure:
```
e2e/
├── deck-builder.spec.ts
├── ai-coach.spec.ts
├── single-player.spec.ts
└── import-export.spec.ts
```

**Verification**:
```bash
npx playwright test --project=chromium
# Playwright configured correctly
```

---

### Task 3.1.6: Create E2E Tests for Critical Flows
**Type**: auto
**Duration**: ~120 min

**Actions**:
1. **Deck Builder Flow** (`e2e/deck-builder.spec.ts`):
   - Search for cards
   - Add cards to deck
   - Validate deck format
   - Save deck
   - Load saved deck

2. **AI Coach Flow** (`e2e/ai-coach.spec.ts`):
   - Navigate to deck coach
   - Select deck
   - Get coach report
   - Verify archetype display
   - Export report

3. **Single Player Flow** (`e2e/single-player.spec.ts`):
   - Select deck
   - Configure AI opponent
   - Start game
   - Play turn
   - Verify game completes

4. **Import/Export Flow** (`e2e/import-export.spec.ts`):
   - Import decklist from clipboard
   - Export deck as text
   - Export deck as JSON
   - Re-import exported deck

**Verification**:
```bash
npx playwright test
# All E2E tests pass
```

---

### Task 3.1.7: Integrate with GitHub Actions
**Type**: auto
**Duration**: ~60 min

**Actions**:
1. Create `.github/workflows/ci.yml`:
```yaml
name: CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm test -- --coverage
      - run: npx playwright install --with-deps
      - run: npx playwright test
      - uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
```

2. Add test badge to README:
```markdown
![Tests](https://github.com/your-org/planar-nexus/actions/workflows/ci.yml/badge.svg)
![Coverage](https://codecov.io/gh/your-org/planar-nexus/branch/main/graph/badge.svg)
```

**Verification**:
- CI workflow runs on push
- Tests execute successfully
- Coverage report uploaded

---

### Task 3.1.8: Coverage Verification
**Type**: checkpoint:human-verify
**Duration**: ~30 min

**What Built**: Comprehensive test suite

**How to Verify**:
1. Run full test suite:
```bash
npm test -- --coverage
npx playwright test
```

2. Check coverage report:
   - Overall coverage ≥80%
   - AI modules ≥85%
   - Game engine ≥80%
   - Critical paths 100%

3. Verify all tests pass:
   - Unit tests: 200+ passing
   - E2E tests: 10+ passing

**Resume Signal**: Paste coverage summary:
```
Unit Tests: XXX passing
E2E Tests: XX passing
Coverage: XX.XX%
```

---

## Success Criteria

✅ Overall test coverage ≥80%
✅ AI module coverage ≥85%
✅ Game engine coverage ≥80%
✅ 200+ unit tests passing
✅ 10+ E2E tests passing
✅ CI/CD integration working
✅ Coverage report accessible

---

## Dependencies

- Requires: Phase 2 complete (AI modules stable)
- Unblocks: Plan 3.2 (Tauri builds need tests passing), Plan 3.4 (Bug Bash)

---

## Risks

| Risk | Mitigation |
|------|------------|
| E2E tests flaky | Use stable selectors, add retries |
| CI too slow | Parallelize tests, cache dependencies |
| Coverage target too high | Focus on critical paths first |
| Playwright browser issues | Use headless mode, install dependencies |

---

**Created**: 2026-03-12
**Estimated Duration**: 6-8 hours
