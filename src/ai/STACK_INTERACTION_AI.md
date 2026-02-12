# Stack Interaction AI Documentation

## Overview

The Stack Interaction AI provides intelligent decision-making for responding to spells and abilities on the stack in Magic: The Gathering. This system handles counterspell decisions, response timing, resource management, and complex stack interaction scenarios.

## Architecture

### Core Components

1. **StackInteractionAI** - Main class that orchestrates all stack interaction decisions
2. **ResponseEvaluator** - Evaluates whether to respond to stack actions
3. **CounterspellDecider** - Determines when to use counterspells
4. **ResourceManager** - Manages holding vs. using mana
5. **StackOrderOptimizer** - Optimizes multiple response ordering

### Key Interfaces

#### StackAction
Represents a spell or ability on the stack:
```typescript
interface StackAction {
  id: string;
  cardId: string;
  name: string;
  controller: string;
  type: 'spell' | 'ability';
  manaValue: number;
  colors?: string[];
  targets?: Target[];
  isInstantSpeed: boolean;
  timestamp: number;
}
```

#### AvailableResponse
Represents a response available to the AI:
```typescript
interface AvailableResponse {
  cardId: string;
  name: string;
  type: 'instant' | 'flash' | 'ability';
  manaValue: number;
  manaCost: { [color: string]: number };
  canCounter: boolean;
  canTarget: string[];
  effect: ResponseEffect;
}
```

#### ResponseDecision
The AI's decision for stack interaction:
```typescript
interface ResponseDecision {
  shouldRespond: boolean;
  action: 'pass' | 'respond' | 'hold_priority';
  responseCardId?: string;
  targetActionId?: string;
  reasoning: string;
  confidence: number; // 0-1
  expectedValue: number; // Expected game state improvement
  holdMana?: boolean;
  waitForBetterResponse?: boolean;
}
```

#### StackContext
Context for stack interaction decisions:
```typescript
interface StackContext {
  currentAction: StackAction;
  stackSize: number;
  actionsAbove: StackAction[];
  availableMana: { [color: string]: number };
  availableResponses: AvailableResponse[];
  opponentsRemaining: string[];
  isMyTurn: boolean;
  phase: string;
  step: string;
  respondingToOpponent: boolean;
}
```

## Decision Making Process

### 1. Response Evaluation

When an opponent casts a spell or activates an ability, the AI:

1. **Assesses Threat Level** - Evaluates how dangerous the action is
   - Mana value of the spell
   - Targets (especially our permanents)
   - Card type and keywords
   - Current game state context

2. **Checks Available Responses** - Determines what responses are available
   - Can we afford the mana cost?
   - Do we have valid targets?
   - Are the timing restrictions met?

3. **Evaluates Each Response** - Scores each possible response
   - Effect value (what does it do?)
   - Efficiency (cost vs. impact)
   - Threat prevention
   - Card advantage impact
   - Tempo impact
   - Resource conservation

4. **Makes Decision** - Determines whether to respond
   - Compare expected value to threshold
   - Adjust threshold based on game state
   - Consider holding mana for better opportunities

### 2. Counterspell Decisions

Counterspells are a special category of responses with additional considerations:

#### Counterspell Factors

```typescript
interface CounterspellFactors {
  threatLevel: number;              // How dangerous is the spell?
  cardAdvantageImpact: number;      // Will countering gain card advantage?
  tempoImpact: number;              // Does this improve our tempo?
  lifeImpact: number;               // Does this prevent damage?
  winConditionDisruption: number;   // Does this protect our win condition?
  canBeRecurred: boolean;           // Can we get this counterspell back?
  hasBackup: boolean;               // Do we have other answers?
  opponentHasCounterspell: boolean; // Will they counter our counter?
}
```

#### Decision Heuristics

- **High Threat (0.7+)**: Strong consideration to counter
- **Win Condition Protection**: High priority
- **Card Advantage**: Countering draw spells is valuable
- **Tempo**: Countering expensive spells with cheap counterspells
- **Opponent Counterplay**: Consider if they might counter our counterspell
- **Recursion**: Save counterspells that can be recurred if possible

### 3. Resource Management

The AI must decide whether to:
- Use mana now
- Hold mana for end step
- Hold mana for opponent's turn
- Hold mana for a better threat

#### Factors Considered

- **Game State**: Winning vs. losing
- **Instant-Speed Options**: Do we have instants/flash cards?
- **Opponent's Turn**: Always hold some interaction for opponent's turn
- **Threat Assessment**: Are we under immediate pressure?
- **Mana Efficiency**: Can we use all our mana efficiently?

### 4. Priority Passing

When deciding whether to pass priority:

