# Game State Module — Rules Engine

> **The correctness-critical core of Planar Nexus.** All外人 imports from `@/lib/game-state` must use the barrel (`index.ts`). Deep imports into sub-modules are forbidden and will cause ESLint errors (#1710).

---

## Overview

The rules engine implements a full Magic: The Gathering game in TypeScript. It is organized into focused sub-modules:

| Module                       | Responsibility                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `types/`                     | Core TypeScript interfaces (`GameState`, `CardInstance`, `Zone`, `Player`, etc.)                                   |
| `game-state/`                | Game state creation, initialization, and top-level game operations                                                 |
| `card-instance.ts`           | Card instance predicates (`isCreature`, `isLand`, etc.) and accessors (`getPower`, `getToughness`)                 |
| `zones.ts`                   | Zone creation, card movement between zones, zone queries                                                           |
| `turn-phases.ts`             | Turn structure, phase/step advancement, priority tracking                                                          |
| `combat.ts`                  | Attacker/blocker declaration, combat damage assignment, combat победе                                              |
| `layer-system/`              | Full Layer 1–7 system for continuous card effects (P/T changes, type changes, control changes, counters)           |
| `state-based-actions.ts`     | MTG Comprehensive Rules 704 — lethal damage, 0 toughness, life ≤ 0, 10+ poison, legendary rule, empty library      |
| `trigger-system/`            | Triggered ability detection, queuing, and resolution                                                               |
| `replacement-effects/`       | Replacement effect detection and application (layer 0 effects)                                                     |
| `spell-casting/`             | Spell and ability resolution on the stack                                                                          |
| `keyword-actions.ts`         | Implementations for evergreen keywords: `tapCard`, `untapCard`, `addCounters`, `destroyCard`, `exileCard`, etc.    |
| `abilities/`                 | Static abilities, activated abilities, triggered ability signatures                                                |
| `evergreen-keywords.ts`      | Parsing and application of evergreen keyword mechanics                                                             |
| `oracle-text-parser.ts`      | Oracle text → structured effect parsing                                                                            |
| `commander-damage.ts`        | Commander damage tracking per opponent                                                                             |
| `legendary-rule.ts`          | "Choose a legendary creature" waiting choice logic                                                                 |
| `corpse-keyword.ts`          | Corpse counter mechanic                                                                                            |
| `phasing.ts`                 | Phase 704.5 and "without doing anything" upkeep triggers                                                           |
| `linked-effects.ts`          | Linked effect resolution (e.g., `{this} enters with X counters → {this} gets Y counters when counters are removed) |
| `event-sourcing.ts`          | Event log, replay serialization, time-travel                                                                       |
| `replay.ts`                  | Replay compression and state reconstruction                                                                        |
| `state-hash.ts`              | Deterministic state fingerprinting for sync                                                                        |
| `serialization.ts`           | JSON serialization/deserialization of `GameState`                                                                  |
| `format-rules.ts`            | Format legality (Commander Banned List, Standard rotation, etc.)                                                   |
| `targeting-validation.ts`    | Legal target checking                                                                                              |
| `hand-targeting.ts`          | Hand-targeting mechanic (e.g., `Target Hand`)                                                                      |
| `hand-card-filter.ts`        | `Fateful Hour`, `High Alert` hand-based effects                                                                    |
| `auto-pass-priority.ts`      | Stemless flash, "At next upkeep" priority auto-pass                                                                |
| `priority-guard.ts`          | Priority queue guards                                                                                              |
| `prototype.ts`               | Prototype counter mechanics                                                                                        |
| `mutate.ts`                  | Mutate keyword mechanics                                                                                           |
| `judge-call-edge-cases.ts`   | Tournament edge cases requiring judge calls                                                                        |
| `terminology-translation.ts` | Alternate phrasing resolution                                                                                      |
| `errors.ts`                  | Engine-level error types                                                                                           |
| `ai-contract.ts`             | AI-compatible state snapshot interface                                                                             |

---

## Key Design Decisions

### 1. Immutable Updates

Every function that modifies `GameState` returns a **new** `GameState` object. The original is never mutated.

```typescript
// Correct
const newState = drawCard(state, playerId);

// Wrong — mutates in place
state.zones.get("hand")?.cardIds.push(cardId);
```

**Why this matters:**

- **Time-travel debugging** — replay any point in game history
- **Deterministic multiplayer sync** — every player sees the same state for the same actions
- **Undo/redo** — cheap state snapshots for game-logs and judge calls
- **Testing** — assertions are stable; no shared mutable fixture state

### 2. Zone IDs

Zones are identified by composite string keys of the form `{playerId}-{zoneType}`:

```
p1-library      p1-hand      p1-battlefield     p1-graveyard    p1-exile
p2-library      p2-hand      p2-battlefield     p2-graveyard    p2-exile
                                   stack
                                  command
```

Use `parseZoneKey(zoneId)` → `{ playerId, zoneType }` to destructure. Never hardcode `p1-` / `p2-`.

### 3. Card Timestamps

All timestamp-based effects use Unix epoch milliseconds for deterministic ordering:

- `enteredBattlefieldTimestamp` — LIFO ordering for enters-the-battlefield triggers
- `attachedTimestamp` — attachment order for Auras/Equipment
- `damageTimestamp` — damage prevention/expiration order

### 4. Layer System (Layers 1–7)

The layer system resolves continuous card effects in MTG layer order (CR 613). Each layer is re-resolved in dependency order until a fixpoint is reached:

| Layer | Effect type                                     | Examples                            |
| ----- | ----------------------------------------------- | ----------------------------------- |
| 1     | Rules that add/remove abilities                 | Hexproof, indestructible            |
| 2     | Effects that add/remove creature types          | "All creatures are Insects"         |
| 3     | Control-change effects                          | `Turntimber Ranger` Squirrel tokens |
| 4     | Power/toughness-changing effects                | +1/+1 counters, `Giant Growth`      |
| 5a/5b | Type-changing effects                           | `Shadow`, un--cards                 |
| 6     | P/T counters (layer 6, no sub-layer)            | +1/+1 counters                      |
| 7     | Other (enters as enters tapped, mana producers) |                                     |

Layer system functions live in `layer-system/index.ts`. `getEffectivePower` / `getEffectiveToughness` are the canonical P/T accessors — never read `card.power` directly on a creature.

### 5. Event Sourcing

All game mutations are recorded as typed events in `gameState.eventLog`. Each event records:

```typescript
interface GameEvent {
  id: string;
  type: string;
  timestamp: number;
  payload: Record<string, unknown>;
  playerId?: PlayerId; // who initiated it
}
```

Replay, undo, and AI simulation all consume this event log. **Every state mutation must emit an event.**

---

## How to Add a New Card Effect

### Step 1 — Classify the effect

First, determine which effect category the card belongs to:

| Category                                                         | Where to implement              |
| ---------------------------------------------------------------- | ------------------------------- |
| **Keyword ability** (flying, trample, hexproof…)                 | `evergreen-keywords.ts`         |
| **Keyword action** (tap to activate, sacrifice, exile…)          | `keyword-actions.ts`            |
| **Triggered ability** (ETB, death, attack…)                      | `trigger-system/`               |
| **Replacement effect** (enters tapped, prevention, redirection…) | `replacement-effects/`          |
| **Static ability** (continuous P/T boost, type change…)          | `layer-system/` or `abilities/` |
| **Mana ability**                                                 | `mana/`                         |
| **Spell resolution**                                             | `spell-casting/`                |

### Step 2 — Find the right file

Search for similar existing effects:

```bash
# Find existing tap-cost effects
rg "tapCard" src/lib/game-state/keyword-actions.ts

# Find existing P/T boost effects
rg "getEffectivePower|getEffectiveToughness" src/lib/game-state/layer-system/

# Find existing replacement effects
rg "replacementEffect|replacement" src/lib/game-state/replacement-effects/
```

### Step 3 — Add the effect

**Example: adding a new keyword action `sacrificeCard`**

1. Add the function to `keyword-actions.ts`:

```typescript
export function sacrificeCard(
  state: GameState,
  cardId: CardInstanceId,
  playerId: PlayerId,
  optional = false,
  effectId?: string,
): GameState {
  const card = state.cards.get(cardId);
  if (!card) return state;

  // Move to graveyard via replacement if applicable, otherwise direct
  state = moveCardBetweenZones(
    state,
    cardId,
    `${playerId}-battlefield`,
    `${playerId}-graveyard`,
  );

  state = emitEvent(state, {
    type: "SACRIFICED",
    cardId,
    playerId,
    effectId,
    optional,
  });

  return checkStateBasedActions(state);
}
```

2. Export it from the barrel in `index.ts` (keyword-actions already exports `export *`).

3. If the effect needs a waiting choice (`optional: true`), add a `WaitingChoice` variant in `types/` and handle it in the UI.

**Example: adding a static P/T bonus (layer system)**

In `layer-system/index.ts`, find the `Layer1PowerToughnessEffect` type and add a new variant:

```typescript
type Layer1PowerToughnessEffect =
  | { type: "counter"; counterType: CounterType; amount: number }
  | { type: "static"; power: number; toughness: number; source: CardInstanceId }
  | { type: "new-effect" /* your new variant */ };
```

Then add the application logic in `applyLayer1Effects()`.

**Example: adding a triggered ability**

In `trigger-system/`, add a new trigger signature:

```typescript
export const SACRIFICE_TRIGGERS: TriggerSignature = {
  event: "SACRIFICED",
  filter: (event, card) => event.cardId === card.id,
  effect: async (state, event, card) => {
    // Your effect resolution here
  },
};
```

### Step 4 — Register in format rules

If the card is format-legal, add it to the relevant list in `format-rules.ts`. If it's banned or restricted, add it to the banlist arrays.

### Step 5 — Add tests

See [Testing](#testing) below.

---

## Testing

### Running Tests

```bash
# Full Jest suite
npm test

# Single file
npm test -- --testPathPattern="layer-system"

# Single test by name
npm test -- --testNamePattern="should apply +1/+1 counters"

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

### Mutation Testing (Stryker)

The rules engine is the only place in the codebase that runs mutation testing. Stryker mutates operators in the engine source and asserts that test suites catch every mutant.

```bash
# Layer system mutation test (fastest, ~2 min)
npm run mutate:layer-system

# Combat
npm run mutate:combat

# Spell casting
npm run mutate:spell-casting

# Trigger system
npm run mutate:trigger-system

# State-based actions
npm run mutate:state-based-actions

# Mana
npm run mutate:mana

# Replacement effects
npm run mutate:replacement-effects
```

Mutation testing runs **nightly** in `.github/workflows/mutation.yml`. Per-PR, only a fast config guard runs (`mutation-smoke`). Full Stryker for `layer-system` runs on PRs touching `src/lib/game-state/` via `.github/workflows/mutation-pr.yml` (informational, non-blocking).

> **Coverage floors are enforced in CI and ratcheted.** Run `npm run test:coverage:ratchet` to raise the floor after improving coverage. Never hand-raise a threshold above measured coverage — CI will fail.

### Coverage Floor

- `jest.config.js` `coverageThreshold.global` is the enforced floor (currently 70% for the engine).
- `scripts/ratchet-coverage.js` automatically bumps the floor to measured coverage on `npm run test:coverage:ratchet`.
- `scripts/qa-coverage-gate.js` fails CI if any `it.todo` remains in `src/lib/game-state/__tests__/qa-coverage-holes.test.ts` (rows GS-RT-1..13 must have real tests).

### Video-Derived Fixtures

The `src/lib/__fixtures__/video-derived/` JSON fixtures are turned into Jest tests via `scripts/generate-test-fixture.ts`. Edits under `src/lib/game-state/**` or `__fixtures__/**` trigger the `video-derived-tests` workflow in CI.

---

## Public API

The **only** supported import path is:

```typescript
import {
  createInitialGameState,
  drawCard,
  checkStateBasedActions,
} from "@/lib/game-state";
```

ESLint rule `@typescript-eslint/no-restricted-imports` errors on any import targeting a sub-path like `@/lib/game-state/layer-system` from outside the engine.

Inside the engine (`src/lib/game-state/`), sub-module imports are permitted.

---

## Related Documentation

- [`docs/TESTING.md`](../../../docs/TESTING.md) — Canonical testing guide (mutation story, coverage enforcement, video fixtures)
- [`docs/PERSISTENCE_ARCHITECTURE.md`](../../../docs/PERSISTENCE_ARCHITECTURE.md) — IndexedDB persistence
- [`AGENTS.md`](../../../AGENTS.md) — Project overview, CI gates, commit conventions
- [`CLAUDE.md`](../../../CLAUDE.md) — Broader architecture notes
