# AI Difficulty Configuration

## Overview

This document describes the AI difficulty tuning system for Planar Nexus. Each difficulty level is designed to provide a distinct challenge with target win rates that scale appropriately.

## Target Win Rates (Player vs AI)

| Difficulty | Target Win Rate | Description |
|------------|-----------------|-------------|
| Easy | ~80% | Beginner-friendly, makes obvious mistakes |
| Medium | ~60% | Balanced challenge for casual players |
| Hard | ~40% | Challenging for experienced players |
| Expert | ~25% | Near-perfect play, punishing mistakes |

---

## Configuration Parameters

### Core Parameters

| Parameter | Description |
|-----------|-------------|
| `randomnessFactor` | Probability of making a random decision (0 = perfect, 1 = completely random) |
| `lookaheadDepth` | How many plies (half-turns) ahead the AI evaluates |
| `blunderChance` | Probability of making a suboptimal move |
| `tempoPriority` | How much the AI prioritizes immediate vs long-term advantage (0-1) |
| `riskTolerance` | Willingness to take risky plays (0 = conservative, 1 = aggressive) |

### Evaluation Weights

The AI evaluates game states using weighted factors. Higher weights = more importance.

| Weight | Description |
|--------|-------------|
| `lifeScore` | Values life total advantage |
| `poisonScore` | Values poison counter advantage (lethal at 10) |
| `cardAdvantage` | Values having more cards than opponent |
| `handQuality` | Evaluates quality of cards in hand |
| `libraryDepth` | Values having more cards in library |
| `creaturePower` | Values total creature power on battlefield |
| `creatureToughness` | Values creature survivability |
| `creatureCount` | Values number of creatures |
| `permanentAdvantage` | Values total permanents on battlefield |
| `manaAvailable` | Values efficient mana usage |
| `tempoAdvantage` | Values tempo/initiative advantage |
| `commanderDamageWeight` | Values commander damage (lethal at 21) |
| `commanderPresence` | Values having commander on battlefield |
| `cardSelection` | Evaluates card quality and options |
| `graveyardValue` | Values graveyard resources |
| `synergy` | Recognizes card synergies |
| `winConditionProgress` | Pushes toward winning the game |
| `inevitability` | Values long-game advantage |

---

## Difficulty Profiles

### Easy

**Target Audience:** Beginners learning the game

**Behavioral Characteristics:**
- Prioritizes survival over strategic advantage
- Makes frequent mistakes (25% blunder rate)
- High randomness in decisions (40%)
- No lookahead - plays reactively
- Ignores card advantage and tempo
- Doesn't understand poison or commander damage threats
- Inefficient mana usage
- Slow to close out games

**Configuration:**
```typescript
{
  randomnessFactor: 0.4,
  lookaheadDepth: 1,
  blunderChance: 0.25,
  tempoPriority: 0.3,
  riskTolerance: 0.2,
  evaluationWeights: {
    lifeScore: 1.5,        // High: strongly values staying alive
    poisonScore: 3.0,      // Low: doesn't understand poison threat
    cardAdvantage: 0.3,    // Low: ignores card advantage
    handQuality: 0.2,      // Low: doesn't evaluate hand quality
    libraryDepth: 0.1,     // Low: ignores mill risk
    creaturePower: 0.5,    // Low: undervalues attacking power
    creatureToughness: 0.3,// Low: ignores creature survivability
    creatureCount: 0.3,    // Low: doesn't value board presence
    permanentAdvantage: 0.3,// Low: ignores permanent advantage
    manaAvailable: 0.2,    // Low: inefficient mana usage
    tempoAdvantage: 0.2,   // Low: doesn't understand tempo
    commanderDamageWeight: 1.0, // Low: ignores commander damage
    commanderPresence: 0.3,     // Low: undervalues commander
    cardSelection: 0.2,    // Low: poor card evaluation
    graveyardValue: 0.1,   // Low: ignores graveyard resources
    synergy: 0.1,          // Low: doesn't recognize synergies
    winConditionProgress: 0.5, // Low: slow to close games
    inevitability: 0.3,    // Low: doesn't plan for long game
  }
}
```

---

### Medium

**Target Audience:** Casual players with basic game knowledge

