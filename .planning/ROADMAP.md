# Planar Nexus — Roadmap (v1.3 Deck Builder UX Enhancements)

## Phases

- [x] **Phase 11: Search & Filter Infrastructure** — Core search, filters, fuzzy matching, sorting
- [x] **Phase 12: Saved Searches & Statistics** — Search presets, deck analytics (completed 2026-03-18)
- [x] **Phase 13: Quick-Add & Performance** — Keyboard shortcuts, one-click add, performance tuning (completed 2026-03-18)

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 6. Multi-Provider LLM & Streaming | 5/5 | Completed | 2026-03-17 |
| 7. Local Intelligence Foundation | 5/5 | Completed | 2026-03-17 |
| 8. AI Deck Assistant UX | 3/3 | Completed | 2026-03-17 |
| 9. Adaptive Coaching & Player History | 5/5 | Completed | 2026-03-17 |
| 10. Expert Opponent AI Refinement | 3/3 | Complete   | 2026-03-17 |
| 11. Search & Filter Infrastructure | 4/4 | Complete    | 2026-03-18 |
| 12. Saved Searches & Statistics | 3/5 | Complete    | 2026-03-18 |
| 13. Quick-Add & Performance | 3/3 | Complete   | 2026-03-18 |

## Phase Details

### Phase 6: Multi-Provider LLM & Streaming Infrastructure
**Goal**: Users experience near-instant, reliable AI responses from their preferred provider.
**Depends on**: Phase 5 (v1.1 Completion)
**Requirements**: REQ-9.1, REQ-9.2, REQ-9.3, REQ-T6
**Success Criteria**:
1. User can switch between OpenAI, Anthropic, and Google Gemini in settings and receive responses from the selected provider.
2. AI responses begin appearing in the UI within 500ms of the request (streaming).
3. AI Coach functions in basic heuristic mode when the user is offline or the API is unavailable.
4. The AI can answer questions about specific cards by searching the local database (via MCP bridge).
**Plans**: TBD

### Phase 7: Local Intelligence Foundation
**Goal**: The application has a high-performance local search and embedding engine that understands card synergies.
**Depends on**: Phase 6
**Requirements**: REQ-10.1, REQ-10.2, REQ-10.3, REQ-T5
**Success Criteria**:
1. Card database is indexed into Orama on first launch with no visible UI lag (background worker).
2. Local vector search for "synergistic cards" returns results in less than 50ms.
3. Player history and generated embeddings persist across sessions via Dexie.js.
4. Vectorization process consumes less than 20% CPU on average during initial indexing.
**Plans**: TBD

### Phase 8: AI Deck Assistant UX
**Goal**: Users receive helpful, real-time card suggestions that explain why they fit the current deck.
**Depends on**: Phase 7
**Requirements**: REQ-11.1, REQ-11.2
**Success Criteria**:
1. User sees a list of suggested cards that update in real-time as they add cards to their deck.
2. User can click "Why this card?" and see a brief, streamed explanation of the synergy.
3. Synergistic cards are visually highlighted in the main card browser when a deck is being edited.

**Plans**:
- [ ] 08-01-PLAN.md — Synergy Infrastructure & State (Vectorization bridge)
- [ ] 08-02-PLAN.md — AI Assistant UI & Streaming Explanations
- [ ] 08-03-PLAN.md — Search Integration & E2E Verification

### Phase 9: Adaptive Coaching & Player History
**Goal**: The AI provides personalized advice based on the player's specific gameplay history and improvement over time.
**Depends on**: Phase 7, Phase 8
**Requirements**: REQ-12.1, REQ-12.2
**Success Criteria**:
1. User can view a "Coach Report" that summarizes their win/loss trends and common mistakes.
2. The AI coach references specific past games or similar situations when giving advice.
3. Opponent difficulty automatically suggests adjustments based on the player's recent performance.
**Plans**:
- [x] 09-01-PLAN.md — Game History Infrastructure & Migration (COMPLETED)
- [x] 09-02-PLAN.md — Gameplay Integration & Persistence (COMPLETED)
- [x] 09-03-PLAN.md — Semantic History & AI Coach Tools (COMPLETED)
- [x] 09-04-PLAN.md — Coach Report Service Integration (COMPLETED)
- [ ] 09-05-PLAN.md — Gap Closure: IndexedDB Integration (PENDING)

