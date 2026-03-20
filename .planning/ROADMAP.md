# Planar Nexus — Roadmap

## Milestones

- ✅ **v1.6 QA/QC Infrastructure** — Phases 21-26 (shipped 2026-03-19)
- ✅ **v1.7 Conversational AI Coach** — Phases 27-30 (shipped 2026-03-20)

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

<details>
<summary>✅ v1.7 Conversational AI Coach — SHIPPED 2026-03-20</summary>

- [x] **Phase 27: Chat Interface Foundation** — Chat UI, message history, input field, typing indicator ✅ (completed 2026-03-20)
- [x] **Phase 28: Natural Language Processing** — Intent recognition, card analysis, win condition identification ✅ (completed 2026-03-20)
- [x] **Phase 29: Context Management** — Deck loading, conversation history, session persistence ✅ (completed 2026-03-20)
      **Plans:**
  - [x] 29-01-PLAN.md — Deck-specific chat history and context management ✅
- [x] **Phase 30: AI Flow Integration** — Genkit flow, streaming responses, error handling ✅ (completed 2026-03-20)

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

### Phase 21: Pre-commit Hooks Setup

**Goal**: Configure Husky and lint-staged for automated code quality checks

**Depends on**: Phase 20 (existing features)

**Requirements**: REQ-001

**Success Criteria** (what must be TRUE):

1. Husky is installed and configured with Git hooks
2. Pre-commit hook runs linting on staged files
3. Pre-commit hook runs type checking
4. Hooks can be bypassed when needed (--no-verify)

**Plans**: 4 plans (planned)

---

### Phase 22: Coverage Infrastructure

**Goal**: Set up code coverage tracking with threshold enforcement

**Depends on**: Phase 21

**Requirements**: REQ-002

**Success Criteria** (what must be TRUE):

1. Coverage is measured for all test runs
2. Coverage reports are generated in CI
3. Coverage thresholds are enforced (80% for lines/branches)
4. Coverage badges can be generated

**Plans**: 1 plan ✅

---

### Phase 23: Test Utilities Library

**Goal**: Create reusable test utilities for consistent, maintainable tests

**Depends on**: Phase 22

**Requirements**: REQ-003

**Success Criteria** (what must be TRUE):

1. Test utilities library exists at @/test-utils
2. Common mocks are available (fetch, storage, router)
3. Test factories provide consistent test data
4. Documentation explains usage

**Plans**: 1 plan ✅

---

### Phase 24: Integration Test Setup

**Goal**: Configure integration testing environment with Playwright

**Depends on**: Phase 23

**Requirements**: REQ-004

**Success Criteria** (what must be TRUE):

1. Playwright is configured for e2e tests
2. Integration tests can run against dev server
3. Test fixtures are available
4. CI can run integration tests

**Plans**: TBD

---

### Phase 25: CI Quality Gates

**Goal**: Establish CI pipeline with quality checks and enforcement

**Depends on**: Phase 24

**Requirements**: REQ-005

**Success Criteria** (what must be TRUE):

1. CI runs lint, type check, tests, and coverage
2. Quality gates block merges on failure
3. Performance budgets are checked
4. Security scans are integrated

**Plans**: TBD

---

### Phase 26: Test Documentation

**Goal**: Document testing strategy, patterns, and best practices

**Depends on**: Phase 25

**Requirements**: REQ-006

**Success Criteria** (what must be TRUE):

1. Testing guide explains testing patterns
2. API documentation includes testing examples
3. Contributing guide covers test requirements
4. Test coverage goals are documented

**Plans**: TBD

---

### Phase 27: Chat Interface Foundation

**Goal**: Core chat interface for conversational AI coaching - message history, input handling, typing indicators

**Depends on**: Phase 20 (existing deck builder features)

**Requirements**: CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05, CHAT-06

**Success Criteria** (what must be TRUE):

1. Chat interface displays message history with user and AI messages clearly distinguished
2. User can type and send messages via input field
3. Messages are timestamped and displayed in chronological order
4. Typing indicator shows when AI is composing response
5. Chat history persists during session
6. Chat interface is accessible and keyboard-navigable

**Plans**: 1 plan

Plans:

- [ ] 27-01-PLAN.md — Chat Interface Foundation (Core chat UI, message list, input, typing indicator) ⏳

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

