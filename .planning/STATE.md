---
gsd_state_version: 1.0
milestone: v1.5
milestone_name: Meta & Strategy AI
status: planning
last_updated: "2026-03-19T00:25:17.000Z"
progress:
  total_phases: 3
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
---

# Project State: Planar Nexus

## Project Reference
- **Core Value**: Free open-source tabletop card game deck builder and tester with AI coaching.
- **Current Focus**: v1.5 STARTING - Meta & Strategy AI

## Current Position
- **Milestone**: v1.5 (Meta & Strategy AI)
- **Status**: Planning phases 18-20
- **Next**: Plan phase 18

## Milestone History

| Version | Name | Shipped | Phases |
|---------|------|---------|--------|
| v1.0 | MVP | 2026-03-12 | 1-3 |
| v1.1 | Polish & Stability | 2026-03-17 | 4-5 |
| v1.2 | AI Intelligence | 2026-03-17 | 6-10 |
| v1.3 | Deck Builder UX | 2026-03-18 | 11-13 |
| v1.4 | Draft/Sealed | 2026-03-19 | 14-17 |
| v1.5 | TBD | - | - |

## Phase Summary

| Phase | Name | Requirements | Status |
|-------|------|-------------|--------|
| 14 | Foundation | SET-01-03 ✅, SEAL-01-05 ✅, LBld-01-06 ✅, ISOL-01-03 ✅ | Complete |
| 15 | Draft Core | DRFT-01-11 ✅ | Complete |
| 16 | AI Neighbors | NEIB-01 ✅, NEIB-02 ✅, NEIB-03 ✅, NEIB-04 ✅, NEIB-05 ✅ | Complete |
| 17 | Play Integration | LPLY-01 ✅, LPLY-02 ✅, LPLY-03 ✅ | Complete |

## v1.4 Scope (COMPLETE)

### Phase 14: Foundation
- Set selection browser with card counts and release dates ✅
- Sealed pool opening (6 packs, all cards revealed) ✅
- Pool filtering by color, type, CMC ✅
- Limited deck builder with pool isolation ✅
- 40-card minimum, 4-copy limit validation ✅
- Pool persistence with session ID ✅

### Phase 15: Draft Core
- 3-pack draft with 14 cards each ✅ (15-01)
- Face-down packs revealed on open ✅ (15-01)
- Card selection to add to draft pool ✅ (15-02)
- Pool always visible during picking ✅ (15-02)
- Pick timer with visual warnings (green → yellow → red) ✅ (15-03)
- Timer auto-pick or skip on expiration ✅ (15-03)
- Draft completion and session persistence ✅ (15-04)

### Phase 16: AI Neighbors
- 2-player draft table simulation ✅
- Heuristic bot picking (random/medium difficulty) ✅
- Visual indication of bot picking ✅
- Pack passing animations ✅
- Difficulty selection before draft ✅

### Phase 17: Play Integration
- Launch AI opponent from limited session ✅
- Format validation before game start ✅
- Return to session after game ends ✅

## v1.5 Scope (Planning)

### Phase 18: Meta Analysis Foundation
- Meta deck analysis (archetypes, win rates, inclusion rates) ✅
- Format health score (diversity 0-100, color distribution)
- Meta trend tracking (rising/declining archetypes)

### Phase 19: Matchup & Strategy Guides
- Anti-meta recommendations
- Matchup guides (pre-game strategy, mulligans)
- Game phase strategy (opening, mid-game, late-game)

### Phase 20: Advanced Optimization
- Sideboard plans with in/out recommendations
- Mana curve optimization
- Color mana requirements analysis

## Requirements Coverage

- **Total v1.5 requirements**: 26
- **Mapped to phases**: 26 ✓
- **Unmapped**: 0 ✓

## Session Continuity
- **Last Action**: v1.4 milestone completed
- **Next Step**: Start v1.5 planning

## Decisions Made
- Pack-first drafting UX: cards stay face-down until user clicks to open
- Pool sidebar always visible during picking for easy reference
- Pick logic as pure functions for testability
- Timer color thresholds: green >15s, yellow ≤15s, red ≤5s
- Skip dialog auto-skips after 5 seconds if no action taken
