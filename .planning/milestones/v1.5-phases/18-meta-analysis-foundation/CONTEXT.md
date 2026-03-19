# Phase 18 Context: Meta Analysis Foundation

## Phase Overview
**Goal**: Core meta analysis infrastructure with deck archetypes, health scoring, and trend tracking

**Depends on**: Phase 17 (existing features - deck builder, AI coach, draft/sealed modes)

## Requirements
- META-01: User can view top deck archetypes in selected format (Standard, Modern, Commander)
- META-02: User can see deck win rates and meta share percentages
- META-03: User can analyze card inclusion rates in top decks
- META-04: User can filter meta by date range (last 7 days, 30 days, all time)
- HEALTH-01: User can see format diversity score (0-100)
- HEALTH-02: User can view color distribution in meta
- HEALTH-03: User can see deck archetype balance metrics
- TREND-01: User can view rising deck archetypes (past 7 days)
- TREND-02: User can view declining deck archetypes
- TREND-03: User can see card inclusion rate changes over time

## Technical Context

### Current Architecture
- Frontend: Next.js 15, React 19, TypeScript, Tailwind CSS
- Storage: IndexedDB for offline-first data
- Charts: Recharts for data visualization
- No existing meta analysis features

### Existing Routes
- `/dashboard` - Main dashboard
- `/deck-builder` - Card search and deck management
- `/deck-coach` - AI deck analysis
- `/single-player` - Solo play mode
- `/multiplayer` - Multiplayer
- `/draft`, `/sealed` - Limited modes

### New Route Needed
- `/meta` - Meta analysis dashboard (new)

## Key Decisions

### Data Strategy
Since this is an offline-first app without a backend meta data source, implement:
1. **Mock/Sample Meta Data** - Pre-populated deck archetypes with realistic data
2. **Local Storage** - User can manually update/import meta data
3. **Structure Ready for API** - Types and interfaces designed for future API integration

### UI Components Needed
1. Meta overview dashboard with format selector
2. Deck archetype cards with win rates and meta share
3. Card inclusion rate visualization
4. Date range filter
5. Format health score gauge
6. Color distribution pie chart
7. Trend indicators (rising/falling arrows)

## Dependencies
- Phase 17 play integration (completed)
- No external services required

## Out of Scope (Phase 19+)
- Anti-meta recommendations (AMETA-01, AMETA-02, AMETA-03)
- Matchup guides (MATCH-01, MATCH-02, MATCH-03)
- Game phase strategy (PHASE-01, PHASE-02, PHASE-03, PHASE-04)