| Phase                | Goal                                             | Requirements | Plans Complete | Status      | Completed  |
| -------------------- | ------------------------------------------------ | ------------ | -------------- | ----------- | ---------- |
| 14. Foundation       | Set selection, sealed core, limited deck builder | Complete     | 2026-03-18     | ✅ Complete | 2026-03-18 |
| 15. Draft Core       | 3-pack draft with timer                          | Complete     | 4/4            | ✅ Complete | 2026-03-18 |
| 16. AI Neighbors     | Bot simulation, passing mechanics                | 5            | 6/6            | ✅ Complete | 2026-03-18 |
| 17. Play Integration | Launch AI game with limited deck                 | Complete     | 3/3            | ✅ Complete | 2026-03-18 |
| 18. Meta Analysis    | Meta decks, health score, trends                 | Complete     | 1/1            | ✅ Complete | 2026-03-19 |
| 19. Matchup Guides   | Strategy, matchups, game phases                  | Complete     | 3/3            | ✅ Complete | 2026-03-19 |
| 20. Optimization     | Sideboards, mana curves                          | Complete     | 2/2            | ✅ Complete | 2026-03-19 |
| 28. NLP              | Intent recognition, card analysis, wincons       | Complete     | 1/1            | ✅ Complete | 2026-03-20 |
| 29. Context          | Deck-specific chat history, persistence          | Complete     | 1/1            | ✅ Complete | 2026-03-20 |
| 30. AI Flow Integration | Genkit flow, streaming, error handling         | Complete     | 3/3            | ✅ Complete | 2026-03-20 |
| 27. Chat Interface   | Chat UI, message history, input, typing          | Complete     | 1/1            | ✅ Complete | 2026-03-20 |

---

## v1.6: QA/QC Infrastructure

### Phase 21: Pre-commit Hooks Setup

**Goal**: Automated code quality checks before commits

**Depends on**: v1.5 completion

**Requirements**: REQ-001

**Plans**: TBD

### Phase 22: Coverage Infrastructure

**Goal**: Comprehensive test coverage with CI gates

**Depends on**: Phase 21

**Requirements**: REQ-002

**Plans**: TBD

### Phase 23: Test Utilities Library

**Goal**: Reusable testing helpers and mock implementations

**Depends on**: Phase 22

**Requirements**: REQ-003

**Plans**: TBD

### Phase 24: Integration Test Setup

**Goal**: End-to-end testing infrastructure for critical flows

**Depends on**: Phase 23

**Requirements**: REQ-004

**Plans**: TBD

### Phase 25: CI Quality Gates

**Goal**: Automated quality enforcement in CI pipeline

**Depends on**: Phase 24

**Requirements**: REQ-005

**Plans**: TBD

### Phase 26: Test Documentation

**Goal**: Clear testing guide for contributors

**Depends on**: Phase 25

**Requirements**: REQ-006

**Plans**: TBD

---

## Progress Table

| Phase                | Goal                                             | Requirements | Plans Complete | Status      | Completed  |
| -------------------- | ------------------------------------------------ | ------------ | -------------- | ----------- | ---------- |
| 14. Foundation       | Set selection, sealed core, limited deck builder | Complete     | 2026-03-18     | ✅ Complete | 2026-03-18 |
| 15. Draft Core       | 3-pack draft with timer                          | Complete     | 4/4            | ✅ Complete | 2026-03-18 |
| 16. AI Neighbors     | Bot simulation, passing mechanics                | 5            | 6/6            | ✅ Complete | 2026-03-18 |
| 17. Play Integration | Launch AI game with limited deck                 | Complete     | 3/3            | ✅ Complete | 2026-03-18 |
| 18. Meta Analysis    | Meta decks, health score, trends                 | Complete     | 1/1            | ✅ Complete | 2026-03-19 |
| 19. Matchup Guides   | Strategy, matchups, game phases                  | Complete     | 3/3            | ✅ Complete | 2026-03-19 |
| 20. Optimization     | Sideboards, mana curves                          | Complete     | 2/2            | ✅ Complete | 2026-03-19 |
| 21. Pre-commit Hooks | Husky, lint-staged, quality checks               | Complete     | 4/4            | ✅ Complete | 2026-03-19 |
| 22. Coverage         | Jest thresholds, CI coverage gate                | Complete     | 1/1            | ✅ Complete | 2026-03-19 |
| 23. Test Utils       | @/test-utils, React helpers, mocks               | Complete     | 1/1            | ✅ Complete | 2026-03-19 |
| 24. Integration      | MSW, server action tests, E2E flows              | Complete     | 1/1            | ✅ Complete | 2026-03-19 |
| 25. CI Gates         | Coverage threshold, commit lint, audit           | Complete     | 1/1            | ✅ Complete | 2026-03-19 |
| 26. Test Docs        | TESTING.md, patterns, decision guide             | Complete     | 1/1            | ✅ Complete | 2026-03-19 |
| 27. Chat Interface   | Chat UI, message history, input, typing          | Complete     | 1/1            | ✅ Complete | 2026-03-20 |

