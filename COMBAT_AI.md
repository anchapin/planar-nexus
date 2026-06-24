# Combat AI Architecture

> Resolves issue #936. This is the top-level architecture document for the
> combat AI subsystem. For the co-located module usage guide, see
> [`src/ai/decision-making/COMBAT_AI.md`](./src/ai/decision-making/COMBAT_AI.md);
> for the historical issue-#37 implementation report, see
> [`COMBAT_AI_IMPLEMENTATION.md`](./COMBAT_AI_IMPLEMENTATION.md).

## Overview

The Combat AI subsystem is the part of the Planar Nexus AI opponent that
decides what to do during the combat phase of Magic: The Gathering games. Given
a game state and an AI player, it produces a complete **combat plan**: which
creatures attack (and at whom), which creatures block (and in what damage
order), whether to hold any combat tricks, and an overall strategy posture
(aggressive / moderate / defensive).

The subsystem is a layered, heuristic-driven decision engine. It is **not** a
full game-tree search — it evaluates each creature independently against a model
of the opponent, then optionally refines the result with multi-turn lookahead
and an LLM fallback. Decisions are deterministic for a fixed input and run in a
few milliseconds, so the AI can play in real time.

Design goals, reflected throughout the code:

- **Reasonable, explainable attacks and blocks** — every decision carries a
  human-readable `reasoning` string and a 0–1 `expectedValue`.
- **Deck-aware** — combat behavior shifts with the AI's own archetype and the
  opponent's emerging archetype (issues #911 / #912).
- **Difficulty-scaled** — four presets (`easy` → `expert`) gate advanced
  features (block prediction, combat-trick modeling, lookahead depth).
- **Rules-accurate combat math** — deathtouch (CR 702.2b), indestructible,
  first/double strike, trample, menace, and evasion are all modeled.

## Architecture

```
                       ┌─────────────────────────────────────────┐
   ai-turn-loop.ts     │            CombatDecisionTree           │
  runCombatPhase()  ─▶ │  (src/ai/decision-making/               │
   engineToAIState()   │   combat-decision-tree.ts)              │
                       │                                         │
                       │  generateAttackPlan() /                 │
                       │  generateBlockingPlan(attackers)        │
                       │  generateAttackPlanAI()  ── LLM proxy ──┼─▶ callAIProxy
                       │                                         │
                       │  determineCombatStrategy()              │
                       │  evaluateAttacker() / evaluateBlocks…   │
                       └────────────┬─────────────┬──────────────┘
                                     │             │
              ┌──────────────────────┘             └─────────────────────┐
              ▼                                                            ▼
   ┌────────────────────────┐                            ┌──────────────────────────┐
   │ block-prediction.ts    │                            │ combat-trick-probability │
   │ predictOpponentBlocks()│                            │ .ts                      │
   │ integrateBlockPred…EV()│                            │ estimateCombatTrickProb… │
   │ (archetype-weighted)   │                            │ calculateCombatTrickDisc │
   └────────────────────────┘                            └──────────────────────────┘
                                     │
                                     ▼
                       ┌─────────────────────────────────────────┐
                       │         lookahead/  (issue #667)         │
                       │  LookaheadEngine.evaluate()             │
                       │   ├─ board-state-signature.ts           │
                       │   ├─ heuristic-table.ts                 │
                       │   └─ types.ts                           │
                       └─────────────────────────────────────────┘
```

State flows in the unified AI format (`AIGameState` / `AIPlayerState` /
`AIPermanent` from `@/lib/game-state/types`); the turn loop converts the
engine's own state with `engineToAIState()` before constructing the tree.

## Components

### 1. Combat Decision Tree — `src/ai/decision-making/combat-decision-tree.ts`

The central decision maker. The `CombatDecisionTree` class is constructed with
`(gameState, aiPlayerId, difficulty, archetype, opponentArchetype)` and exposes:

| Method | Responsibility |
| --- | --- |
| `generateAttackPlan()` | Produce a `CombatPlan` of attack decisions for the turn. |
| `generateBlockingPlan(attackers)` | Produce a `CombatPlan` of block decisions against declared attackers. |
| `generateAttackPlanAI(provider, model)` | Optional LLM-backed plan via `callAIProxy`; falls back to `generateAttackPlan()` on any failure. |
| `setConfig()` / `getConfig()` | Override the effective config after construction. |
| `getArchetype()` / `getOpponentArchetype()` | Inspect which archetypes are driving decisions. |

Key internal helpers:

- `determineCombatStrategy()` — picks `aggressive` / `moderate` / `defensive`
  from life totals and creature-count differential (see *Decision Flow*).
- `evaluateAttacker()` — scores a single creature's attack against every
  opponent, blends in evasion/value modifiers and (optionally) block-prediction
  and combat-trick discounts.
- `evaluateBlocksForAttacker()` / `simulateBlocks()` / `canBlock()` — model
  blocking, including menace, flying/reach, deathtouch, and indestructible.
- `evaluateCombatTricks()` — recommends instant-speed effects when enabled.
- `optimizeBlockerOrdering()` — orders multi-blockers (cheapest first) to
  minimize losses and enable 2-for-1s.
- `applyLookaheadAdjustments()` — folds multi-turn lookahead results back into
  the per-creature attack decisions (priority attackers, hold-back, lethal).

Two thin convenience wrappers are exported for callers that don't need a
long-lived instance: `generateAttackDecisions()` and
`generateBlockingDecisions()`. The public API is re-exported from
`src/ai/decision-making/index.ts` and `src/ai/index.ts`.

### 2. Block Prediction — `src/ai/decision-making/block-prediction.ts`

Models how the opponent is *likely* to block, so the attacker EV reflects real
risk rather than worst-case.

- `predictOpponentBlocks(attackers, opponentBattlefield, opponentLife, archetype)`
  → a `BlockPredictionResult` with, per attacker, the predicted blocker IDs,
  block probability, and confidence.
- `integrateBlockPredictionIntoEV(ev, prediction, attacker, allBlockers, opponentLife)`
  → adjusts an attacker's expected value (bonus when unblocked, penalty when a
  predicted block kills it or forces a bad trade).
- `computeBlockerScore()` scores each candidate blocker using power/toughness,
  mana-value trade math, deathtouch/indestructible flags, chump-block logic
  (cheap blocker vs. significant damage when low on life), and life pressure.
- Behavior is weighted by `ARCHETYPE_WEIGHTS` keyed on `OpponentArchetype`
  (`aggro` / `control` / `combo` / `midrange` / `unknown`). Menace attackers
  require ≥2 predicted blockers; a block is only predicted above a 0.3
  probability threshold.

### 3. Combat-Trick Probability — `src/ai/decision-making/combat-trick-probability.ts`

Estimates the chance the opponent is holding a combat-relevant instant, and
discounts attack EV accordingly (so the AI doesn't walk into `Giant Growth` /
`Lightning Bolt` / removal blowouts).

- `estimateCombatTrickProbability(opponentMana, archetype, cardsInHand?, turnNumber?)`
  → `CombatTrickEstimate` (probability, confidence, estimated trick types,
  reasoning). Scales by available mana (factor = `min(1, total/3)`), archetype
  trick frequency (`ARCHETYPE_TRICK_WEIGHTS`), hand size, and turn number; adds
  a bluff term; and lists likely types from `COMMON_TRICK_CMC` (pump, removal,
  toughness boost, indestructible). Color awareness flags red removal and white
  pump specifically.
- `calculateCombatTrickDiscount(estimate, currentEV, creatureToughness?)` →
  returns `{ discountedEV, riskAdjustment }`, applying larger penalties when
  removal or a pump that kills the creature is plausible. Result is clamped to
  ≥ `-0.5`.

### 4. Multi-Turn Lookahead — `src/ai/decision-making/lookahead/` (issue #667)

