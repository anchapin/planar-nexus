# Unit 12 Implementation Guide - Heuristic AI Systems

## Quick Start

All AI functionality now works completely offline using heuristic algorithms. No API keys or external services are required.

## Heuristic AI Systems Overview

### 1. Deck Coach (`/src/ai/flows/heuristic-deck-coach-review.ts`)

**Usage:**
```typescript
import { reviewDeck, DeckReviewInput } from '@/ai/flows/heuristic-deck-coach-review';

const input: DeckReviewInput = {
  decklist: '4 Lightning Bolt\n4 Counterspell\n...',
  format: 'Modern'
};

const review = await reviewDeck(input);
console.log(review.reviewSummary);
console.log(review.deckOptions);
```

**What it does:**
- Parses decklist and analyzes composition
- Identifies mana ratio issues
- Provides format-specific advice
- Suggests card additions/removals

### 2. Opponent Deck Generation (`/src/ai/flows/heuristic-opponent-deck-generation.ts`)

**Usage:**
```typescript
import { generateAIOpponentDeck } from '@/ai/flows/heuristic-opponent-deck-generation';

const opponent = await generateAIOpponentDeck({
  theme: 'aggressive red',
  difficulty: 'medium'
});

console.log(opponent.deckList);
console.log(opponent.strategicApproach);
```

**Available themes:**
- `aggressive red` - Burn/aggro strategy
- `control blue` - Counterspell/control
- `token generation` - Swarm/anthems
- `mill` - Library depletion
- `ramp` - Mana acceleration
- `midrange` - Value/interaction mix

**Difficulty levels:**
- `easy` - Simplified deck, suboptimal play
- `medium` - Full deck, solid play
- `hard` - Full deck, optimal play

### 3. Gameplay Assistance (`/src/ai/flows/heuristic-gameplay-assistance.ts`)

**Usage:**
```typescript
import { provideGameplayAssistance } from '@/ai/flows/heuristic-gameplay-assistance';

const advice = await provideGameplayAssistance({
  gameState: currentGameState,
  phase: 'combat',
  question: 'Should I attack with my creatures?'
});

console.log(advice.advice);
console.log(advice.recommendedActions);
```

**Supported phases:**
- `main` - Development phase advice
- `combat` - Attack/blocking strategy
- `end` - End step optimization

### 4. Draft Assistant (`/src/ai/flows/heuristic-draft-assistant.ts`)

**Usage:**
```typescript
import { provideDraftAssistance } from '@/ai/flows/heuristic-draft-assistant';

const pick = await provideDraftAssistance({
  packNumber: 1,
  pickNumber: 3,
  cardsInPack: ['Card A', 'Card B', 'Card C'],
  format: 'Standard'
});

console.log(pick.recommendedPick);
console.log(pick.reasoning);
console.log(pick.alternativePicks);
```

**Card scoring factors:**
- Keywords (flying, trample, deathtouch, etc.)
- Removal spells
- Card draw
- Efficient stats

### 5. Post-Game Analysis (`/src/ai/flows/heuristic-post-game-analysis.ts`)

**Usage:**
```typescript
import { providePostGameAnalysis } from '@/ai/flows/heuristic-post-game-analysis';

const analysis = await providePostGameAnalysis({
  gameData: {
    winner: 'you',
    turns: 12,
    yourDeck: ['Card 1', 'Card 2'],
    opponentDeck: 'Aggro Red'
  }
});

console.log(analysis.summary);
console.log(analysis.strengths);
console.log(analysis.recommendations);
```

**Analysis dimensions:**
- Game length assessment
- Strength identification
- Weakness identification
- Improvement recommendations

### 6. Meta Analysis (`/src/ai/flows/heuristic-meta-analysis.ts`)

**Usage:**
```typescript
import { provideMetaAnalysis } from '@/ai/flows/heuristic-meta-analysis';

const meta = await provideMetaAnalysis({
  format: 'Modern',
  deckList: 'Your deck list here'
});

console.log(meta.metagameSummary);
console.log(meta.topArchetypes);
console.log(meta.recommendations);
```

**Archetypes included:**
- Aggro (25%)
- Control (20%)
- Midrange (20%)
- Combo (15%)
- Tempo (10%)
- Ramp (10%)

## Gameplay AI (Units 6-7)

These systems power actual gameplay decisions and remain unchanged:

### Game State Evaluator
```typescript
import { evaluateGameState } from '@/ai/game-state-evaluator';

const evaluation = evaluateGameState(gameState, playerId, 'medium');
console.log(evaluation.totalScore);
console.log(evaluation.threats);
console.log(evaluation.recommendedActions);
```

### Combat Decision Tree
```typescript
import { generateAttackDecisions } from '@/ai/decision-making';

const combatPlan = generateAttackDecisions(gameState, aiPlayerId, 'hard');
console.log(combatPlan.attacks);
console.log(combatPlan.strategy);
```

