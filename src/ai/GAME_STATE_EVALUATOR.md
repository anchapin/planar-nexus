# AI Game State Evaluation System

## Overview

The AI Game State Evaluation System is a comprehensive heuristic evaluation framework for Magic: The Gathering game states. It serves as the foundation for AI decision-making in the Planar Nexus application, enabling intelligent opponent behavior and strategic analysis.

## Features

### Core Capabilities

- **Multi-Factor Evaluation**: Assesses 17+ different game factors including life, card advantage, board presence, mana, tempo, and win conditions
- **Threat Assessment**: Identifies and prioritizes threats from opponents' battlefield
- **Opportunity Detection**: Suggests strategic plays based on current game state
- **Action Recommendations**: Generates actionable recommendations for the AI
- **Difficulty Scaling**: Supports easy, medium, and hard difficulty with tunable weights
- **Multiplayer Support**: Evaluates 1v1 and multiplayer formats including Commander
- **Format Awareness**: Handles Commander-specific mechanics like commander damage and command zones

### Evaluation Factors

The system evaluates the following factors (all normalized to -1 to 1 scale):

#### Survival Factors

- **Life Score**: Comparison of life total vs opponents
- **Poison Score**: Poison counter assessment

#### Card Advantage

- **Card Advantage**: Hand + battlefield + graveyard vs opponents
- **Hand Quality**: Mana value curve and mana sources in hand
- **Library Depth**: Remaining cards in library (decking prevention)
- **Card Selection**: Quality of cards in hand (instants, efficiency)

#### Board Presence

- **Creature Power**: Total power of untapped creatures
- **Creature Toughness**: Total toughness of untapped creatures
- **Creature Count**: Number of creatures on battlefield
- **Permanent Advantage**: Total permanent count vs opponents

#### Mana & Tempo

- **Mana Available**: Current mana pool evaluation
- **Tempo Advantage**: Turn priority, phase, and untapped resources

#### Commander-Specific

- **Commander Damage**: Damage dealt with commanders (21 is lethal)
- **Commander Presence**: Whether commander is on battlefield

#### Strategic Factors

- **Graveyard Value**: Resources in graveyard for recursion
- **Synergy**: Interactions between cards and permanents
- **Win Condition Progress**: Progress toward winning (aggro, mill, poison, commander)
- **Inevitability**: Likelihood of winning in long games

## Usage

### Basic Evaluation

```typescript
import { evaluateGameState, GameState } from "@/ai/game-state-evaluator";

// Assuming you have a GameState object
const evaluation = evaluateGameState(gameState, "player1", "medium");

console.log("Total Score:", evaluation.totalScore);
console.log("Threats:", evaluation.threats);
console.log("Recommendations:", evaluation.recommendedActions);
```

### Advanced Usage with Custom Weights

```typescript
import { GameStateEvaluator } from "@/ai/game-state-evaluator";

const evaluator = new GameStateEvaluator(gameState, "player1", "medium");

// Customize weights for aggressive playstyle
evaluator.setWeights({
  creaturePower: 3.0,
  creatureCount: 2.5,
  lifeScore: 0.2,
});

const evaluation = evaluator.evaluate();
```

### Comparing Game States

```typescript
import { compareGameStates } from "@/ai/game-state-evaluator";

// Compare two potential game states
// Positive result means state2 is better for player1
const improvement = compareGameStates(currentState, nextState, "player1");

if (improvement > 0) {
  console.log("Next state is better!");
}
```

### Quick Scoring

```typescript
import { quickScore } from "@/ai/game-state-evaluator";

// Get a quick score without full evaluation details
const score = quickScore(gameState, "player1", "medium");
```

## Game State Structure

### GameState

```typescript
interface GameState {
  players: { [playerId: string]: PlayerState };
  turnInfo: TurnInfo;
  stack: Array<{/* ... */}>;
  commandZone?: {/* ... */};
}
```

### PlayerState

```typescript
interface PlayerState {
  id: string;
  life: number;
  poisonCounters: number;
  commanderDamage: { [playerId: string]: number };
  hand: HandCard[];
  graveyard: string[];
  exile: string[];
  library: number;
  battlefield: Permanent[];
  manaPool: { [color: string]: number };
}
```

### Permanent

```typescript
interface Permanent {
  id: string;
  cardId: string;
  name: string;
  type: "creature" | "land" | "artifact" | "enchantment" | "planeswalker";
  controller: string;
  tapped?: boolean;
  power?: number;
  toughness?: number;
  loyalty?: number;
  counters?: { [key: string]: number };
  keywords?: string[];
  manaValue?: number;
}
```

## Difficulty Levels

The system includes three preset difficulty configurations:

### Easy

- Lower weights on strategic factors
- Focuses on basic board presence and life
- Simpler decision-making

### Medium

- Balanced weights across all factors
- Considers card advantage and tempo
- Standard strategic play

### Hard

- Higher weights on advanced factors
- Values card selection, synergy, and inevitability
- Sophisticated threat assessment

## Tuning AI Behavior

### Aggressive Strategy

