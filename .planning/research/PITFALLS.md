# Domain Pitfalls: AI Intelligence & Advanced Coaching

**Domain:** AI-Enhanced Tabletop Card Games
**Researched:** 2026-03-18
**Overall Confidence:** HIGH

## Critical Pitfalls

### Pitfall 1: Hallucinating Mechanics
**What goes wrong:** The LLM suggests synergistic cards that don't exist or misinterprets card rules (e.g., suggesting a card that only works in Commander for a Standard deck).
**Prevention:**
1.  **Strict Context**: Always include the card's Oracle text and current deck format in the prompt.
2.  **Tool Use (MCP)**: Use the AI to query the card database (Orama) for *real* cards rather than letting it "remember" cards.
3.  **Format Validation**: Use the existing v1.0 deck builder's validation logic to "double-check" AI suggestions.

### Pitfall 2: High Latency & User Frustration
**What goes wrong:** Waiting for the LLM to process complex synergy analysis makes the deck-building feel sluggish.
**Prevention:**
1.  **Streaming**: Use the Vercel AI SDK to stream responses immediately.
2.  **Speculative UI**: Show local (Orama-based) search results instantly, then "enrich" them with AI analysis as the stream arrives.
3.  **Local RAG**: Perform most synergy calculations locally; use the LLM only for high-level reasoning.

### Pitfall 3: Browser Resource Exhaustion (WASM/WebGPU)
**What goes wrong:** Running `Transformers.js` to generate embeddings for a 25,000-card database crashes the browser tab or freezes the OS.
**Prevention:**
1.  **Background Workers**: Always run embeddings in a Web Worker or Tauri background task.
2.  **Batching**: Index cards in small batches (e.g., 500 at a time) and provide a progress bar.
3.  **Storage**: Persist embeddings in IndexedDB so they only need to be generated once.

## Moderate Pitfalls

### Pitfall 1: "Lazy" Coaching
**What goes wrong:** The adaptive coach becomes repetitive, giving the same generic advice ("Play more lands") without depth.
**Prevention:**
1.  **History Context**: Use RAG to fetch the *variety* of player games, not just the most recent ones.
2.  **Persona Tuning**: Use different system prompts for different coaches (e.g., "The Pro Player" vs. "The Casual Fun-Seeker").

### Pitfall 2: Token Window Overflow
**What goes wrong:** Including too much player history in the prompt causes the LLM to cut off or lose track of instructions.
**Prevention:**
1.  **Summarization**: Periodically summarize player history into "Learned Traits" rather than raw game logs.
2.  **Reranking**: Use Orama's reranking capabilities to only send the *highest-relevance* snippets.

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| **LLM Integration** | API Rate Limiting | Implement exponential backoff in the AI Proxy. |
| **Deck Assistant** | Irrelevant Suggestions | Fine-tune the Orama hybrid search weights (Text vs. Vector). |
| **Adaptive Coach** | Privacy Concerns | Ensure all player history remains local (IndexedDB) and only minimal context is sent to the LLM. |

## Sources
- [LLM Pitfalls in Game Design](https://gamasutra.com/ai-pitfalls) (MEDIUM)
- [IndexedDB Performance Best Practices](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Best_practices) (HIGH)
- [Vercel AI SDK - Token Management](https://sdk.vercel.ai/docs/guides/token-management) (HIGH)
