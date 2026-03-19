# Phase 17: Play Integration - Context

## Overview

Phase 17 enables users to launch an AI opponent game directly from a draft or sealed session using their built limited deck. This bridges the gap between limited formats (draft/sealed) and the AI single-player game experience.

## Current State

### Existing Components
- **Draft Session**: `/src/app/(app)/draft/` - Card picking workflow with 3+ AI bots
- **Sealed Session**: `/src/app/(app)/sealed/` - Pool building from pre-generated packs
- **Limited Deck Builder**: `/src/app/(app)/limited-deck-builder/` - 40-card deck construction from pool
- **Single Player Game**: `/src/app/(app)/single-player/` - AI opponent battle system

### Key Dependencies (Phase 16)
Phase 16 (AI Neighbors) provides the bot passing mechanics and should be mostly complete before Phase 17 integration work begins.

## Requirements

### LPLY-01: Launch AI Game with Built Limited Deck
- Add "Play Game" button in limited deck builder when deck is valid
- Pass limited deck to single-player game as opponent deck
- User plays as the "home" player against AI opponent

### LPLY-02: Limited Deck Format Validation
- Validate 40-card minimum before allowing game launch
- Enforce 4-copy limit per card (MTG Commander-style for limited)
- Show validation errors in UI

### LPLY-03: Post-Game Return to Session
- After game ends, show "Return to Draft/Sealed" option
- Preserve session state (pool, deck, picks)
- Allow continuing or rebuilding deck

## Technical Considerations

### Navigation Flow
```
Draft/Sealed Session → Limited Deck Builder → [Play Game] → Single Player Game → [Return] → Limited Deck Builder
```

### Data Passing
- Limited session must store deck in state/context
- Single-player needs to accept "limited" deck type
- Session ID tracks draft/sealed context for return navigation

### UI Integration Points
1. Limited deck builder: Add "Play vs AI" button (enabled when deck valid)
2. Single-player: Detect limited deck and show appropriate UI
3. Game end: Show "Return to Session" button prominently

## Questions for Planning
1. Should we generate a random AI opponent deck or use a prebuilt deck for limited play?
2. Should limited games count toward any statistics?
3. Should we allow re-decking after games (same pool, different build)?
