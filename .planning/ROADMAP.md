# Planar Nexus — Roadmap

## Milestones

- ✅ **v1.5 Meta & Strategy AI** — Phases 18-20 (shipped 2026-03-19)
- 🚧 **v1.6 TBD** — Future planning

---

<details>
<summary>✅ v1.0 MVP — SHIPPED 2026-03-12</summary>

- [x] Phase 1: Foundation (Core deck builder, card database)
- [x] Phase 2: AI Coach & Opponent (Heuristic analysis, difficulty levels)
- [x] Phase 3: Import/Export & Tauri (Deck formats, desktop installers)

</details>

<details>
<summary>✅ v1.1 Polish & Stability Pass — SHIPPED 2026-03-17</summary>

- [x] Phase 4-5: Test infrastructure, E2E reliability, bundle optimization
- [x] Mobile support, keyboard shortcuts, AI spectator mode

</details>

<details>
<summary>✅ v1.2 AI Intelligence & Advanced Coaching — SHIPPED 2026-03-17</summary>

- [x] Phase 6: Multi-Provider LLM & Streaming (OpenAI, Anthropic, Google Gemini)
- [x] Phase 7: Local Intelligence Foundation (Orama, Transformers.js)
- [x] Phase 8: AI Deck Assistant UX (Proactive suggestions, streaming explanations)
- [x] Phase 9: Adaptive Coaching & Player History (Personalized reports)
- [x] Phase 10: Expert Opponent AI Refinement (Complex interactions, multi-blocker)

</details>

<details>
<summary>✅ v1.3 Deck Builder UX Enhancements — SHIPPED 2026-03-18</summary>

- [x] Phase 11: Search & Filter Infrastructure (CMC, type, color, fuzzy, sorting)
- [x] Phase 12: Saved Searches & Statistics (Presets, mana curve, charts)
- [x] Phase 13: Quick-Add & Performance (Keyboard nav, virtual scrolling)

</details>

<details>
<summary>✅ v1.4 Draft/Sealed Limited Modes — SHIPPED 2026-03-19</summary>

- [x] **Phase 14: Foundation** — Set selection, sealed core, limited deck builder, pool isolation ✓ (completed 2026-03-18)
- [x] **Phase 15: Draft Core** — Draft state machine, timer, picker UI, pool display ✓ (completed 2026-03-18)
  **Plans:**
  - [x] 15-01-PLAN.md — Draft types, session creation, face-down pack generation ✅
  - [x] 15-02-PLAN.md — Draft UI (pack view, card picking, pool display) ✅
  - [x] 15-03-PLAN.md — Draft timer with color states and auto-pick ✅
  - [x] 15-04-PLAN.md — Draft completion, persistence, and verification ✅
- [x] **Phase 16: AI Neighbors** — Bot simulation, passing mechanics ✓ (completed 2026-03-18)
  **Plans:**
  - [x] 16-01-PLAN.md — AI neighbor types and configuration ✅
  - [x] 16-02-PLAN.md — AI neighbor heuristic logic (Easy/Medium) ✅
  - [x] 16-03-PLAN.md — AI pick trigger and state machine integration ✅
  - [x] 16-04-PLAN.md — Visual indication for AI picking ✅
  - [x] 16-05-PLAN.md — Pack passing animation ✅
  - [x] 16-06-PLAN.md — Integration testing and verification ✅
- [x] **Phase 17: Play Integration** — Launch AI game with limited deck ✓ (completed 2026-03-18)
  **Plans:**
  - [x] 17-01-PLAN.md — Launch AI Game with Built Limited Deck ✅
  - [x] 17-02-PLAN.md — Limited Deck Format Validation ✅
  - [x] 17-03-PLAN.md — Post-Game Return to Session ✅

</details>

<details>
<summary>✅ v1.5 Meta & Strategy AI — SHIPPED 2026-03-19</summary>