**Behavioral Characteristics:**
- Balanced evaluation of game states
- Makes occasional mistakes (10% blunder rate)
- Moderate randomness (20%)
- 2-ply lookahead - plans one turn ahead
- Understands basic card advantage
- Respects poison threats
- Decent mana efficiency
- Can be outsmarted with advanced strategy

**Configuration:**
```typescript
{
  randomnessFactor: 0.2,
  lookaheadDepth: 2,
  blunderChance: 0.1,
  tempoPriority: 0.5,
  riskTolerance: 0.5,
  evaluationWeights: {
    lifeScore: 1.0,        // Moderate: values life but not obsessed
    poisonScore: 6.0,      // Moderate: respects poison threat
    cardAdvantage: 0.8,    // Moderate: understands card advantage basics
    handQuality: 0.5,      // Moderate: evaluates hand somewhat
    libraryDepth: 0.2,     // Low-moderate: aware of mill risk
    creaturePower: 1.0,    // Moderate: values attacking power
    creatureToughness: 0.8,// Moderate: considers creature survivability
    creatureCount: 0.8,    // Moderate: values board presence
    permanentAdvantage: 1.0,// Moderate: understands permanent advantage
    manaAvailable: 0.6,    // Moderate: decent mana efficiency
    tempoAdvantage: 0.5,   // Moderate: understands tempo basics
    commanderDamageWeight: 2.5, // Moderate: respects commander damage
    commanderPresence: 0.8,     // Moderate: values commander
    cardSelection: 0.6,    // Moderate: decent card evaluation
    graveyardValue: 0.4,   // Low-moderate: some graveyard awareness
    synergy: 0.3,          // Low: basic synergy recognition
    winConditionProgress: 1.5, // Moderate: pushes win conditions
    inevitability: 0.8,    // Moderate: plans ahead somewhat
  }
}
```

---

### Hard

**Target Audience:** Experienced players

**Behavioral Characteristics:**
- Values strategic advantage and tempo
- Makes few mistakes (5% blunder rate)
- Low randomness (10%)
- 3-ply lookahead - plans multiple turns ahead
- Strongly values card advantage
- Very respectful of poison threats
- Efficient mana usage
- Punishes opponent errors
- Aggressively pursues win conditions

**Configuration:**
```typescript
{
  randomnessFactor: 0.1,
  lookaheadDepth: 3,
  blunderChance: 0.05,
  tempoPriority: 0.7,
  riskTolerance: 0.7,
  evaluationWeights: {
    lifeScore: 0.8,        // Lower: willing to trade life for advantage
    poisonScore: 9.0,      // High: very respectful of poison
    cardAdvantage: 1.5,    // High: strongly values card advantage
    handQuality: 0.9,      // High: good hand evaluation
    libraryDepth: 0.4,     // Moderate: manages library carefully
    creaturePower: 1.5,    // High: values aggressive positioning
    creatureToughness: 1.2,// High: considers creature trades carefully
    creatureCount: 1.2,    // High: values board control
    permanentAdvantage: 1.8,// High: fights for permanent advantage
    manaAvailable: 1.0,    // High: efficient mana usage
    tempoAdvantage: 1.0,   // High: understands tempo importance
    commanderDamageWeight: 4.0, // High: uses commander damage strategically
    commanderPresence: 1.5,     // High: leverages commander well
    cardSelection: 1.0,    // High: excellent card evaluation
    graveyardValue: 0.7,   // Moderate-high: utilizes graveyard
    synergy: 0.7,          // Moderate-high: recognizes synergies
    winConditionProgress: 2.5, // High: aggressively pursues wins
    inevitability: 1.5,    // High: plans for long game
  }
}
```

---

### Expert

**Target Audience:** Advanced players seeking maximum challenge

**Behavioral Characteristics:**
- Near-optimal play
- Minimal mistakes (2% blunder rate)
- Very low randomness (5%)
- 4-ply lookahead - deep strategic planning
- Maximizes all strategic advantages
- Perfect understanding of poison and commander damage
- Perfect mana efficiency
- Dominates board states
- Closes games efficiently
- Unbeatable in long games