A bounded forward-planning layer that adjusts combat decisions based on
projected future board states.

- `LookaheadEngine.evaluate(gameState, aiPlayerId)` → `LookaheadResult`
  (`bestScore`, `worstScore`, `aggressionModifier`, `priorityAttackers`,
  `holdBack`, `lethalFound`, `opponentLethalRisk`, `turnsToLethal`). Flow:
  1. `createBoardStateSignature()` hashes the board (sorted creature stats, life
     buckets `critical`/`low`/`mid`/`high`, hand-size estimates).
  2. `HeuristicTable.lookup()` matches the signature against built-in
     `AttackLineHeuristic` entries via `computeSignatureSimilarity()`; the best
     match contributes an `aggressionModifier` and attacker hold/priority lists.
  3. `projectBoardStates()` rolls the game forward `maxDepth` turns across
     `branchingFactor` branches (each with a `1/(turn·branch)` probability),
     estimating damage each way and board-advantage delta, flagging lethal.
  4. Projections are scored and combined into the final modifier.
- `LookaheadConfig` (`maxDepth` 1–4, `branchingFactor`, `heuristicWeight`,
  `minMatchQuality`, `enabled`) is supplied per difficulty through
  `CombatAIConfig.lookaheadConfig`.

### 5. Difficulty & Archetype Configuration

Two cross-cutting config sources feed the tree at construction time:

- **`src/ai/ai-difficulty.ts`** — `DIFFICULTY_CONFIGS` (easy / medium / hard /
  expert) and the `AIDifficultyManager` singleton. Alongside the global
  evaluation weights documented in
  [`AI_DIFFICULTY_CONFIG.md`](./AI_DIFFICULTY_CONFIG.md), each level sets
  `lookaheadDepth`, `useLookahead`, `blunderChance`, `riskTolerance`, and
  `tempoPriority` that the combat subsystem inherits.
- **`DefaultCombatConfigs`** (in `combat-decision-tree.ts`) — the combat-specific
  per-difficulty preset of `aggression`, `riskTolerance`, `lifeThreshold`,
  `cardAdvantageWeight`, and feature flags (`useCombatTricks`,
  `useBlockPrediction`, `useLookahead`, `lookaheadConfig`). See *Configuration*.
- **`ARCHETYPE_COMBAT_MODIFIERS`** — per-archetype deltas applied on top of the
  difficulty preset so each deck fights differently (aggro attacks more freely,
  combo/ramp defend earlier). `deckArchetypeToOpponentArchetype()` translates the
  AI's `DeckArchetype` vocabulary into the `OpponentArchetype` block-prediction
  expects (ramp folds into midrange).

## Decision Flow

### Strategy selection (`determineCombatStrategy`)

The posture is chosen once per turn, in priority order:

1. AI life ≤ `lifeThreshold` → **defensive**
2. Minimum opponent life ≤ 10 → **aggressive**
3. AI has > opponent-avg creatures + 1 → aggressive if `aggression > 0.6`, else **moderate**
4. AI has < opponent-avg creatures − 1 → **defensive**
5. Otherwise → driven by `aggression` (>0.6 aggressive, <0.4 defensive, else moderate)

### Attack plan (`generateAttackPlan`)

1. Gather attackable creatures (untapped, `power > 0`, no summoning sickness
   unless they have haste).
2. If `useBlockPrediction`, run `predictOpponentBlocks()` against the primary
   opponent.
3. For each creature, `evaluateAttacker()` computes a base target value per
   opponent (`evaluateAttackTarget`), then:
   - adds an evasion bonus (`+0.2` if `hasEvasion`),
   - subtracts a value penalty (`min(0.3, manaValue/20)`),
   - if `useCombatTricks`, applies `calculateCombatTrickDiscount`,
   - if a block prediction exists, replaces EV with
     `integrateBlockPredictionIntoEV(...)` (re-applying the trick discount).
4. Attack if the final EV ≥ per-strategy threshold (`0.3` / `0.5` / `0.7` for
   aggressive / moderate / defensive).
