# Planar Nexus — v1.2 Requirements (AI Intelligence & Advanced Coaching)

**Milestone:** v1.2  
**Goal**: Build a comprehensive AI-powered card game experience with advanced coaching and adaptive opponents.

---

## REQ-9: Core AI Infrastructure (Advanced LLM)

### REQ-9.1: Multi-Provider Support
- [ ] Integrate Vercel AI SDK v6.0+
- [ ] Support OpenAI, Anthropic, and Google Gemini models
- [ ] Implement provider-switching logic in the existing AI proxy

### REQ-9.2: Streaming Infrastructure
- [ ] Enable Server-Sent Events (SSE) for all LLM responses
- [ ] Add streaming support to the frontend `useChat` hook
- [ ] Ensure proper chunk normalization for multiple providers

### REQ-9.3: MCP Bridge Implementation
- [ ] Implement Model Context Protocol (MCP) for standard tool access
- [ ] Expose card database search to LLM via MCP
- [ ] Expose player history retrieval to LLM via MCP

---

## REQ-10: Local Intelligence & RAG Foundation

### REQ-10.1: Orama Hybrid Search
- [ ] Integrate Orama v3+ for local vector search
- [ ] Implement hybrid search (vector similarity + keyword filters)
- [ ] Index existing card database into Orama on first run

### REQ-10.2: Transformers.js Workers
- [ ] Implement Web Workers/Tauri background tasks for vectorization
- [ ] Use `@huggingface/transformers` for local embedding generation
- [ ] Support WebGPU acceleration where available

### REQ-10.3: Dexie.js History Store
- [ ] Implement Dexie.js for robust IndexedDB history tracking
- [ ] Store structured game logs, player decisions, and AI advice
- [ ] Persist card embeddings in Dexie for zero-recalc on reload

---

## REQ-11: AI Deck Assistant UX

### REQ-11.1: Proactive Suggestions
- [ ] Real-time card suggestions while building a deck
- [ ] Leverage Orama synergy search to find complementary cards
- [ ] Highlight synergistic cards in the card browser

### REQ-11.2: AI Explication UI
- [ ] Add "Why this card?" button to suggested cards
- [ ] Stream brief LLM-based analysis of the card's synergy
- [ ] Display synergy score and confidence level

---

## REQ-12: Adaptive Coaching & Player History

### REQ-12.1: Semantic History Retrieval
- [ ] Fetch relevant past game mistakes/successes using Orama
- [ ] Inject history snippets into LLM prompt for personalized advice
- [ ] Summarize long-term player trends to avoid context overflow

### REQ-12.2: Personalized Coach UI
- [ ] Coach report section highlighting improvements over time
- [ ] "Review My Past Mistakes" interactive section
- [ ] Adaptive difficulty adjustment based on win/loss history

---

## REQ-13: Improved Opponent AI Tuning

### REQ-13.1: Expert Decision Engine
- [ ] Refine heuristic weights for expert difficulty
- [ ] Implement look-ahead for complex card interactions
- [ ] Improve stack interaction AI for responding to player spells

### REQ-13.2: Interaction Support
- [ ] Support more complex card mechanics in the decision tree
- [ ] Handle multi-target spells and variable cost abilities
- [ ] Refine combat AI for multi-blocker scenarios

---

## Technical Requirements

### REQ-T5: AI Performance
- [ ] Streaming response initial chunk in <500ms
- [ ] Local synergy search returns in <50ms
- [ ] Vectorization worker consumes <20% CPU during background indexing

### REQ-T6: Offline-First Reliability
- [ ] Heuristic coach remains available when offline
- [ ] Orama/Transformers.js features work fully without network
- [ ] Graceful fallback for LLM-based features during API outages

---

## Future Requirements

- **REQ-6**: Custom Card Creation Studio Foundation (v1.3)
- **REQ-7**: WYSIWYG Card Editor (v1.3)
- **REQ-8**: Custom Card Integration (v1.3)
- **REQ-14**: Multiplayer Matchmaking (v2.0)
- **REQ-15**: Achievement System (v2.0)

---

## Out of Scope (v1.2)

- Server-side vector storage (Client-side/Orama only)
- Real-time voice coaching
- Cloud sync for history (Local/Dexie only)

---

## Requirements Traceability

| Requirement | Status | Phase | Plans |
|-------------|--------|-------|-------|
| REQ-9: AI Infra | ⚪ Pending | Phase 6 | - |
| REQ-10: Local Intel | ⚪ Pending | Phase 7 | - |
| REQ-11: Deck Assistant | ⚪ Pending | Phase 8 | - |
| REQ-12: Adaptive Coaching | ⚪ Pending | Phase 9 | - |
| REQ-13: Opponent AI | ⚪ Pending | Phase 10 | - |
| REQ-T: Technical | ⚪ Pending | P6/P7 | - |

---

**Last Updated**: 2026-03-18 for v1.2 roadmap initialization
