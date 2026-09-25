# MTG Rules Engine Debugging Guide

## Architecture Overview

The rules engine lives in `src/lib/game-state/` and is the correctness-critical core of the application. All external consumers MUST import from the public barrel only (`@/lib/game-state`); deep imports into sub-modules (`@/lib/game-state/layer-system`, etc.) are forbidden and will cause ESLint errors ([#1710](https://github.com/planar-nexus/planar-nexus/issues/1710)).

```
src/lib/game-state/
├── index.ts                    # Public barrel — ONLY entry point for consumers
├── types.ts                    # Core type definitions (GameState, CardInstance, PlayerId…)
├── card-instance.ts             # Card object model and type predicates (isCreature, isLand…)
├── zones.ts                    # Zone management (moveCardBetweenZones, createZone…)
├── turn-phases.ts              # Turn phase state machine
├── state-based-actions.ts       # SBA system (CR 704) — checked continuously
├── state-hash.ts               # Deterministic state fingerprinting
├── event-sourcing.ts           # Multiplayer sync via event log with state hash verification
├── replay.ts                   # Replay/snapshot system for rollback
├── errors.ts                   # EngineUncaughtException wrapper for UI recovery
│
├── layer-system/
│   └── index.ts                # Layer system (CR 613) — copy effects, PT mods, type changes…
├── keyword-actions.ts           # Keyword action implementations (tap, untap, destroy, exile…)
├── spell-casting/              # Spell casting resolution and costs
├── replacement-effects/         # Replacement effects (CR 614)
├── trigger-system/             # Triggered ability resolution
├── combat/                     # Combat phase logic
├── mana/                       # Mana production and payment
├── abilities/                  # Ability resolution
├── oracle-text-parser/         # Oracle text → engine instructions
│
├── __tests__/                  # ~70 test files covering every module
└── game-state/                 # Nested sub-package (internal)
```

### Key Type: `GameState`

All engine operations thread through a single immutable-ish `GameState` object. Every public function that changes state returns `(newState: GameState, events: GameEvent[])`.

---

## Running Tests

### Unit Tests (Jest)

```bash
# Run all tests
npm test

# Run a specific module's tests (use --testPathPattern with the module name)
npm test -- --testPathPattern=layer-system
npm test -- --testPathPattern=state-based-actions
npm test -- --testPathPattern=spell-casting
npm test -- --testPathPattern=trigger-system
npm test -- --testPathPattern=replacement-effects
npm test -- --testPathPattern=combat
npm test -- --testPathPattern=mana

# Run a single test file
npm test -- --testPathPattern="layer-system/test"

# Run tests by name pattern
npm test -- --testNamePattern="should apply effects in correct layer order"

# Run with coverage
npm run test:coverage
npm run test:coverage:ratchet   # auto-bumps coverage thresholds

# Watch mode (re-runs on file change)
npm run test:watch

# Flake detector (5 runs with randomized seeds, no --forceExit)
npm run test:flake
```

### Mutation Testing (Stryker)

Mutation tests are nightly only (not on every PR) due to runtime. Per-module runs for targeted debugging:

```bash
npm run mutate:layer-system
npm run mutate:replacement-effects
npm run mutate:spell-casting
npm run mutate:trigger-system
npm run mutate:state-based-actions
npm run mutate:combat
npm run mutate:mana

# Full suite (~40 min)
npm run test:mutation
```

### End-to-End (Playwright)

```bash
npm run test:e2e           # Cross-browser (chromium / firefox / webkit)
npm run test:e2e:flake     # 5-run flake detection
```

### Lint and Typecheck

```bash
npm run typecheck           # tsc --noEmit
npm run lint                # eslint src --max-warnings 1000
```

---

## Common Debugging Patterns

### 1. Inspecting Game State

Use the `GameState` inspector functions from the barrel:

```typescript
import { computeStateHash } from '@/lib/game-state';
import { isOnBattlefield, parseZoneKey } from '@/lib/game-state/types';

const hash = computeStateHash(state);
// Log the hash to compare states before/after an operation

// Iterate cards in a zone
const battlefield = state.zones.battlefield?.cards ?? [];
battlefield.filter(isOnBattlefield).forEach(card => {
  console.log(card.name, card.power, card.toughness);
});
```

### 2. Tracing Effect Application

The layer system is ordered (CR 613.1–613.7). Use the `LayerSystem` singleton directly in tests:

```typescript
import { getLayerSystemInstance } from '@/lib/game-state/layer-system';

const ls = getLayerSystemInstance();
ls.clear(); // Reset between tests

// Register effects and inspect the applied result
ls.registerEffect(effect);
const finalPT = ls.getFinalPowerToughness(cardId);
```

### 3. SBA Debugging

State-based actions produce a `StateBasedActionResult` with `actionsPerformed`, `state`, and `descriptions`:

```typescript
import { checkStateBasedActions } from '@/lib/game-state';

const result = checkStateBasedActions(state);
console.log('SBAs performed:', result.descriptions);
state = result.state; // Use the returned state, not the input
```

### 4. Event Log Tracing

For multiplayer sync issues, the event sourcing module records every action:

```typescript
import { appendEvent, getReplaySnapshot } from '@/lib/game-state/event-sourcing';

state = appendEvent(state, action);
// Later: replay from snapshot
const snapshot = getReplaySnapshot(state.sessionId, index);
```

### 5. Error Wrapping

Engine errors are caught and wrapped in `EngineUncaughtException` (not thrown) so the session can recover:

```typescript
import { createEngineUncaughtException } from '@/lib/game-state/errors';

// In engine entry points (castSpell, resolveTopOfStack, etc.)
try {
  // ... risky operation
} catch (error) {
  throw createEngineUncaughtException(error, 'castSpell', state, cardId);
}
```

### 6. Test Fixtures

Use `jest.setup.js` globals for reproducible card data:

```typescript
beforeEach(() => seedTestData());

// Available globals:
seedTestData(customCards?)   // Seeds mockCardDatabase with test cards
clearTestData()              // Resets mocks between tests
mockCardDatabase             // In-memory card lookup
```

---

## Interpreting Test Output

### Passing Tests

```
PASS  src/lib/game-state/__tests__/layer-system.test.ts
  Layer System
    Layer Ordering
      ✓ should apply effects in correct layer order
      ✓ should resolve copy chain correctly
```

### Failing Tests

```
FAIL  src/lib/game-state/__tests__/layer-system.test.ts
  Layer System
    ✕ should apply effects in correct layer order (5ms)

  Expected: 4
  Received: 3

  Difference:

    Expected: 4
    Received: 3
```

1. Note the **test name** and **module** — they tell you which rule is misbehaving.
2. The **received vs expected** tells you which branch/assertion failed.
3. **Check `descriptions` in SBA results** — if SBAs are silently eating your cards, `actionsPerformed: true` with no console output is the symptom.
4. **Layer order failures** usually mean effects are registered in the wrong sublayer (CR 613.7).

### Mutation Testing Output

Stryker reports a score (0–100). For the rules engine:
- layer-system: floor 55
- replacement-effects: floor 76
- Other modules: floor 50

A score **below floor** means the module has untested code paths that mutations were not caught in.

---

## Key Files and Their Purposes

| File | Purpose |
|------|---------|
| `index.ts` | Public barrel — only sanctioned import path |
| `types.ts` | `GameState`, `CardInstance`, `PlayerId`, zone enums |
| `card-instance.ts` | Card object model; type predicates (`isCreature`, `isLand`…) |
| `zones.ts` | `moveCardBetweenZones`, zone creation |
| `state-based-actions.ts` | SBA check loop (CR 704) |
| `layer-system/index.ts` | Continuous effect system (CR 613) |
| `keyword-actions.ts` | `tapCard`, `destroyCard`, `exileCard`, etc. |
| `spell-casting.ts` | Cast resolution, mana payment, targets |
| `trigger-system/index.ts` | Triggered ability detection and queuing |
| `replacement-effects/` | CR 614 replacement effect system |
| `combat.ts` | Combat damage, attacker/defender assignment |
| `mana/` | Mana pool, mana sources and sinks |
| `event-sourcing.ts` | Multiplayer event log, state hash verification |
| `replay.ts` | Snapshot/restore for rollback |
| `errors.ts` | `EngineUncaughtException` wrapper |
| `state-hash.ts` | `computeStateHash` — deterministic fingerprint |
| `oracle-text-parser.ts` | Oracle text → engine IR |
| `jest.setup.js` | Test globals: `seedTestData`, `clearTestData`, `mockCardDatabase` |

---

## Debugging Checklist

1. **Is the card on the battlefield?** — Use `isOnBattlefield(card, state)`
2. **Is it in the right zone?** — Check `card.zone` vs expected zone
3. **Are SBAs eating it?** — Run `checkStateBasedActions` and inspect `descriptions`
4. **Is a layer effect missing?** — Check layer and sublayer (1a vs 1b vs 7)
5. **Is a replacement effect preventing an action?** — Check `canApply` chain in replacement-effects
6. **Did a trigger fail to fire?** — Inspect `triggerSystem`'s event queue
7. **Did a keyword ability not apply?** — Check `keyword-actions.ts` for the specific keyword
8. **Is state hash stable?** — Log `computeStateHash` before/after; if it differs unexpectedly, something mutated state out-of-band
9. **Does the error have a `stateHashBefore`?** — Use it to reconstruct the exact pre-failure state for replay

---

## Test File Naming Conventions

Tests live in `src/lib/game-state/__tests__/` and follow these patterns:

- `layer-system.test.ts` — unit tests for the layer system
- `layer-system.mutation.test.ts` — Stryker-mutated variant (not run in normal test suite)
- `layer-system.property.test.ts` — property-based tests
- `state-based-actions.mutation.test.ts` — SBA mutation coverage
- `golden-scenarios.test.ts` — multi-card interaction integration tests
- `video-derived/` — fixtures generated from real game video replays