- **Risk Assessment**: Low, medium, or high risk to pass
- **Stack Size**: Deeper stacks are more complex
- **Opponents Remaining**: Can they respond?
- **Threat Level**: Is the current action dangerous?

### 5. Stack Ordering

When multiple responses are available, the AI optimizes the order:

- **Response Value**: Higher-value responses first
- **Position Multiplier**: Earlier responses are worth more (they resolve first)
- **Mana Constraints**: Respect available mana
- **Synergy**: Consider how responses interact

## Difficulty Levels

### Easy
- Prioritizes threat prevention
- Less consideration of card advantage
- Simple heuristics
- More likely to use resources

### Medium
- Balanced approach
- Considers card advantage and tempo
- Some resource conservation
- Basic counterplay awareness

### Hard
- Heavy card advantage focus
- Advanced resource management
- Sophisticated counterplay awareness
- Strategic holding of resources
- Complex stack ordering

## Integration with Game State Evaluator

The Stack Interaction AI uses the Game State Evaluator to:

- **Assess Current Position**: Are we winning or losing?
- **Identify Threats**: What dangers exist on the battlefield?
- **Calculate Resources**: What advantages do we have?
- **Evaluate Progress**: How close are we to winning?

## Usage Examples

### Basic Response Decision

```typescript
import { evaluateStackResponse } from '@/ai/stack-interaction-ai';

const decision = evaluateStackResponse(
  gameState,
  playerId,
  stackContext,
  'medium'
);

if (decision.shouldRespond) {
  // Cast the response spell
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

if (decision.shouldRespond) {
  // Use counterspell
  castCounterspell(decision.responseCardId);
}
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
} else {
  // Hold mana for later
  reserveMana(decision.manaToReserve);
}
```

## Key Heuristics

### When to Respond

1. **High Threat Spells**: Counters win conditions, board wipes, or lethal damage
2. **Card Advantage**: Counter opponent's draw spells
3. **Tempo Swings**: Counter expensive spells with cheap answers
4. **Protection**: Protect key pieces or our win condition

### When to Hold

1. **Low Threat**: Save resources for bigger threats
2. **Inefficient Trade**: Don't 1-for-1 low-impact spells
3. **Counterplay Risk**: Opponent might counter our response
4. **Better Targets**: Wait for more valuable targets
5. **Opponent's Turn**: Keep mana open for interaction

### End of Turn Plays

- Use instant-speed effects at end of opponent's turn
- Preserve information advantage
- Force opponent to play around potential answers

## Advanced Scenarios

### Counter Wars

When both players have counterspells:
- Consider if we have backup
- Evaluate card advantage impact
- Assess who will "win" the counter war
- Sometimes it's better to let something resolve than lose a counter war

### Stack Building

With multiple items on the stack:
- Items on top resolve first
- Plan responses in reverse order
- Consider holding priority to add more responses
- Watch for triggers that might occur

### Resource Conservation

- Don't tap out if you don't have to
- Keep mana open for interaction on opponent's turn
- Consider the opportunity cost of using resources now
- Save premium removal for premium threats

## Testing and Examples

See `stack-interaction-example.ts` for comprehensive examples including:

1. Basic counterspell decisions
2. When NOT to counter
3. Resource management
4. High-threat scenarios
5. Complex stack ordering
6. Priority decisions
7. End-of-turn plays
8. Card advantage considerations

Run examples:
```typescript
import { runAllStackInteractionExamples } from '@/ai/stack-interaction-example';

runAllStackInteractionExamples();
```

## Performance Considerations

- Response evaluation is fast (single pass through available responses)
- Stack ordering complexity is O(n!) for n responses, but n is typically small (2-3)
- Game state evaluation is cached when possible
- Heuristic-based decisions avoid expensive tree searches

## Future Enhancements

1. **Machine Learning**: Train on real gameplay data to improve decisions
2. **Opponent Modeling**: Learn opponent patterns and adjust accordingly
3. **Deck-Specific Heuristics**: Customize decisions based on deck archetype
4. **Tournament Considerations**: Add tournament-specific strategy
5. **Bluff Detection**: Identify when opponents are bluffing
6. **Multiplayer Dynamics**: Handle complex multiplayer politics

## Contributing

When modifying the Stack Interaction AI:

1. Maintain the existing interface contracts
2. Update examples to demonstrate new behavior
3. Test with various game states and difficulty levels
4. Consider edge cases (empty stack, no responses, etc.)
5. Document new heuristics and decision factors
6. Ensure backward compatibility with existing code

## References

- [Magic: The Gathering Comprehensive Rules](https://magic.wizards.com/en/rules)
- [Game State Evaluator Documentation](./GAME_STATE_EVALUATOR.md)
- [Phase 3: AI Opponent - Stack AI](https://github.com/your-repo/issues/38)