### Stack Interaction AI
```typescript
import { StackInteractionAI } from '@/ai/stack-interaction-ai';

const ai = new StackInteractionAI(gameState, aiPlayerId);
const decision = ai.evaluateStackActions(stackActions);
console.log(decision.shouldRespond);
```

## Testing Heuristic Systems

### Unit Testing
```typescript
import { reviewDeck } from '@/ai/flows/heuristic-deck-coach-review';

describe('Deck Coach', () => {
  it('should analyze deck composition', async () => {
    const result = await reviewDeck({
      decklist: '4 Lightning Bolt',
      format: 'Modern'
    });

    expect(result.reviewSummary).toContain('Deck Overview');
    expect(result.deckOptions).toBeDefined();
  });
});
```

### Integration Testing
```typescript
import { getDeckReview } from '@/app/actions';

describe('Deck Coach Integration', () => {
  it('should work through server actions', async () => {
    const review = await getDeckReview({
      decklist: '4 Lightning Bolt\n4 Counterspell',
      format: 'Standard'
    });

    expect(review).toBeDefined();
  });
});
```

## Customization

### Adding New Deck Templates

Edit `/src/ai/flows/heuristic-opponent-deck-generation.ts`:

```typescript
const deckTemplates = {
  // ... existing templates ...
  'your new theme': {
    cards: [
      'Card Name x4',
      'Another Card x3',
      // ... more cards
    ],
    strategy: 'Your strategic description here'
  }
};
```

### Modifying Heuristic Weights

Edit the scoring functions in individual heuristic files:

```typescript
// In heuristic-deck-coach-review.ts
function analyzeDeck(cards) {
  // Modify land ratio target
  const targetLands = Math.round(totalCards * 0.4); // Change 0.4 to adjust
}

// In heuristic-draft-assistant.ts
function analyzeCardValue(cardName: string): number {
  // Modify keyword weights
  if (lowerName.includes('flying')) score += 2; // Change 2 to adjust
}
```

### Adding New Meta Archetypes

Edit `/src/ai/flows/heuristic-meta-analysis.ts`:

```typescript
const commonArchetypes = [
  // ... existing archetypes ...
  {
    name: 'Your Archetype',
    prevalence: '15%',
    strengths: ['Strength 1', 'Strength 2'],
    weaknesses: ['Weakness 1', 'Weakness 2'],
    goodMatchups: ['Good Matchup 1'],
    badMatchups: ['Bad Matchup 1']
  }
];
```

## Performance Characteristics

### Response Times
- **Deck Coach:** ~10ms (instant)
- **Opponent Generation:** ~5ms (template lookup)
- **Gameplay Assistance:** ~1ms (simple conditional)
- **Draft Assistant:** ~15ms (card scoring)
- **Post-Game Analysis:** ~5ms (game length analysis)
- **Meta Analysis:** ~2ms (static data)

### Resource Usage
- **Memory:** Minimal (no model loading)
- **CPU:** Negligible (simple calculations)
- **Network:** None (offline operation)
- **Storage:** None (no caching required)

## Troubleshooting

### Issue: Deck review provides generic advice
**Solution:** Ensure decklist is properly formatted with quantities:
```
4 Lightning Bolt
3 Counterspell
```

### Issue: Opponent generation returns default deck
**Solution:** Check that theme matches available templates:
- `aggressive red`
- `control blue`
- `token generation`
- `mill`
- `ramp`
- `midrange`

### Issue: Gameplay advice doesn't match context
**Solution:** Provide correct phase name:
- `main`
- `combat`
- `end`

### Issue: Draft picks seem suboptimal
**Solution:** The heuristic scoring is basic. For competitive drafting, consider:
- Adjusting keyword weights in `analyzeCardValue`
- Adding color synergy analysis
- Implementing curve optimization

## Best Practices

1. **Use Heuristics for Speed:** Expect instant responses with no network latency
2. **Combine with Human Insight:** Use heuristic suggestions as a starting point, then apply your own judgment
3. **Test Different Approaches:** Try multiple deck options from deck coach to find what works best
4. **Iterate on Heuristics:** Customize scoring weights based on your experience
5. **Leverage Deterministic Behavior:** Use consistent responses for testing and debugging

## Future Enhancements

### Easy Improvements
1. Add more deck templates for opponent generation
2. Expand card analysis keywords for draft assistant
3. Add color synergy detection to draft assistant
4. Implement curve optimization suggestions
5. Add sideboard recommendations

### Advanced Features
1. Learn from user feedback to adjust weights
2. Track win rates to improve recommendations
3. Implement deck similarity matching
4. Add card interaction analysis
5. Create combo detection in deck coach

## Support

For issues with heuristic systems:
1. Check the implementation files for customization points
2. Review the completion summary for detailed behavior descriptions
3. Test with different inputs to understand edge cases
4. Modify heuristics locally for your specific needs

---

**Note:** All heuristic systems are designed to be fast, reliable, and work completely offline. They provide good baseline functionality but may not match the creativity or adaptability of AI systems in all scenarios.
