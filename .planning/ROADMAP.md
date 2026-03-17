# Planar Nexus — Roadmap (v1.2 AI Intelligence & Advanced Coaching)

## Phases

- [ ] **Phase 6: Multi-Provider LLM & Streaming Infrastructure** - Implement Vercel AI SDK with multi-model support and SSE streaming.
- [ ] **Phase 7: Local Intelligence Foundation** - Integrate Orama and Transformers.js for offline-first RAG and vector search.
- [ ] **Phase 8: AI Deck Assistant UX** - Build proactive card suggestion UI with real-time synergy explanations.
- [ ] **Phase 9: Adaptive Coaching & Player History** - Implement semantic history retrieval and personalized coach reports.
- [ ] **Phase 10: Expert Opponent AI Refinement** - Tune heuristic weights and stack interaction logic for high-level play.

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 6. Multi-Provider LLM & Streaming | 0/0 | Not started | - |
| 7. Local Intelligence Foundation | 0/0 | Not started | - |
| 8. AI Deck Assistant UX | 0/0 | Not started | - |
| 9. Adaptive Coaching & Player History | 0/0 | Not started | - |
| 10. Expert Opponent AI Refinement | 0/0 | Not started | - |

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
**Plans**: TBD

### Phase 9: Adaptive Coaching & Player History
**Goal**: The AI provides personalized advice based on the player's specific gameplay history and improvement over time.
**Depends on**: Phase 7, Phase 8
**Requirements**: REQ-12.1, REQ-12.2
**Success Criteria**:
1. User can view a "Coach Report" that summarizes their win/loss trends and common mistakes.
2. The AI coach references specific past games or similar situations when giving advice.
3. Opponent difficulty automatically suggests adjustments based on the player's recent performance.
**Plans**: TBD

### Phase 10: Expert Opponent AI Refinement
**Goal**: High-level players face a challenging AI that handles complex stack interactions and multi-card synergies.
**Depends on**: Phase 6
**Requirements**: REQ-13.1, REQ-13.2
**Success Criteria**:
1. Expert AI successfully executes complex, multi-target "combos" or interactions defined in its logic.
2. AI makes optimal "stack" decisions (e.g., responding to a player's removal spell with a protection spell).
3. AI combat logic handles complex multi-blocker scenarios without obvious tactical blunders.
**Plans**: TBD