---

**Current Status**: ✅ v1.7 Conversational AI Coach COMPLETE — Ready for v1.8 (Performance & Scale)

---

## v1.8: Performance & Scale

### Phase 31: Search Engine Revolution

**Goal**: High-performance local search using Orama and Web Workers

**Depends on**: v1.7 completion

**Requirements**: ORAMA-01, ORAMA-02, ORAMA-03

**Success Criteria** (what must be TRUE):

1. Orama is used for all card collection searching
2. Search indexing and queries run in a Web Worker
3. `useSearchWorker` hook provides reactive search results
4. Search performance is <10ms for 100k+ cards

**Plans**: 2 plans ✅

### Phase 32: Off-Main-Thread Intelligence

**Goal**: Move heuristic AI and deck analysis to Web Workers

**Depends on**: Phase 31

**Requirements**: WORKER-01, WORKER-02, WORKER-03, WORKER-04

**Success Criteria** (what must be TRUE):

1. Heuristic gameplay engine runs in a dedicated Web Worker
2. AI "thinking" does not block UI interactions (60fps maintained)
3. Genkit flows are optimized via selective pre-fetching
4. Non-blocking AI status indicators are implemented

**Plans**: TBD

### Phase 33: High-Performance Rendering

**Goal**: 2D grid virtualization and rendering optimizations

**Depends on**: Phase 32

**Requirements**: REND-01, REND-02, REND-03

**Success Criteria** (what must be TRUE):

1. 2D grid virtualization implemented for card displays
2. CardArt lazy-loading and memory management optimized
3. Main-thread scripting time reduced by 40%
4. React.memo and localized state used effectively

**Plans**: TBD

### Phase 34: Scalable Storage & Backups

**Goal**: Incremental backups and IndexedDB optimization

**Depends on**: Phase 33

**Requirements**: STOR-01, STOR-02, STOR-03

**Success Criteria** (what must be TRUE):

1. Incremental backup/restore logic implemented
2. Client-side compression for large data exports
3. IndexedDB queries and schema audited for performance

**Plans**: TBD

---

## Progress Table

| Phase                | Goal                                             | Requirements | Plans Complete | Status      | Completed  |
| -------------------- | ------------------------------------------------ | ------------ | -------------- | ----------- | ---------- |
| 14. Foundation       | Set selection, sealed core, limited deck builder | Complete     | 2026-03-18     | ✅ Complete | 2026-03-18 |
| 15. Draft Core       | 3-pack draft with timer                          | Complete     | 4/4            | ✅ Complete | 2026-03-18 |
| 16. AI Neighbors     | Bot simulation, passing mechanics                | 5            | 6/6            | ✅ Complete | 2026-03-18 |
| 17. Play Integration | Launch AI game with limited deck                 | Complete     | 3/3            | ✅ Complete | 2026-03-18 |
| 18. Meta Analysis    | Meta decks, health score, trends                 | Complete     | 1/1            | ✅ Complete | 2026-03-19 |
| 19. Matchup Guides   | Strategy, matchups, game phases                  | Complete     | 3/3            | ✅ Complete | 2026-03-19 |
| 20. Optimization     | Sideboards, mana curves                          | Complete     | 2/2            | ✅ Complete | 2026-03-19 |
| 21. Pre-commit Hooks | Husky, lint-staged, quality checks               | Complete     | 4/4            | ✅ Complete | 2026-03-19 |
| 22. Coverage         | Jest thresholds, CI coverage gate                | Complete     | 1/1            | ✅ Complete | 2026-03-19 |
| 23. Test Utils       | @/test-utils, React helpers, mocks               | Complete     | 1/1            | ✅ Complete | 2026-03-19 |
| 24. Integration      | MSW, server action tests, E2E flows              | Complete     | 1/1            | ✅ Complete | 2026-03-19 |
| 25. CI Gates         | Coverage threshold, commit lint, audit           | Complete     | 1/1            | ✅ Complete | 2026-03-19 |
| 26. Test Docs        | TESTING.md, patterns, decision guide             | Complete     | 1/1            | ✅ Complete | 2026-03-19 |
| 27. Chat Interface   | Chat UI, message history, input, typing          | Complete     | 1/1            | ✅ Complete | 2026-03-20 |
| 31. Search Revolution| Orama + Workers background search                | Complete     | 2/2            | ✅ Complete | 2026-03-20 |
| 32. Worker Intel     | Off-main-thread heuristics                       | 3            | 0/0            | 🏗️ In Prog  |            |

---

_For archived milestones, see `.planning/milestones/`_
