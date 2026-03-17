# Research Summary: Planar Nexus (v1.2 AI Intelligence & Advanced Coaching)

**Domain:** AI-Enhanced Tabletop Card Games
**Researched:** 2026-03-18
**Overall confidence:** HIGH

## Executive Summary

To support the v1.2 milestone (Advanced LLM integration, AI Deck Assistant, and Adaptive Coaching) while maintaining Planar Nexus's offline-first and client-side principles, we need to introduce a Local-First RAG (Retrieval-Augmented Generation) architecture. 

The core addition to the stack is the **Vercel AI SDK (v6.0+)**, which provides seamless multi-provider streaming (via SSE) and integrates perfectly with Next.js 15 Server Actions. For the AI Deck Assistant and Adaptive Coaching to work without a server-side database, we must implement local vector search. **Orama (v3+)** is the ideal choice for its high-performance hybrid search (text + vector) and built-in RAG/MCP capabilities, combined with **Transformers.js (v4/v3.8)** to generate vector embeddings directly in the browser or Tauri desktop app using WebGPU. Finally, **Dexie.js** provides the necessary robust wrapper around IndexedDB to store the generated embeddings and the player's structured game history for the adaptive coach.

## Key Findings

**Stack:** Vercel AI SDK v6 (LLM/Streaming), Orama (Local Vector Search), Transformers.js (Local Embeddings), Dexie.js (History Storage).
**Architecture:** Local-First RAG — embeddings generated/searched locally (Transformers.js + Orama), with only highly relevant context sent to the LLM via SSE streaming.
**Critical pitfall:** Browser Resource Exhaustion — running Transformers.js on 25,000 cards on the main thread will crash the app; it MUST be offloaded to Web Workers or Tauri background tasks.

## Implications for Roadmap

Based on research, suggested phase structure:

1. **Phase 1: Multi-Provider LLM & Streaming Infrastructure** - Upgrades the existing proxy and frontend to use Vercel AI SDK and SSE.
   - Addresses: Multi-provider support, streaming responses.
   - Avoids: High latency and token window overflow.

2. **Phase 2: Local Intelligence (Embeddings & Search)** - Implements Transformers.js workers and Orama for the card database.
   - Addresses: Offline-first RAG, Card Synergy Analysis.
   - Avoids: Browser UI thread blocking during vectorization.

3. **Phase 3: AI Deck Assistant** - Builds the UX for real-time deck suggestions using the local intelligence layer.
   - Addresses: Proactive card suggestions.

4. **Phase 4: Adaptive Coaching & History** - Implements Dexie.js for game logging and feeds it into the LLM context.
   - Addresses: Personalized coaching based on past mistakes.
   - Avoids: "Lazy" or generic coaching advice.

**Phase ordering rationale:**
- Infrastructure (Streaming) must come first to support the UX. Local intelligence (Embeddings/Search) must be built before the Deck Assistant or Adaptive Coach can use it. History tracking requires the longest time to accumulate data, so it comes last or runs parallel to the assistant.

**Research flags for phases:**
- Phase 2: Likely needs deeper research into Tauri background task performance vs Web Workers for Transformers.js WebGPU execution.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified with latest docs for Vercel AI SDK, Orama, and Transformers.js. |
| Features | HIGH | Standard AI integration patterns aligned with project principles. |
| Architecture | HIGH | Local-first RAG is well-documented and supported by chosen tools. |
| Pitfalls | HIGH | Common issues with WASM/WebGPU and LLM context windows. |

## Gaps to Address

- **MCP Integration Depth**: The Model Context Protocol (MCP) is relatively new. While Orama supports it, deep integration with custom Dexie stores may require a custom MCP server implementation within the Tauri Rust backend.
