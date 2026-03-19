# Phase 20 Context: Advanced Optimization

**Phase**: 20  
**Status**: Ready to Plan  
**Created**: 2026-03-19

---

## Goals

Implement sideboard planning and mana curve optimization tools for v1.5 Meta & Strategy AI milestone.

## Requirements Addressed

| Category | Requirements | Status |
|----------|-------------|--------|
| Sideboard | SIDE-01, SIDE-02, SIDE-03 | Partial from Phase 19 |
| Mana | MANA-01, MANA-02, MANA-03 | Partial from Phase 19 |

**Total**: 6 requirements (some covered by Phase 19)

## Phase 19 Deliverables (Building Upon)

From Phase 19-01 (Anti-Meta):
- `src/lib/anti-meta.ts` - CounterRecommendation, SideboardRecommendation, SideboardCard, ManaBaseRecommendation types
- `getSideboardRecommendations(archetypeId, opponentArchetypeId, format)` - returns in/out cards
- `getManaBaseRecommendations(archetypeId, format)` - returns land counts and color requirements

From Phase 19-02 (Matchup):
- `src/lib/matchup-guides.ts` - MulliganTips, MatchupGuide types
- `/matchup` page with strategy guidance

From Phase 19-03 (Game Phase):
- `src/lib/game-phase-strategy.ts` - PhaseStrategy, HandEvaluation
- `/strategy` page with game phase tips

## Gaps to Address

### SIDE-03: Save Custom Sideboard Plans
**Gap**: Users can view sideboard recommendations but cannot save custom plans
**Needed**:
- LocalStorage persistence for user sideboard configurations
- UI to create/edit custom sideboard plans
- Link to deck builder for adding sideboard cards

### MANA-02: Mana Curve Suggestions
**Gap**: Users get land counts but not visual mana curve analysis
**Needed**:
- Mana curve visualization component
- Recommendations based on deck strategy (aggro/control/midrange)
- Integration with existing deck builder

## Key Decisions

### Data Strategy
- Continue using mock data for v1.5 (real data requires backend)
- Sideboard plans stored in localStorage (per user, per format)
- Reuse existing archetype data from `meta.ts`

### UI Architecture
- Extend existing AntiMetaRecommendations component
- New section in deck-builder for mana curve analysis
- Use localStorage for sideboard plan persistence

### Integration Points
- Link to deck-builder for sideboard card management
- Reuse meta page for archetype selection
- Connect to matchup guides for sideboard strategy

## Dependencies

- Phase 19 (Matchup & Strategy Guides) - **COMPLETED**
- Phase 18 (Meta Analysis Foundation) - **COMPLETED**
- Existing deck-builder components

## Success Criteria

All 6 requirements must pass verification:
1. Build succeeds (`npm run build`)
2. Type check passes (`npm run typecheck`)
3. Sideboard guides work per archetype matchup
4. In/out recommendations show card counts
5. Custom sideboard plans persist across sessions
6. Mana curve suggestions display for aggro/control/midrange

## Architecture Notes

```
src/
├── lib/
│   ├── anti-meta.ts          # Existing - SideboardRecommendation types
│   ├── mana-curve.ts         # NEW - Mana curve types & functions
│   └── sideboard-plans.ts    # NEW - Custom sideboard plan management
├── components/
│   └── meta/
│       ├── sideboard/        # NEW - Sideboard plan components
│       └── mana-curve/       # NEW - Mana curve visualization
└── app/(app)/
    └── deck-builder/         # EXTEND - Add mana curve analysis tab
```
