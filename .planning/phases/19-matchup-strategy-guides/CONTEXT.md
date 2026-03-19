# Phase 19 Context: Matchup & Strategy Guides

**Phase**: 19  
**Status**: Ready to Execute  
**Created**: 2026-03-19

---

## Goals

Implement pre-game strategic advice, matchup guides, and game phase tips for v1.5 Meta & Strategy AI milestone.

## Requirements Addressed

| Category | Requirements |
|----------|-------------|
| Anti-Meta | AMETA-01, AMETA-02, AMETA-03 |
| Matchups | MATCH-01, MATCH-02, MATCH-03 |
| Game Phases | PHASE-01, PHASE-02, PHASE-03, PHASE-04 |

**Total**: 10 requirements

## Plans Created

1. **19-01**: Anti-Meta Counter Recommendations
2. **19-02**: Matchup Strategy Guides  
3. **19-03**: Game Phase Strategy Guides

## Key Decisions

### Data Strategy
- Use mock data for v1.5 (real data requires backend)
- Structure services for easy API integration later
- All data types are forward-compatible with real API

### UI Architecture
- Leverage existing Meta page (Phase 18)
- New routes: `/matchup`, `/strategy`
- Use shadcn components: Dialog, Sheet, Tabs, Accordion

### Integration Points
- Link to deck-builder for building counter decks
- Link to AI Coach for personalized advice
- Link to draft/sealed for limited strategy

## Dependencies

- Phase 18 (Meta Analysis Foundation) - **COMPLETED**
- Anti-meta data uses existing archetypes from `meta.ts`
- Matchup guides reference existing archetype categories

## Execution Order

1. Execute 19-01 (Anti-Meta) - builds foundation
2. Execute 19-02 (Matchups) - builds on anti-meta data
3. Execute 19-03 (Game Phases) - independent, uses archetypes

## Success Criteria

All 10 requirements must pass verification:
- Build succeeds (`npm run build`)
- Type check passes (`npm run typecheck`)
- All pages render correctly
- Responsive design works on mobile