5. If `useCombatTricks`, `evaluateCombatTricks()` proposes instant-speed plays.
6. If `useLookahead`, `LookaheadEngine.evaluate()` runs and
   `applyLookaheadAdjustments()` re-prioritizes attackers (lethal push, hold-back
   against opponent lethal risk).

### Block plan (`generateBlockingPlan`)

1. Gather untapped creatures that can block.
2. For each attacker, `evaluateBlocksForAttacker()` picks blockers using the
   same power/toughness/trade/chump logic as block prediction, respecting
   evasion via `canBlock()`.
3. `optimizeBlockerOrdering()` sorts multi-block damage assignment.
4. Returns a defensive-stanced `CombatPlan`.

### Combat math

`simulateBlocks()` resolves individual combats with full keyword awareness:

- **Deathtouch** — any nonzero damage is lethal (CR 702.2b).
- **Indestructible** — never dies to combat damage.
- **First/Double strike** & **Trample** — handled in the target-evaluation and
  damage-ordering paths.
- **Evasion** (`canBlock`) — flying (needs flying/reach), menace (≥2 blockers,
  handled at assignment), intimidate/fear, unblockable.

## Configuration & Tunability

`CombatAIConfig` (interface in `combat-decision-tree.ts`):

| Parameter | Type | Effect |
| --- | --- | --- |
| `aggression` | 0–1 | Shifts strategy thresholds and attack willingness. |
| `riskTolerance` | 0–1 | Governs trick/chump-block risk decisions. |
| `lifeThreshold` | life total | Life at which the AI goes defensive. |
| `cardAdvantageWeight` | 0+ | Importance of card advantage vs. life in trades. |
| `useCombatTricks` | boolean | Whether to model/recommend instant-speed effects. |
| `useBlockPrediction` | boolean | Whether to predict opponent blocks. |
| `opponentArchetype` | `OpponentArchetype` | Weights for block prediction. |
| `useLookahead` | boolean | Whether to run multi-turn lookahead. |
| `lookaheadConfig` | `Partial<LookaheadConfig>` | Depth, branching, heuristic weight. |

`DefaultCombatConfigs` presets per difficulty:

| Difficulty | Aggression | Risk | Life thr. | Card adv. | Tricks | Block pred. | Lookahead |
| --- | --- | --- | --- | --- | --- | --- | --- |
| easy | 0.3 | 0.2 | 15 | 0.5 | no | no | no |
| medium | 0.5 | 0.5 | 10 | 1.0 | yes | yes | depth 2 |
| hard | 0.7 | 0.7 | 7 | 1.5 | yes | yes | depth 3, heuristic 0.5 |
| expert | 0.85 | 0.85 | 5 | 2.0 | yes | yes | depth 4, branch 4, heuristic 0.6 |

`ARCHETYPE_COMBAT_MODIFIERS` (added to the preset, then clamped):

| Archetype | Aggression Δ | Risk Δ | Life threshold Δ |
| --- | --- | --- | --- |
| aggro | +0.20 | +0.15 | −2 |
| midrange | 0 | 0 | 0 |
| control | −0.15 | −0.10 | +2 |
| combo | −0.25 | −0.15 | +4 |
| ramp | −0.20 | −0.10 | +3 |

Tuning the heuristic/lookahead tables, evaluation weights, and difficulty target
win rates is covered in [`AI_DIFFICULTY_CONFIG.md`](./AI_DIFFICULTY_CONFIG.md).

## Integration Points

- **Turn loop** — `src/ai/ai-turn-loop.ts::runCombatPhase()`:
  1. converts engine state with `engineToAIState()`,
  2. dynamically imports `CombatDecisionTree` (avoids circular deps),
  3. resolves `archetype` (explicit override or `detectPlayerArchetype()`) and
     `opponentArchetype` (`detectOpponentArchetype()` →
     `deckArchetypeToOpponentArchetype()`),
  4. calls `generateAttackPlan()` and executes each `AttackDecision` through
     `executeAIAction({ type: "attack", cardId, targetId, reasoning })`,
     pacing with a small delay and emitting commentary.
