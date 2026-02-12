# Stack Interaction AI - Phase 3.1

## Overview

This implementation provides comprehensive stack interaction AI for Magic: The Gathering gameplay, addressing Issue #38: "Phase 3.1: Create stack interaction AI". The AI makes intelligent decisions about responding to spells and abilities on the stack.

## Features Implemented

### 1. Response Evaluation
- **Threat Assessment**: Evaluates how dangerous each stack action is
- **Response Scoring**: Scores each possible response based on multiple factors
- **Decision Making**: Determines whether to respond or pass priority

### 2. Counterspell Decisions
- **When to Counter**: Intelligent decisions on when to use counterspells
- **Target Selection**: Which spells are worth countering
- **Counterplay Awareness**: Considers whether opponents might counter our counterspell
- **Resource Management**: Balances using counterspells vs. saving them

### 3. Response Timing
- **Instant Speed Assessment**: Evaluates instant-speed effects
- **End of Turn Plays**: Decides when to use effects at end of turn
- **Priority Holding**: Determines when to hold priority for additional responses

### 4. Resource Management
- **Mana Holding Decisions**: Whether to hold mana for later or use now
- **Efficiency Calculation**: Evaluates mana efficiency of responses
- **Opportunity Cost**: Considers what else mana could be used for

### 5. Complex Stack Interactions
- **Stack Ordering**: Optimizes order when adding multiple items to stack
- **Stack Depth Awareness**: Considers how deep the stack is
- **Multiple Response Optimization**: Coordinates multiple responses

## Files Structure

```
src/ai/
├── stack-interaction-ai.ts           # Main stack interaction AI implementation
├── stack-interaction-example.ts      # Comprehensive usage examples
├── STACK_INTERACTION_AI.md          # Full documentation
├── __tests__/
│   ├── stack-interaction-ai.test.ts # Jest unit tests
│   └── stack-integration-test.ts    # Integration tests
└── game-state-evaluator.ts          # Used for game state evaluation
```

## Usage

### Basic Response Decision

```typescript
import { evaluateStackResponse } from '@/ai/stack-interaction-ai';

const stackContext: StackContext = {
  currentAction: stackAction,
  stackSize: 1,
  actionsAbove: [],
  availableMana: { blue: 3, colorless: 0 },
  availableResponses: [myCounterspell],
  opponentsRemaining: [],
  isMyTurn: false,
  phase: 'precombat_main',
  step: 'main',
  respondingToOpponent: true,
};

const decision = evaluateStackResponse(
  gameState,
  playerId,
  stackContext,
  'medium'
);

if (decision.shouldRespond) {
  // Cast the response
  castSpell(decision.responseCardId, decision.targetActionId);
} else {
  // Pass priority
  passPriority();
}
```

### Counterspell Decision

```typescript
import { decideCounterspell } from '@/ai/stack-interaction-ai';

const decision = decideCounterspell(
  gameState,
  playerId,
  stackContext,
  counterspell,
  'hard'
);

console.log(`Should counter: ${decision.shouldRespond}`);
console.log(`Reasoning: ${decision.reasoning}`);
console.log(`Confidence: ${decision.confidence * 100}%`);
```

### Resource Management

```typescript
import { manageResponseResources } from '@/ai/stack-interaction-ai';

const decision = manageResponseResources(
  gameState,
  playerId,
  stackContext,
  'medium'
);

if (decision.useNow) {
  // Use mana now
  useMana(decision.manaToReserve);
} else {
  // Hold mana for later
  reserveMana(decision.manaToReserve);
}
```

## Key Decision Factors

### Threat Assessment
- Mana value of the spell
- Targets (especially our permanents)
- Card type and keywords
- Current game state (life, board position, etc.)

### Counterspell Considerations
- Threat level of the spell
- Card advantage impact
- Tempo swing potential
- Win condition protection
- Whether opponent might counter back
- If counterspell can be recurred

### Resource Management
- Game state (winning vs. losing)
- Instant-speed options available
- Opponent's turn considerations
- Immediate threat level
- Mana efficiency

## Difficulty Levels

### Easy
- Prioritizes threat prevention
- Less strategic resource management
- More likely to use resources
- Simpler heuristics

### Medium (Default)
- Balanced approach
- Considers card advantage and tempo
- Basic resource conservation
- Moderate counterplay awareness

### Hard
- Heavy card advantage focus
- Advanced resource management
- Sophisticated counterplay awareness
- Strategic resource holding
- Complex stack optimization

## Testing

### Run Integration Tests
```bash
npx tsx src/ai/__tests__/stack-integration-test.ts
```

### Run Examples
```bash
npx tsx -e "
import { runAllStackInteractionExamples } from './src/ai/stack-interaction-example';
runAllStackInteractionExamples();
"
```

## Integration with Game State Evaluator

The Stack Interaction AI integrates with the existing Game State Evaluator to:
- Assess current position (winning vs. losing)
- Identify threats on the battlefield
- Calculate available resources
- Evaluate progress toward win conditions

## Performance Characteristics

- **Response Evaluation**: O(n) where n is number of available responses
- **Stack Ordering**: O(n!) for n responses (but n is typically 2-3)
- **Memory**: Minimal - uses existing game state
- **Speed**: Fast enough for real-time gameplay decisions

## Design Decisions

### Heuristic-Based Approach
Chose heuristic evaluation over tree search because:
- Stack interactions are time-sensitive
- Full game tree is too large
- Heuristics work well for MTG decisions
- Allows for explainable reasoning

### Modular Design
Each decision type is separate for:
- Easier testing
- Better maintainability
- Clear separation of concerns
- Independent optimization

### Difficulty Scaling
Three difficulty levels provide:
- Accessibility for new players
- Challenge for experienced players
- Tunable AI behavior

## Future Enhancements

1. **Machine Learning**: Train on real gameplay data
2. **Opponent Modeling**: Learn and adapt to opponent patterns
3. **Deck-Specific Logic**: Customize decisions by deck archetype
4. **Tournament Strategy**: Add competitive play considerations
5. **Multiplayer Politics**: Handle multiplayer dynamics
6. **Bluff Detection**: Identify opponent bluffs

## Acceptance Criteria

### From Issue #38

- [x] **Counterspell decisions**: Full implementation with multiple factors
- [x] **Response timing**: Complete with instant-speed assessment
- [x] **Instant speed threat assessment**: Integrated with game state evaluator
- [x] **End of turn plays**: Resource management for optimal timing
- [x] **Holding priority evaluation**: Smart decisions on when to hold

### Additional Quality

- [x] **Smart stack interaction**: Comprehensive evaluation system
- [x] **Resource conservation**: Advanced mana management
- [x] **Threat response**: Multi-factor threat assessment

## Documentation

- **API Documentation**: See `STACK_INTERACTION_AI.md`
- **Usage Examples**: See `stack-interaction-example.ts`
- **Integration Tests**: See `stack-integration-test.ts`
- **Unit Tests**: See `stack-interaction-ai.test.ts`

## Contributing

When modifying the Stack Interaction AI:
1. Maintain existing interface contracts
2. Add examples for new behavior
3. Test with various game states
4. Update documentation
5. Ensure backward compatibility

## License

This code is part of the Planar Nexus project and follows the project's license terms.

## Acknowledgments

- Built on top of the Game State Evaluator
- Inspired by competitive Magic: The Gathering strategy
- Designed for integration with the Genkit AI framework