```typescript
evaluator.setWeights({
  creaturePower: 3.0,
  creatureCount: 2.5,
  tempoAdvantage: 1.5,
  lifeScore: 0.2, // Willing to take damage
  cardAdvantage: 0.5,
});
```

### Control Strategy

```typescript
evaluator.setWeights({
  cardAdvantage: 2.5,
  handQuality: 1.5,
  lifeScore: 1.0, // Preserve life total
  creaturePower: 0.5,
  creatureCount: 0.3,
  tempoAdvantage: 0.8,
});
```

### Combo Strategy

```typescript
evaluator.setWeights({
  cardSelection: 2.0,
  handQuality: 1.5,
  synergy: 1.5,
  libraryDepth: 0.5,
  winConditionProgress: 3.0,
  creaturePower: 0.3,
});
```

## Integration with AI Decision-Making

### Minimax Search

The evaluation system is designed to work with minimax or alpha-beta pruning search:

```typescript
function minimax(
  state: GameState,
  depth: number,
  maximizingPlayer: string,
  isMaximizing: boolean,
): number {
  if (depth === 0 || isTerminal(state)) {
    return quickScore(state, maximizingPlayer, "hard");
  }

  if (isMaximizing) {
    let maxEval = -Infinity;
    for (const childState of getChildStates(state, maximizingPlayer)) {
      const evaluation = minimax(
        childState,
        depth - 1,
        maximizingPlayer,
        false,
      );
      maxEval = Math.max(maxEval, evaluation);
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    const opponents = getOpponents(state, maximizingPlayer);
    for (const opponent of opponents) {
      for (const childState of getChildStates(state, opponent.id)) {
        const evaluation = minimax(
          childState,
          depth - 1,
          maximizingPlayer,
          true,
        );
        minEval = Math.min(minEval, evaluation);
      }
    }
    return minEval;
  }
}
```

### Monte Carlo Tree Search

The evaluation system can also guide MCTS:

```typescript
function evaluateNode(state: GameState, player: string): number {
  const evaluation = evaluateGameState(state, player, "hard");
  return evaluation.totalScore;
}
```

## Examples

See `tests/examples/ai-game-state-evaluator-examples.ts` for comprehensive usage examples including:

1. Basic evaluation
2. Difficulty level comparison
3. Commander format evaluation
4. Comparing game states
5. Custom evaluation weights
6. Detailed threat assessment

## API Reference

### Classes

#### `GameStateEvaluator`

Main class for game state evaluation.

**Constructor:**

```typescript
constructor(gameState: GameState, evaluatingPlayerId: string, difficulty: 'easy' | 'medium' | 'hard')
```

**Methods:**

- `evaluate(): DetailedEvaluation` - Full evaluation with all factors
- `setWeights(weights: Partial<EvaluationWeights>): void` - Customize weights
- `getWeights(): EvaluationWeights` - Get current weights

### Functions

#### `evaluateGameState(gameState, playerId, difficulty): DetailedEvaluation`

Convenience function for one-time evaluation.

#### `compareGameStates(state1, state2, playerId, difficulty): number`

Compare two states. Returns positive if state2 is better.

#### `quickScore(gameState, playerId, difficulty): number`

Get total score without full evaluation details.

### Types

#### `DetailedEvaluation`

Complete evaluation result:

```typescript
interface DetailedEvaluation {
  totalScore: number;
  factors: {/* 17+ factor scores */};
  threats: ThreatAssessment[];
  opportunities: OpportunityAssessment[];
  recommendedActions: string[];
}
```

#### `ThreatAssessment`

Threat information:

```typescript
interface ThreatAssessment {
  permanentId: string;
  threatLevel: number; // 0-1
  reason: string;
  urgency: "immediate" | "soon" | "eventual" | "low";
}
```

#### `OpportunityAssessment`

Opportunity information:

```typescript
interface OpportunityAssessment {
  description: string;
  value: number;
  risk: number;
  requiredResources: string[];
}
```

## Future Enhancements

Potential improvements for future phases:

1. **Machine Learning Integration**: Train weights from replay data
2. **Deck-Specific Weights**: Customize evaluation based on deck archetype
3. **Meta-Awareness**: Adjust evaluation based on current metagame
4. **Synergy Detection**: More advanced card interaction analysis
5. **Predictive Modeling**: Anticipate opponent draws and plays
6. **Stack Interaction**: Evaluate stack states and responses
7. **Combat Simulation**: Detailed combat outcome prediction

## Performance Considerations

- Evaluation is designed to be fast (~1-5ms per evaluation)
- Use `quickScore()` for high-volume evaluations (e.g., search)
- Use full `evaluate()` for decision-making and debugging
- Consider caching evaluations for repeated states

## Testing

Run the example file to see the system in action:

```bash
npm run dev
# Then import and run examples from tests/examples/ai-game-state-evaluator-examples.ts
```

## Contributing

When adding new evaluation factors:

1. Add factor name to `EvaluationWeights` interface
2. Set default values in `DefaultWeights`
3. Implement evaluation function following naming convention: `evaluateFactorName()`
4. Add to `factors` object in `evaluate()` method
5. Update `calculateTotalScore()` to include new factor
6. Add tests/examples demonstrating the factor

## License

Part of the Planar Nexus project.