- **Action executor** — `src/ai/ai-action-executor.ts` reads
  `gameState.combat.attackers` / `gameState.combat.blockers` (from
  `@/lib/game-state/combat`) to translate plans into engine mutations.
- **Game-state evaluator** — `src/ai/game-state-evaluator.ts` produces the
  `DeckArchetype` and evaluation factors that the turn loop feeds into the tree;
  see [`src/ai/GAME_STATE_EVALUATOR.md`](./src/ai/GAME_STATE_EVALUATOR.md).
- **AI proxy** — `generateAttackPlanAI()` delegates to
  [`@/lib/ai-proxy-client`](./AI_PROXY_IMPLEMENTATION.md) `callAIProxy` with a
  JSON-mode chat completion, falling back to the local heuristic plan.

## Testing

The combat AI is covered by unit, integration, and validation suites run through
the project's standard test runner (see [`TESTING.md`](./TESTING.md)):

| File | Covers |
| --- | --- |
| `src/ai/__tests__/combat-decision-tree.test.ts` | Attack/block decisions, strategy, evasion, trades, menace. |
| `src/ai/decision-making/__tests__/block-prediction.test.ts` | Archetype-weighted block prediction and EV integration. |
| `src/ai/__tests__/combat-trick-probability.test.ts` | Trick probability estimation and EV discounting. |
| `src/ai/__tests__/lookahead.test.ts` | Board signatures, heuristic matching, projections. |
| `src/ai/decision-making/__tests__/combat-ai.validation.ts` | End-to-end `runAllCombatValidationTests()` scenarios. |

Live demonstrations are available in
`src/ai/decision-making/combat-examples.ts` (`runAllCombatExamples()`).

## Implementation Files

```
src/ai/
├── ai-turn-loop.ts                     # runCombatPhase() wires the tree into the game loop
├── ai-action-executor.ts               # Executes attack/block actions on engine state
├── ai-difficulty.ts                    # DIFFICULTY_CONFIGS, AIDifficultyManager
├── game-state-evaluator.ts             # DeckArchetype + evaluation factors feeding combat
└── decision-making/
    ├── combat-decision-tree.ts         # CombatDecisionTree, configs, types, wrappers
    ├── block-prediction.ts             # Opponent block modeling
    ├── combat-trick-probability.ts     # Opponent trick estimation / EV discount
    ├── combat-examples.ts              # Runnable usage examples
    ├── index.ts                        # Public re-exports
    ├── COMBAT_AI.md                    # Co-located module usage guide
    ├── lookahead/
    │   ├── lookahead-engine.ts         # Multi-turn projection & scoring
    │   ├── heuristic-table.ts          # Built-in AttackLineHeuristic matching
    │   ├── board-state-signature.ts    # Board hashing / similarity
    │   ├── types.ts                    # LookaheadConfig / LookaheadResult / signatures
    │   └── index.ts                    # Lookahead public API
    └── __tests__/
        ├── block-prediction.test.ts
        └── combat-ai.validation.ts
```

## Performance Considerations

- **Fast evaluation** — typical decisions complete in <10 ms; no deep game-state
  cloning outside the bounded lookahead projections.
- **Linear core complexity** — `O(n × m)` where `n` = AI creatures and `m` =
  opponents' potential blockers.
- **Bounded lookahead** — depth (1–4) and branching factor are capped per
  difficulty, and each projection decays in probability with depth.
- **Deterministic** — identical inputs yield identical plans, which keeps tests
  stable and makes replays reproducible.

## Future Enhancements

Tracked enhancement areas (framework already present):

- Deeper hand analysis for proactive combat-trick *use* (not just opponent
  modeling).
- Richer opponent-block prediction and archetype refinement as more cards are
  revealed.
- Broader keyword coverage and full planeswalker/battle combat targeting.
