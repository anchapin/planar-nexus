# Requirements: Planar Nexus v1.7 — Conversational AI Coach

**Defined:** 2026-03-19
**Core Value:** Free open-source tabletop card game deck builder and tester with AI coaching.
**Research:** `.planning/research/SUMMARY.md` (to be completed)

---

## v1.7 Requirements

### Chat Interface

- [x] **CHAT-01**: Chat interface displays message history with user and AI messages clearly distinguished ✅
- [x] **CHAT-02**: User can type and send messages via input field ✅
- [x] **CHAT-03**: Messages are timestamped and displayed in chronological order ✅
- [x] **CHAT-04**: Typing indicator shows when AI is composing response ✅
- [x] **CHAT-05**: Chat history persists during session ✅
- [x] **CHAT-06**: Chat interface is accessible and keyboard-navigable ✅

---

## v1.5 Requirements

### Meta Deck Analysis

- [x] **META-01**: User can view top deck archetypes in selected format (Standard, Modern, Commander) ✅
- [x] **META-02**: User can see deck win rates and meta share percentages ✅
- [x] **META-03**: User can analyze card inclusion rates in top decks ✅
- [x] **META-04**: User can filter meta by date range (last 7 days, 30 days, all time) ✅

### Anti-Meta Recommendations

- [x] **AMETA-01**: User can get counter recommendations for specific deck archetypes ✅
- [x] **AMETA-02**: User can see sideboard recommendations vs. popular matchups ✅
- [x] **AMETA-03**: User can view mana base recommendations for anti-meta decks ✅

### Format Health Score

- [x] **HEALTH-01**: User can see format diversity score (0-100) ✅
- [x] **HEALTH-02**: User can view color distribution in meta ✅
- [x] **HEALTH-03**: User can see deck archetype balance metrics ✅

### Meta Trend Tracking

- [x] **TREND-01**: User can view rising deck archetypes (past 7 days) ✅
- [x] **TREND-02**: User can view declining deck archetypes ✅
- [x] **TREND-03**: User can see card inclusion rate changes over time ✅

### Matchup Guides

- [x] **MATCH-01**: User can get pre-game strategic advice vs. specific archetypes ✅
- [x] **MATCH-02**: User can see mulligan recommendations per matchup ✅
- [x] **MATCH-03**: User can view game plan tips (aggro vs. control vs. midrange) ✅

### Sideboard Plans

- [x] **SIDE-01**: User can get generic sideboard guides per archetype matchup ✅
- [x] **SIDE-02**: User can see in/out recommendations with card counts ✅
- [x] **SIDE-03**: User can save custom sideboard plans for future reference ✅

### Mana Curve Optimization

- [x] **MANA-01**: User can get land count recommendations based on deck strategy ✅
- [x] **MANA-02**: User can see mana curve suggestions for aggro/control/midrange ✅
- [x] **MANA-03**: User can get color mana requirements analysis ✅

### Game Phase Strategy

- [x] **PHASE-01**: User can get opening hand evaluation tips ✅
- [x] **PHASE-02**: User can see mid-game strategic priorities by deck type ✅
- [x] **PHASE-03**: User can get late-game top-deck scenarios advice ✅
- [x] **PHASE-04**: User can receive combat phase decision guidance ✅

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| Real-time meta data sync | Requires backend, client-side only for v1.5 |
| Deck import from meta | Security review needed, defer |
| Tournament results | Requires external API integration |
| Social sharing | Not core to MVP |

---

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| META-01 | Phase 18 | ✅ Complete |
| META-02 | Phase 18 | ✅ Complete |
| META-03 | Phase 18 | ✅ Complete |
| META-04 | Phase 18 | ✅ Complete |
| AMETA-01 | Phase 19 | ✅ Complete |
| AMETA-02 | Phase 19 | ✅ Complete |
| AMETA-03 | Phase 19 | ✅ Complete |
| HEALTH-01 | Phase 18 | ✅ Complete |
| HEALTH-02 | Phase 18 | ✅ Complete |
| HEALTH-03 | Phase 18 | ✅ Complete |
| TREND-01 | Phase 18 | ✅ Complete |
| TREND-02 | Phase 18 | ✅ Complete |
| TREND-03 | Phase 18 | ✅ Complete |
| MATCH-01 | Phase 19 | ✅ Complete |
| MATCH-02 | Phase 19 | ✅ Complete |
| MATCH-03 | Phase 19 | ✅ Complete |
| SIDE-01 | Phase 20 | ✅ Complete |
| SIDE-02 | Phase 20 | ✅ Complete |
| SIDE-03 | Phase 20 | ✅ Complete |
| MANA-01 | Phase 20 | ✅ Complete |
| MANA-02 | Phase 20 | ✅ Complete |
| MANA-03 | Phase 20 | ✅ Complete |
| PHASE-01 | Phase 19 | ✅ Complete |
| PHASE-02 | Phase 19 | ✅ Complete |
| PHASE-03 | Phase 19 | ✅ Complete |
| PHASE-04 | Phase 19 | ✅ Complete |

**Coverage:**
- v1.5 requirements: 26 total
- Mapped to phases: 26
- Unmapped: 0 ✓

---

*Requirements defined: 2026-03-19*
*Last updated: 2026-09-15 — v1.5 checkboxes reconciled with shipped code (issue #1721). All 26 requirements audited against the codebase, e.g. `src/lib/meta.ts` (archetypes/win rates/meta share/inclusion/date range), `src/lib/heuristic-meta-analysis.ts`, `src/components/meta/*` (FormatHealthGauge, ColorDistributionChart, ArchetypeBalance, ArchetypeTrends, CardTrendChart, MulliganTips, AntiMetaRecommendations), `src/lib/matchup-guides.ts`, `src/lib/sideboard-recommender.ts` + `src/lib/sideboard-plans.ts` + `src/app/(app)/sideboards/`, `src/lib/mana-curve.ts` (land counts, strategy curves, color requirements), and `src/lib/game-phase-strategy.ts` (opening/mid/late/combat).*