- [x] **Phase 18: Meta Analysis Foundation** ✅ (completed 2026-03-19)
  **Plans:**
  - [x] 18-01-PLAN.md — Meta deck analysis infrastructure ✅
- [x] **Phase 19: Matchup & Strategy Guides** ✅ (completed 2026-03-19)
  **Plans:**
  - [x] 19-01-PLAN.md — Anti-meta recommendations ✅
  - [x] 19-02-PLAN.md — Matchup guides ✅
  - [x] 19-03-PLAN.md — Game phase strategy ✅
- [x] **Phase 20: Advanced Optimization** ✅ (completed 2026-03-19)
  **Plans:**
  - [x] 20-01-PLAN.md — Custom Sideboard Plans (SIDE-03) ✅
  - [x] 20-02-PLAN.md — Mana Curve Optimization (MANA-01, MANA-02, MANA-03) ✅

</details>

---

## Phase Details

### Phase 18: Meta Analysis Foundation
**Goal**: Core meta analysis infrastructure with deck archetypes, health scoring, and trend tracking

**Depends on**: Phase 17 (existing features)

**Requirements**: META-01, META-02, META-03, META-04, HEALTH-01, HEALTH-02, HEALTH-03, TREND-01, TREND-02, TREND-03

**Success Criteria** (what must be TRUE):
1. User can view top deck archetypes in selected format with win rates
2. User can see card inclusion rates in top decks
3. User can filter meta by date range
4. User can view format health score (0-100)
5. User can view color distribution in meta
6. User can see rising/declining deck archetypes

**Plans**: TBD

---

### Phase 19: Matchup & Strategy Guides
**Goal**: Pre-game strategic advice, matchup guides, and game phase tips

**Depends on**: Phase 18

**Requirements**: AMETA-01, AMETA-02, AMETA-03, MATCH-01, MATCH-02, MATCH-03, PHASE-01, PHASE-02, PHASE-03, PHASE-04

**Success Criteria** (what must be TRUE):
1. User can get counter recommendations for specific archetypes
2. User can see sideboard recommendations vs. popular matchups
3. User can get pre-game strategic advice vs. specific archetypes
4. User can see mulligan recommendations per matchup
5. User can get opening hand evaluation tips
6. User can see mid-game strategic priorities by deck type
7. User can get late-game advice

**Plans**: TBD

---

### Phase 20: Advanced Optimization
**Goal**: Sideboard planning and mana curve optimization tools

**Depends on**: Phase 19

**Requirements**: SIDE-01, SIDE-02, SIDE-03, MANA-01, MANA-02, MANA-03

**Success Criteria** (what must be TRUE):
1. User can get sideboard guides per archetype matchup
2. User can see in/out recommendations with card counts
3. User can save custom sideboard plans
4. User can get land count recommendations based on deck strategy
5. User can see mana curve suggestions for aggro/control/midrange
6. User can get color mana requirements analysis

**Plans**: TBD

---

### Phase 14: Foundation
**Goal**: User can select a set, open sealed pools, and build limited decks from isolated pools

**Depends on**: Phase 13 (existing deck builder)

**Requirements**: SET-01, SET-02, SET-03, SEAL-01, SEAL-02, SEAL-03, SEAL-04, SEAL-05, LBld-01, LBld-02, LBld-03, LBld-04, LBld-05, LBld-06, ISOL-01, ISOL-02, ISOL-03

**Success Criteria** (what must be TRUE):
1. User can browse MTG sets sorted by release date or name and see card counts
2. User can select a set and start a sealed session that opens 6 packs immediately with all cards visible
3. User can filter sealed pool cards by color, type, and CMC within the deck builder
4. User can build a deck from sealed pool only with 40-card minimum and 4-copy limit enforced
5. Sealed pool persists across page refresh and has unique session ID
6. Limited pool cards are isolated from regular deck collection

**Plans**: 4 plans

