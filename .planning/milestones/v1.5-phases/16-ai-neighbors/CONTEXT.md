# Context: Phase 16 - AI Neighbors

## Phase Information
- **Phase**: 16
- **Name**: AI Neighbors
- **Goal**: User can draft against AI bot neighbors with passing mechanics
- **Depends on**: Phase 15

## Requirements (NEIB)
1. **NEIB-01**: User can draft against AI bot "neighbors" (simulated 2-player table)
2. **NEIB-02**: AI neighbors pick cards using heuristic logic (color preference, archetype)
3. **NEIB-03**: AI neighbors have difficulty levels (Easy: random, Medium: color-focused)
4. **NEIB-04**: Visual indication shows when AI neighbor is "picking"
5. **NEIB-05**: Pack cards visually "pass" between user and AI neighbor

## Success Criteria
1. User can enable AI neighbors to simulate a 2-player draft table
2. AI neighbors pick cards using heuristic logic (random for Easy, color-focused for Medium)
3. Visual indication shows when AI neighbor is actively picking
4. Pack cards animate to show passing between user and AI neighbor
5. AI neighbor difficulty is configurable before draft starts

## Locked Decisions (from PROJECT.md / Research)
- AI neighbors use heuristic-based card evaluation
- Two difficulty levels: Easy (random picks) and Medium (color-focused)
- Passing mechanic simulates left-right passing like real draft

## Technical Constraints
- Must integrate with existing draft flow from Phase 15
- Scryfall card data provides color identity for heuristic logic
- Pack passing requires visual animation system
- Need state management for AI neighbor picks

## Dependencies
- Phase 15 draft core (DRFT-04, DRFT-05 complete)
- Existing Scryfall card data integration
- Draft state management system

## Architecture Notes
- AI neighbor is a client-side "virtual player"
- Needs draft session state that tracks whose turn it is to pick
- Color-focused heuristic: prioritize cards matching dominant color in neighbor's pool
- Pack passing: rotate packs between user and AI positions

## Files Likely to Modify
- `/src/app/actions/draft-session.ts` - Draft state management
- `/src/components/draft/` - Draft UI components
- New: `/src/components/draft/pack-passing.tsx` - Animation component
- New: `/src/lib/ai-neighbor-logic.ts` - AI pick heuristics