**Configuration:**
```typescript
{
  randomnessFactor: 0.05,
  lookaheadDepth: 4,
  blunderChance: 0.02,
  tempoPriority: 0.9,
  riskTolerance: 0.85,
  evaluationWeights: {
    lifeScore: 0.6,        // Optimized: trades life efficiently for value
    poisonScore: 12.0,     // Maximum: understands poison is lethal
    cardAdvantage: 2.0,    // Maximum: card advantage is king
    handQuality: 1.5,      // High: excellent hand assessment
    libraryDepth: 0.8,     // High: manages deck resources optimally
    creaturePower: 2.0,    // High: maximizes combat advantage
    creatureToughness: 1.5,// High: optimal creature trading
    creatureCount: 2.0,    // High: dominates board states
    permanentAdvantage: 2.5,// Maximum: controls battlefield
    manaAvailable: 1.5,    // High: perfect mana efficiency
    tempoAdvantage: 1.2,   // High: tempo-focused play
    commanderDamageWeight: 5.0, // Maximum: lethal commander math
    commanderPresence: 2.0,     // High: commander-centric strategy
    cardSelection: 1.5,    // High: best card choices
    graveyardValue: 1.0,   // High: full graveyard utilization
    synergy: 1.0,          // High: maximizes card synergies
    winConditionProgress: 4.0, // Maximum: closes games efficiently
    inevitability: 2.5,    // Maximum: unbeatable in long games
  }
}
```

---

## Implementation Files

- **`src/ai/ai-difficulty.ts`** - Main difficulty configuration and manager class
- **`src/ai/game-state-evaluator.ts`** - Default evaluation weights for each difficulty
- **`src/app/(app)/single-player/page.tsx`** - UI difficulty selector with descriptions

---

## Usage

### Getting Difficulty Config

```typescript
import { getDifficultyConfig, DIFFICULTY_CONFIGS } from '@/ai/ai-difficulty';

const config = getDifficultyConfig('hard');
console.log(config.lookaheadDepth); // 3
console.log(config.blunderChance); // 0.05
```

### Using the Manager

```typescript
import { aiDifficultyManager } from '@/ai/ai-difficulty';

// Set difficulty
aiDifficultyManager.setDifficulty('expert');

// Check if AI should blunder
if (aiDifficultyManager.shouldBlunder()) {
  // Make a suboptimal move
}

// Get evaluation weights
const weights = aiDifficultyManager.getEvaluationWeights();

// Apply randomness to decision
const bestMove = aiDifficultyManager.applyRandomness(moves);
```

---

## Playtesting Recommendations

### Testing Approach

1. **Play 10 games at each difficulty level**
2. **Record results:**
   - Win/loss
   - Turn count
   - Notable AI decisions (good and bad)
   - Subjective difficulty rating (1-10)

3. **Calculate win rates and compare to targets:**
   - Easy: Target 70-90%
   - Medium: Target 50-70%
   - Hard: Target 30-50%
   - Expert: Target 15-35%

4. **Adjust configs if win rates are outside targets:**
   - If AI is too strong: Increase randomness, decrease lookahead, lower strategic weights
   - If AI is too weak: Decrease randomness, increase lookahead, increase strategic weights

### Key Behaviors to Verify

| Difficulty | Expected Behaviors |
|------------|-------------------|
| Easy | Makes obviously bad trades, ignores card advantage, inefficient mana use |
| Medium | Reasonable plays, occasional blunders, understands basics |
| Hard | Strong plays, rare mistakes, values advantage, punishes errors |
| Expert | Near-perfect play, deep planning, maximizes all advantages |

---

## Tuning Guidelines

### If Win Rates Don't Match Targets

1. **Adjust randomness factor** - Most direct way to change win rate
2. **Adjust blunder chance** - Changes frequency of obvious mistakes
3. **Adjust lookahead depth** - Changes strategic planning ability
4. **Fine-tune evaluation weights** - Subtle changes to AI priorities

### Making Difficulties More Distinct

1. **Increase gaps between randomness factors**
2. **Add/remove lookahead levels**
3. **Amplify weight differences** (e.g., make Easy ignore even more factors)

### Performance Considerations

- Higher lookahead depths increase computation time exponentially
- Consider adding time limits for Expert difficulty
- Easy/Medium should respond quickly for better UX

---

**Last Updated:** 2026-03-12
**Version:** 2.5 (Plan 2.5 Implementation)
