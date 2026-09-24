# Contributor Guide: Implementing MTG Card Mechanics

This guide covers how to implement new Magic: The Gathering card mechanics in the Planar Nexus rules engine. It explains the architecture, the subsystem contracts, and the testing expectations.

> **Prerequisite:** Read [`docs/onboarding.md`](onboarding.md) and [`docs/TESTING.md`](TESTING.md) before this guide.

---

## Table of Contents

1. [Engine Architecture Overview](#1-engine-architecture-overview)
2. [Layer System](#2-layer-system)
3. [Replacement Effects](#3-replacement-effects)
4. [Trigger System](#4-trigger-system)
5. [State-Based Actions](#5-state-based-actions)
6. [Keyword Actions](#6-keyword-actions)
7. [Activated and Triggered Abilities](#7-activated-and-triggered-abilities)
8. [Mana and Spell Resolution](#8-mana-and-spell-resolution)
9. [Testing Card Implementations](#9-testing-card-implementations)
10. [Adding a New Mechanic: Step-by-Step](#10-adding-a-new-mechanic-step-by-step)

---

## 1. Engine Architecture Overview

The rules engine lives in `src/lib/game-state/`. Its **only public API is the barrel** `src/lib/game-state/index.ts`; deep imports outside this tree are blocked by ESLint (#1710).

```
src/lib/game-state/
├── index.ts                  # Public barrel — only entry point
├── types.ts                  # Core type definitions (GameState, CardInstance, Zone, etc.)
├── card-instance.ts          # Card object model and base operations
├── layer-system/             # CR 613: Layer system implementation
│   └── index.ts              # Applies effects in layer order
├── trigger-system/           # CR 603: Triggered ability system
│   ├── index.ts
│   ├── types.ts
│   ├── turn-triggers.ts      # Beginning/ending of turn, phase, step triggers
│   ├── etb-triggers.ts       # Enters-the-battlefield triggers
│   ├── damage-death-triggers.ts  # Damage dealt, lethal damage, death triggers
│   ├── spell-triggers.ts     # Spell cast triggers
│   └── state-triggers.ts     # State triggers (e.g., "at X life")
├── replacement-effects/      # CR 614: Replacement effects
│   ├── index.ts
│   ├── types.ts
│   ├── manager.ts            # Core replacement effect engine
│   ├── factories.ts           # Common replacement effect constructors
│   └── commander.ts          # Commander tax replacement effect
├── state-based-actions.ts    # CR 704: State-based actions
├── keyword-actions/          # Keyword action implementations (CR 702)
│   ├── index.ts
│   ├── blitz.ts
│   ├── cascade.ts
│   ├── counters.ts
│   ├── cycling.ts
│   ├── damage-tap.ts
│   ├── draw.ts
│   ├── dungeon.ts
│   ├── foretell.ts
│   ├── monarchy.ts
│   ├── persist.ts
│   ├── removal.ts
│   ├── tokens.ts
│   ├── tribute-renown.ts
│   └── shared.ts
├── abilities/               # Activated and triggered ability infrastructure
│   ├── types.ts
│   ├── activated.ts
│   ├── triggered.ts
│   ├── parse.ts
│   └── loyalty.ts
├── combat/                  # Combat declaration and resolution (CR 506-510)
│   ├── declaration.ts
│   ├── resolution.ts
│   └── queries.ts
├── mana/                    # Mana production, payment, and cost
│   ├── mana-pool.ts
│   ├── mana-payment.ts
│   ├── mana-production.ts
│   ├── lands.ts
│   └── mana-cost.ts
├── oracle-text-parser/      # Parses oracle text into structured mechanic data
│   ├── index.ts
│   └── parser.ts
└── dungeon-data.ts          # Dungeon venture room definitions
```

---

## 2. Layer System

**Reference:** [CR 613](https://yawgatog.com/resources/magic-the-gathering-comprehensive-rules/#613)

The layer system resolves continuous effects in a defined order. It is implemented in `src/lib/game-state/layer-system/index.ts`.

### 2.1 Layer Order

Effects are applied in seven layers. Within each layer, effects are applied in timestamp order:

| Layer | Description                                                     |
| ----- | --------------------------------------------------------------- |
| 1     | Copy effects                                                    |
| 2     | Control-changing effects                                        |
| 3     | Text-changing effects                                           |
| 4     | Type-changing effects (including card type, supertype, subtype) |
| 5     | Color-changing effects                                          |
| 6     | Adding/removing abilities                                       |
| 7     | Power and toughness-changing effects                            |

### 2.2 Layer System API

```typescript
import { layerSystem } from "@/lib/game-state";

// Apply all pending continuous effects
const newState = layerSystem.applyContinuously(state);

// Get effective power/toughness after all layer modifications
const { power, toughness } = layerSystem.getFinalPT(card, state);

// Check if an effect is currently applying
const isApplying = layerSystem.isEffectApplying(card, effectId, state);
```

### 2.3 Applying Effects in a Layer

Effects are represented as objects with a `layer`, `sublayer`, `timestamp`, and an `apply` function. When you add a new mechanic that modifies power/toughness, color, types, or abilities, you must register an effect with the layer system.

**Example — persist keyword** (`keyword-actions/persist.ts`):

```typescript
function buildPersistEffect(
  cardId: CardInstanceId,
  controllerId: PlayerId,
): ContinuousEffect {
  return {
    id: `persist-${cardId}-${Date.now()}`,
    source: cardId,
    controller: controllerId,
    layer: Layer.POWER_TOUGHNESS, // Layer 7
    sublayer: Sublayer.NOT_APPLIED, // Applied in timestamp order
    timestamp: Date.now(),
    apply: (card: CardInstance, _state: GameState) => {
      if (!hasPersist.get(cardId)) return card;
      return {
        ...card,
        power: card.power - 1,
        toughness: card.toughness + 1,
      };
    },
  };
}
```

### 2.4 Sublayers

Within Layer 7 (power/toughness), effects are applied in this sublayer order:

1. Player-order (affects one player at a time)
2. Characteristic-defining (P/T set to a specific value)
3. +X/+Y effects
4. -X/-Y effects
5. Switching P/T
6. Setting P/T to specific values

---

## 3. Replacement Effects

**Reference:** [CR 614](https://yawgatog.com/resources/magic-the-gathering-comprehensive-rules/#614)

Replacement effects intercept events and modify or replace them. They are implemented in `src/lib/game-state/replacement-effects/`.

### 3.1 Key Types

```typescript
import type {
  ReplacementEffect,
  ReplacementEvent,
} from "@/lib/game-state/replacement-effects";

// The event being replaced
type ReplacementEvent =
  | { type: "draw"; player: PlayerId; card: CardInstanceId | null }
  | {
      type: "damage";
      source: CardInstanceId;
      target: CardInstanceId | PlayerId;
      amount: number;
    }
  | { type: "etb"; card: CardInstanceId; destination: Zone }
  | { type: "death"; card: CardInstanceId }
  | { type: " counters"; card: CardInstanceId; counterType: string };
// ... more event types
```

### 3.2 Replacement Effect Manager

The manager (`manager.ts`) applies replacement effects before events occur. Effects are checked in a specific priority order, and the first applicable effect is applied.

```typescript
import { ReplacementEffectManager } from "@/lib/game-state/replacement-effects";

const manager = new ReplacementEffectManager();
manager.addEffect(state, {
  eventType: "damage",
  description: "Plague Belcher: damage is replaced",
  canApply: (event, state) => event.source === plagueBelcherId,
  apply: (event, state) => ({
    ...event,
    amount: event.amount - 1,
  }),
});
```

### 3.3 Common Replacement Effect Factories

`factories.ts` provides reusable constructors:

```typescript
import {
  createPreventionEffect,
  createModificationEffect,
} from "@/lib/game-state/replacement-effects";

// Prevent all damage from a source
createPreventionEffect(sourceId, "damage");

// Modify how counters are placed
createModificationEffect(cardId, {
  eventType: "counters",
  apply: (event) => ({ ...event, counterType: "p1p1" }),
});
```

### 3.4 Commander Replacement Effect

Commander damage is tracked via a replacement effect in `replacement-effects/commander.ts`:

```typescript
import { commanderReplacementEffect } from "@/lib/game-state/replacement-effects/commander";
```

---

## 4. Trigger System

**Reference:** [CR 603](https://yawgatog.com/resources/magic-the-gathering-comprehensive-rules/#603)

Triggered abilities fire when their condition is met and wait for priority before resolving. The system lives in `src/lib/game-state/trigger-system/`.

### 4.1 Trigger Types

All triggers implement the `TriggeredAbility` interface from `types.ts`:

```typescript
export interface TriggeredAbility {
  id: string;
  source: CardInstanceId;
  triggerCondition: TriggerCondition;
  triggerMode: TriggerMode;
  controller: PlayerId;
  abilityText: string;
  resolve: (state: GameState) => GameState;
  triggered: boolean;
  triggerHistoryId?: number;
}
```

### 4.2 Trigger Files

| File                       | Purpose                                       |
| -------------------------- | --------------------------------------------- |
| `turn-triggers.ts`         | Beginning/end of turn, phase, step triggers   |
| `etb-triggers.ts`          | Enters-the-battlefield (ETB) triggers         |
| `damage-death-triggers.ts` | Damage dealt, lethal damage, death triggers   |
| `spell-triggers.ts`        | Spell cast triggers, kicks, convoke           |
| `state-triggers.ts`        | Life total changes, counters, upkeep triggers |

### 4.3 Registering a Trigger

```typescript
import { registerTrigger, buildTrigger } from "@/lib/game-state/trigger-system";

// In the card's effect implementation:
registerTrigger(
  state,
  buildTrigger({
    id: `etb-${cardId}`,
    source: cardId,
    triggerCondition: { type: "etb", cardId },
    triggerMode: "stack",
    controller: controllerId,
    abilityText: "When Archangel Avacyn enters, flip...",
    resolve: (state) => {
      // Implementation
      return updatedState;
    },
  }),
);
```

### 4.4 Trigger Resolution

Triggers are queued on the stack and resolved when the controller has priority. The trigger system checks for triggered abilities after every game state change via `checkTriggers()` called from the game loop.

### 4.5 Interacting with Triggers

```typescript
// Check if a trigger can fire
import { wouldTrigger } from "@/lib/game-state/trigger-system";

const result = wouldTrigger(state, trigger, event);
if (result.wouldTrigger) {
  state = result.newState;
}
```

---

## 5. State-Based Actions

**Reference:** [CR 704](https://yawgatog.com/resources/magic-the-gathering-comprehensive-rules/#704)

State-based actions (SBAs) are checked continuously and resolve immediately without using the stack. Implemented in `src/lib/game-state/state-based-actions.ts`.

### 5.1 Key SBAs

- Lethal damage causes a creature to die
- Toxic damage causes poison counters
- A planeswalker with no loyalty is removed
- A player at 0 or less life loses
- A player with 10+ poison counters loses
- A creature with 0 toughness dies
- Legend rule (if applicable)
- World rule (if applicable)
- Phased-out permanents are removed from the game
- Tokens that are not on the battlefield cease to exist

### 5.1 Running SBAs

```typescript
import { checkStateBasedActions } from "@/lib/game-state";

// Call after any game state change
const { state: stateAfterSBA, performed } = checkStateBasedActions(state);

if (performed.length > 0) {
  // May need to re-run if SBA resolution caused new SBAs
  return checkStateBasedActions(stateAfterSBA);
}
```

### 5.2 SBA Checklist

When implementing a new mechanic, ensure SBAs cover:

1. **Creature death** — lethal damage + toughness reduction
2. **Poison** — 10+ poison counters
3. **Life loss** — 0 or less life
4. **Loyalty** — planeswalker at 0 loyalty
5. **Token cleanup** — tokens not on battlefield

---

## 6. Keyword Actions

**Reference:** [CR 702](https://yawgatog.com/resources/magic-the-gathering-comprehensive-rules/#702)

Keyword actions are implemented in `src/lib/game-state/keyword-actions/`. Each keyword has a file named after it (e.g., `blitz.ts`, `persist.ts`).

### 6.1 Structure of a Keyword Action File

Every keyword action file should:

1. Import `KeywordActionResult` from `./shared`
2. Export named functions for each mechanic operation
3. Return `{ success: boolean; state: GameState; description: string; error?: string }`
4. Use type imports from `../types`

**Example — `counters.ts`:**

```typescript
import type { GameState, CardInstanceId, PlayerId } from "../types";
import { KeywordActionResult } from "./shared";

export function addCounters(
  state: GameState,
  cardId: CardInstanceId,
  counterType: string,
  amount: number = 1,
): KeywordActionResult {
  const card = state.cardInstanceMap.get(cardId);
  if (!card) {
    return { success: false, state, description: "", error: "Card not found" };
  }
  card.counters.set(
    counterType,
    (card.counters.get(counterType) ?? 0) + amount,
  );
  return {
    success: true,
    state,
    description: `Added ${amount} ${counterType} counter(s)`,
  };
}
```

### 6.2 Available Keyword Action Files

| File                | Keyword(s)                                    |
| ------------------- | --------------------------------------------- |
| `blitz.ts`          | Blitz (CR 702.131)                            |
| `cascade.ts`        | Cascade (CR 702.84)                           |
| `counters.ts`       | +1/+1 counters, -1/-1 counters                |
| `cycling.ts`        | Cycling, Typecycling, Landcycling             |
| `damage-tap.ts`     | Tap for damage (e.g., [[Genju of the Spires]) |
| `draw.ts`           | Draw a card                                   |
| `dungeon.ts`        | Venture into dungeon                          |
| `foretell.ts`       | Foretell                                      |
| `monarchy.ts`       | Monarchy                                      |
| `persist.ts`        | Persist (CR 702.78)                           |
| `removal.ts`        | Exile, destroy, bounce                        |
| `tokens.ts`         | Token creation                                |
| `tribute-renown.ts` | Tribute, Renown                               |

---

## 7. Activated and Triggered Abilities

### 7.1 Parsing Ability Text

`abilities/parse.ts` converts oracle text into structured ability objects:

```typescript
import { parseAbility } from "@/lib/game-state/abilities";

const ability = parseAbility("Tap, Pay 1 life: Exile target artifact.");
// Returns: { type: 'activated', cost: { mana: '1', tap: true }, effect: ... }
```

### 7.2 Activated Abilities

Activated abilities have a cost and an effect. Implemented in `abilities/activated.ts`:

```typescript
import {
  activateAbility,
  canActivateAbility,
} from "@/lib/game-state/abilities";

const { can, reason } = canActivateAbility(state, cardId, abilityIndex);
if (can) {
  state = activateAbility(state, cardId, abilityIndex);
}
```

### 7.3 Loyalty Abilities

Planeswalker loyalty abilities are handled by `abilities/loyalty.ts`. They follow the cost/effect pattern with additional rules about maximum one loyalty ability per turn per planeswalker:

```typescript
import { activateLoyaltyAbility } from "@/lib/game-state/abilities/loyalty";

state = activateLoyaltyAbility(state, planeswalkerId, abilityIndex);
```

---

## 8. Mana and Spell Resolution

Mana production is in `src/lib/game-state/mana/`. Spell resolution is in `src/lib/game-state/spell-casting/`.

### 8.1 Mana Production

```typescript
import { produceMana } from "@/lib/game-state/mana";

state = produceMana(state, playerId, { colorless: 1, white: 1 });
```

### 8.2 Mana Payment

```typescript
import { payMana } from "@/lib/game-state/mana";

const { success, remaining } = payMana(state, playerId, {
  generic: 2,
  white: 1,
});
```

### 8.3 Spell Casting

```typescript
import { castSpell, resolveSpell } from '@/lib/game-state/spell-casting';

state = castSpell(state, casterId, spellId, { targetIds: [...] });
state = resolveSpell(state, spellId);
```

---

## 9. Testing Card Implementations

All card mechanic tests live next to the source in `__tests__/` directories. See [`docs/TESTING.md`](TESTING.md) for the full testing guide.

### 9.1 Unit Test Structure for Card Mechanics

Tests for a mechanic go in the same `__tests__/` directory as the mechanic file:

```
src/lib/game-state/keyword-actions/__tests__/
├── cycling.test.ts
├── persist.test.ts
├── ...
src/lib/game-state/trigger-system/__tests__/
├── turn-triggers.test.ts
├── etb-triggers.test.ts
```

### 9.2 Test Fixtures

Use the test fixture factory for creating `GameState`, `CardInstance`, and `Player` objects:

```typescript
import {
  createGameState,
  createCard,
  createPlayer,
} from "@/test-utils/game-fixtures";

const state = createGameState({
  players: [
    createPlayer({ id: "p1", life: 20 }),
    createPlayer({ id: "p2", life: 20 }),
  ],
});

const card = createCard({
  id: "card-1",
  name: "Glistener Elf",
  types: ["creature"],
  power: 1,
  toughness: 1,
  keywords: ["infect"],
});
```

### 9.3 QA Coverage Holes

There is a mandatory test file `src/lib/game-state/__tests__/qa-coverage-holes.test.ts` with `it.todo` placeholders for each required test scenario. You must replace `it.todo` with real `it(...)` tests before your PR can merge. CI runs `scripts/qa-coverage-gate.js` to enforce this.

### 9.4 Mutation Testing

The rules engine is mutation-tested via Stryker. When adding a new mechanic, run targeted mutation testing:

```bash
# For layer-system changes
npm run mutate:layer-system

# For trigger-system changes
npm run mutate:trigger-system

# For replacement-effects changes
npm run mutate:replacement-effects
```

Mutation coverage floors are enforced in CI and ratcheted by `scripts/ratchet-coverage.js`.

---

## 10. Adding a New Mechanic: Step-by-Step

### Step 1: Classify the Mechanic

Identify which subsystem your mechanic belongs to:

| Mechanic Type                       | Subsystem                                     |
| ----------------------------------- | --------------------------------------------- |
| Keyword (flying, trample, lifelink) | Evergreen — implemented in `card-instance.ts` |
| Keyword action (equip, populate)    | `keyword-actions/`                            |
| Triggered ability                   | `trigger-system/`                             |
| Activated ability                   | `abilities/`                                  |
| Replacement effect                  | `replacement-effects/`                        |
| Continuous effect                   | `layer-system/`                               |
| State-based action                  | `state-based-actions.ts`                      |

### Step 2: Find a Similar Existing Implementation

Before writing anything, find an existing card or mechanic that is structurally similar:

- **Persist mechanics:** `keyword-actions/persist.ts`
- **Counters:** `keyword-actions/counters.ts`
- **ETB triggers:** `trigger-system/etb-triggers.ts`
- **Cascade:** `keyword-actions/cascade.ts`
- **Monarchy:** `keyword-actions/monarchy.ts`

### Step 3: Implement the Mechanic

Create or edit the appropriate file. Follow the patterns established in the existing code:

1. Use type imports from `@/lib/game-state/types`
2. Return `KeywordActionResult` or typed result objects
3. Handle error cases (missing card, invalid zone, wrong player)
4. Register effects with the layer system if the mechanic is continuous
5. Register replacement effects if the mechanic intercepts events
6. Register triggers if the mechanic fires on game state changes

### Step 4: Write Tests

1. Happy path: the mechanic does what it should
2. Edge cases: wrong zone, missing targets, zero quantities
3. Interactions with existing mechanics (layer system, SBA)
4. Replace `it.todo` entries in `qa-coverage-holes.test.ts` for your mechanic

### Step 5: Run Verification

```bash
npm run typecheck
npm run lint
npm test -- --testPathPattern="your-mechanic-name"
```

### Step 6: Open the PR

Commit with a conventional message:

```
feat(game-state): add persist keyword mechanic

Closes #<issue-number>
```

---

## Quick Reference: Common Patterns

### Adding a Continuous Effect

```typescript
import { layerSystem, Layer, Sublayer } from "@/lib/game-state/layer-system";
import type { ContinuousEffect } from "@/lib/game-state/layer-system";

const effect: ContinuousEffect = {
  id: `my-effect-${cardId}`,
  source: cardId,
  controller: playerId,
  layer: Layer.POWER_TOUGHNESS,
  sublayer: Sublayer.NOT_APPLIED,
  timestamp: Date.now(),
  apply: (card) => ({ ...card, power: card.power + 1 }),
};

state = layerSystem.addEffect(state, effect);
```

### Registering a Trigger

```typescript
import { registerTrigger } from "@/lib/game-state/trigger-system";

state = registerTrigger(state, {
  id: `etb-${cardId}`,
  source: cardId,
  triggerCondition: { type: "etb", cardId },
  triggerMode: "stack",
  controller: playerId,
  abilityText: "When this enters, create a 1/1 creature token.",
  resolve: (state) => {
    state = createToken(state, playerId, "soldier-token", {
      power: 1,
      toughness: 1,
    });
    return state;
  },
});
```

### Adding a Replacement Effect

```typescript
import { ReplacementEffectManager } from "@/lib/game-state/replacement-effects";

const manager = new ReplacementEffectManager();
manager.addEffect(state, {
  eventType: "damage",
  canApply: (event) => event.source === myCardId,
  apply: (event) => ({ ...event, amount: event.amount + 1 }),
});
state = manager.apply(state, event);
```

### Checking SBAs

```typescript
import { checkStateBasedActions } from "@/lib/game-state/state-based-actions";

const { state: afterSBA, performed } = checkStateBasedActions(state);
if (performed.length > 0) {
  // Recursively check in case new SBAs were created
  return checkStateBasedActions(afterSBA);
}
```