Plans:
- [x] 14-01-PLAN.md — Foundation & Set Browser (types, set service, set browser UI) ✅
- [x] 14-02-PLAN.md — Sealed Core (pool generation, pool storage, isolation) ✅
- [x] 14-03-PLAN.md — Limited Deck Builder (validator, sealed page, limited deck builder) ✅
- [ ] 14-04-PLAN.md — Verification (human checkpoint)

---

### Phase 15: Draft Core
**Goal**: User can complete a 3-pack draft with timer and manage draft pool

**Depends on**: Phase 14

**Requirements**: DRFT-01, DRFT-02, DRFT-03, DRFT-04, DRFT-05, DRFT-06, DRFT-07, DRFT-08, DRFT-09, DRFT-10, DRFT-11

**Success Criteria** (what must be TRUE):
1. User can start a draft and receive 3 packs of 14 cards each, presented one at a time
2. Pack cards display face-down until user opens the pack to reveal contents
3. User can select one card from pack to add to draft pool, with pool viewable at all times
4. Draft timer counts down per pick with green → yellow → red visual warnings
5. Timer expiration auto-picks last hovered card or prompts user to skip
6. Draft completes after 3 packs and session persists for resumption

**Plans**: 4 plans

Plans:
- [x] 15-01-PLAN.md — Draft types, session creation, face-down pack generation ✅
- [x] 15-02-PLAN.md — Draft UI (pack view, card picking, pool display) ✅
- [x] 15-03-PLAN.md — Draft timer with color states and auto-pick ✅
- [ ] 15-04-PLAN.md — Draft completion, persistence, and verification

---

### Phase 16: AI Neighbors
**Goal**: User can draft against AI bot neighbors with passing mechanics

**Depends on**: Phase 15

**Requirements**: NEIB-01, NEIB-02, NEIB-03, NEIB-04, NEIB-05

**Success Criteria** (what must be TRUE):
1. User can enable AI neighbors to simulate a 2-player draft table
2. AI neighbors pick cards using heuristic logic (random for Easy, color-focused for Medium)
3. Visual indication shows when AI neighbor is actively picking
4. Pack cards animate to show passing between user and AI neighbor
5. AI neighbor difficulty is configurable before draft starts

**Plans**: TBD

---

### Phase 17: Play Integration
**Goal**: User can launch AI opponent game with completed limited deck

**Depends on**: Phase 16

**Requirements**: LPLY-01, LPLY-02, LPLY-03

**Success Criteria** (what must be TRUE):
1. User can launch AI opponent game directly from draft/sealed session with built deck
2. Limited deck format (40 cards, 4-copy limit) is validated before game starts
3. After game ends, user returns to limited session to continue or rebuild deck

**Plans**: TBD

---

## Progress Table

| Phase | Goal | Requirements | Plans Complete | Status | Completed |
|-------|------|--------------|----------------|--------|-----------|
| 14. Foundation | Set selection, sealed core, limited deck builder | Complete    | 2026-03-18 | ✅ Complete | 2026-03-18 |
| 15. Draft Core | 3-pack draft with timer | Complete | 4/4 | ✅ Complete | 2026-03-18 |
| 16. AI Neighbors | Bot simulation, passing mechanics | 5 | 6/6 | ✅ Complete | 2026-03-18 |
| 17. Play Integration | Launch AI game with limited deck | Complete | 3/3 | ✅ Complete | 2026-03-18 |
| 18. Meta Analysis | Meta decks, health score, trends | Complete | 1/1 | ✅ Complete | 2026-03-19 |
| 19. Matchup Guides | Strategy, matchups, game phases | Complete | 3/3 | ✅ Complete | 2026-03-19 |
| 20. Optimization | Sideboards, mana curves | Complete | 2/2 | ✅ Complete | 2026-03-19 |

---

**Current Status**: v1.5 COMPLETE — Meta & Strategy AI shipped

_For archived milestones, see `.planning/milestones/`_