### Phase 10: Expert Opponent AI Refinement
**Goal**: High-level players face a challenging AI that handles complex stack interactions and multi-card synergies.
**Depends on**: Phase 6
**Requirements**: REQ-13.1, REQ-13.2
**Success Criteria**:
1. Expert AI successfully executes complex, multi-target "combos" or interactions defined in its logic.
2. AI makes optimal "stack" decisions (e.g., responding to a player's removal spell with a protection spell).
3. AI combat logic handles complex multi-blocker scenarios without obvious tactical blunders.
**Plans**:
- [ ] 10-01-PLAN.md — Expert Stack Interaction Weights & Lookahead Implementation
- [ ] 10-02-PLAN.md — Multi-Target & Variable Cost Handling
- [ ] 10-03-PLAN.md — Combat AI Multi-Blocker Refinement

---

### Phase 11: Search & Filter Infrastructure
**Goal**: Users can find cards using advanced multi-attribute filters with fuzzy matching and flexible sorting

**Depends on**: Phase 10 (v1.2 Completion)

**Requirements**: SEARCH-01, SEARCH-02, SEARCH-03, SEARCH-04, FUZZY-01, FUZZY-02, FUZZY-03, SORT-01, SORT-02

**Success Criteria** (what must be TRUE):
1. User can filter cards by CMC (exact or range), card type, rarity, and set
2. User can filter cards by color identity and Commander color identity rules
3. User can filter creatures by power and toughness ranges
4. User can filter by format legality (Standard, Modern, Commander, etc.)
5. User can search card names with typo tolerance (Levenshtein distance <= 2)
6. User can find cards using partial word matches in name and text
7. User can sort search results by CMC, color, type, rarity, set, name, or power/toughness
8. User's preferred sort order persists across browser sessions

**Plans**:
- [x] 11-01-PLAN.md — Core Filter Infrastructure (CMC, type, rarity, set)
- [x] 11-02-PLAN.md — Advanced Filters (color identity, P/T, format legality)
- [x] 11-03-PLAN.md — Fuzzy Search & Sorting (Levenshtein, partial, synonyms, persistence)
- [x] 11-04-PLAN.md — Gap Closure: UI Integration (useCardFilters wiring)

---

### Phase 12: Saved Searches & Statistics
**Goal**: Users can save filter presets for quick access and view deck analytics

**Depends on**: Phase 11

**Requirements**: SAVED-01, SAVED-02, STATS-01, STATS-02, STATS-03

**Success Criteria** (what must be TRUE):
1. User can save current filter configuration as a named preset
2. User can load saved presets from a dropdown menu
3. User can delete saved presets
4. User can access built-in quick presets (e.g., "Creatures under 3 mana")
5. User can view a mana curve bar chart for their deck
6. User can view card type breakdown as a chart with counts and percentages
7. User can view color distribution visualization for their deck
8. Presets persist in IndexedDB across sessions

**Plans**:
- [x] 12-01-PLAN.md — Search Presets (IndexedDB storage, save/load/delete) (COMPLETED)
- [x] 12-02-PLAN.md — Quick Access Presets (built-in filter presets) (COMPLETED)
- [ ] 12-03-PLAN.md — Deck Statistics (mana curve, type breakdown, color distribution)

---

### Phase 13: Quick-Add & Performance
**Goal**: Users can rapidly add cards with minimal clicks and experience responsive performance

**Depends on**: Phase 12

**Requirements**: QUICK-01, QUICK-02, REQ-T7, REQ-T8

**Success Criteria** (what must be TRUE):
1. User can press Enter to add highlighted card from search to deck
2. User can use arrow keys to navigate through search results
3. User can click a card to add it directly to deck
4. User can Shift+Click to add 4-of (maximum allowed)
5. Visual feedback appears when a card is added (flash/highlight)
6. Search results appear in under 100ms for local database
7. Filter changes update UI in under 50ms
8. Scrolling through 100+ results is smooth without jank

**Plans**: 
- [x] 13-01-PLAN.md — Keyboard Navigation (Enter-to-add, arrow keys) (COMPLETED)
- [ ] 13-02-PLAN.md — Shift+Click & Visual Feedback
- [ ] 13-03-PLAN.md — Performance & Virtual Scrolling
