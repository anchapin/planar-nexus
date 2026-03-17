# Feature Landscape: AI Intelligence & Advanced Coaching

**Domain:** AI-Enhanced Tabletop Card Games
**Researched:** 2026-03-18
**Overall Confidence:** HIGH

## Table Stakes
Features users expect from an "Advanced AI" update in 2026.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Multi-Provider LLM** | Users want choice (OpenAI vs Anthropic) for cost/quality. | Medium | Requires unified SDK (Vercel AI SDK). |
| **Streaming Responses** | Immediate feedback; users won't wait 10s for full response. | Medium | Requires SSE support in proxy and frontend. |
| **Card Synergy Analysis** | Basic understanding of card mechanics for advice. | High | Requires local RAG or complex prompting. |
| **Adaptive Difficulty** | AI opponent that adjusts to player's skill level. | Medium | Uses player history and game win/loss rates. |

## Differentiators
Features that set Planar Nexus apart from other deck builders.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **AI Deck Assistant** | Real-time card suggestions while building based on synergies. | High | Uses Orama hybrid search + Local Embeddings. |
| **Personalized Coach** | AI remembers past games and focuses advice on player's weak points. | High | Requires long-term memory via Dexie + RAG. |
| **Spectator Commentary** | (Existing) but enhanced with specific player history context. | Medium | "You're playing like you did in the 2025 regionals..." |
| **Offline-First RAG** | AI suggestions work even when disconnected (via local embeddings). | High | Unique differentiator for mobile/privacy-conscious users. |

## Anti-Features
Features to explicitly NOT build to maintain project principles.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Server-side Vector DB** | Violates privacy-first / client-side principle. | Use Orama (local browser/Tauri DB). |
| **Subscription Accounts** | Contrary to "no accounts required" principle. | Local-only profile stored in IndexedDB. |
| **Real-time Voice** | Excessive bandwidth and implementation cost for MVP. | Stick to high-quality text streaming. |

## Feature Dependencies

```
Local Embeddings (Transformers.js) → Card Synergy Search (Orama) → AI Deck Assistant
Game Logs (Dexie.js) → Player History Analysis → Adaptive Coaching
```

## MVP Recommendation

Prioritize:
1. **Multi-provider LLM Integration**: Fast win using Vercel AI SDK.
2. **AI Deck Assistant (Synergy Search)**: Core value for deck builders.
3. **Adaptive Coaching (Basic History)**: Start by tracking the last 5 games.

Defer:
- **Full MCP Server Implementation**: Can start with direct integration and move to MCP later.
- **Deep Spectator Commentary History**: Focus on the active player first.

## Sources
- [Planar Nexus PROJECT.md](https://github.com/alex/planar-nexus)
- [Hearthstone AI Patterns](https://github.com/topics/hearthstone-ai)
- [MTG Meta Analysis Tools](https://mtggoldfish.com)
