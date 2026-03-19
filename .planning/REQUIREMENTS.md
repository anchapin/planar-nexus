# Requirements: Planar Nexus v1.7 — Conversational AI Coach

**Defined:** 2026-03-19
**Core Value:** Free open-source tabletop card game deck builder and tester with AI coaching.
**Research:** `.planning/research/SUMMARY.md` (to be completed)

---

## v1.7 Requirements

### Chat Interface

- [ ] **CHAT-01**: Chat interface displays message history with user and AI messages clearly distinguished
- [ ] **CHAT-02**: User can type and send messages via input field
- [ ] **CHAT-03**: Messages are timestamped and displayed in chronological order
- [ ] **CHAT-04**: Typing indicator shows when AI is composing response
- [ ] **CHAT-05**: Chat history persists during session
- [ ] **CHAT-06**: Chat interface is accessible and keyboard-navigable

---

## v1.5 Requirements

### Meta Deck Analysis

- [ ] **META-01**: User can view top deck archetypes in selected format (Standard, Modern, Commander)
- [ ] **META-02**: User can see deck win rates and meta share percentages
- [ ] **META-03**: User can analyze card inclusion rates in top decks
- [ ] **META-04**: User can filter meta by date range (last 7 days, 30 days, all time)

### Anti-Meta Recommendations

- [ ] **AMETA-01**: User can get counter recommendations for specific deck archetypes
- [ ] **AMETA-02**: User can see sideboard recommendations vs. popular matchups
- [ ] **AMETA-03**: User can view mana base recommendations for anti-meta decks

### Format Health Score

- [ ] **HEALTH-01**: User can see format diversity score (0-100)
- [ ] **HEALTH-02**: User can view color distribution in meta
- [ ] **HEALTH-03**: User can see deck archetype balance metrics

### Meta Trend Tracking

- [ ] **TREND-01**: User can view rising deck archetypes (past 7 days)
- [ ] **TREND-02**: User can view declining deck archetypes
- [ ] **TREND-03**: User can see card inclusion rate changes over time

### Matchup Guides

- [ ] **MATCH-01**: User can get pre-game strategic advice vs. specific archetypes
- [ ] **MATCH-02**: User can see mulligan recommendations per matchup
- [ ] **MATCH-03**: User can view game plan tips (aggro vs. control vs. midrange)

### Sideboard Plans

- [ ] **SIDE-01**: User can get generic sideboard guides per archetype matchup
- [ ] **SIDE-02**: User can see in/out recommendations with card counts
- [ ] **SIDE-03**: User can save custom sideboard plans for future reference

### Mana Curve Optimization

- [ ] **MANA-01**: User can get land count recommendations based on deck strategy
- [ ] **MANA-02**: User can see mana curve suggestions for aggro/control/midrange
- [ ] **MANA-03**: User can get color mana requirements analysis

### Game Phase Strategy

- [ ] **PHASE-01**: User can get opening hand evaluation tips
- [ ] **PHASE-02**: User can see mid-game strategic priorities by deck type
- [ ] **PHASE-03**: User can get late-game top-deck scenarios advice
- [ ] **PHASE-04**: User can receive combat phase decision guidance

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
| SIDE-01 | Phase 20 | Pending |
| SIDE-02 | Phase 20 | Pending |
| SIDE-03 | Phase 20 | Pending |
| MANA-01 | Phase 20 | Pending |
| MANA-02 | Phase 20 | Pending |
| MANA-03 | Phase 20 | Pending |
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
*Last updated: 2026-03-19 after v1.5 milestone initiation*
