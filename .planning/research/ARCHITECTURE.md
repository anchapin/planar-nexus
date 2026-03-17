# Architecture Patterns: AI Intelligence & Advanced Coaching

**Domain:** AI-Enhanced Tabletop Card Games (Client-Side)
**Researched:** 2026-03-18
**Overall Confidence:** HIGH

## Recommended Architecture: Local-First RAG

The advanced AI features follow a **Local-First RAG (Retrieval-Augmented Generation)** pattern. This preserves user privacy, ensures offline functionality for search, and reduces token costs by only sending relevant context to the LLM.

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| **AI Controller** | Orchestrates LLM calls, tools, and streaming. | Vercel AI SDK, AI Proxy |
| **Card Index (Orama)** | Local vector search for card synergies. | Deck Assistant, Transformers.js |
| **History Store (Dexie)** | Persistent storage of player games and AI logs. | AI Controller, Adaptive Coach |
| **AI Proxy** | Securely relays LLM requests to providers. | AI Controller, OpenAI/Anthropic/Google |
| **MCP Bridge** | (Optional) Standardizes tool access for the LLM. | AI Controller, Orama, Dexie |

### Data Flow: AI Deck Assistant

1.  **Card Selection**: Player adds a card to the deck.
2.  **Vectorization**: `Transformers.js` generates an embedding for the card's effect text (in a background worker).
3.  **Search**: `Orama` performs a hybrid search (semantic vector similarity + keyword matching) against the local card database.
4.  **Rank & Suggest**: The top synergistic cards are displayed as suggestions.
5.  **Explication**: If the player clicks "Why?", the `AI Controller` sends the current deck context and the candidate card to the LLM for a brief analysis.

## Patterns to Follow

### Pattern 1: Streaming Server Actions (Next.js 15)
Use Next.js 15 Server Actions to handle LLM calls through the AI SDK. This allows streaming directly from the server-side proxy relay to the client.
```typescript
// src/app/actions/ai.ts
'use server';
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';

export async function chatAction(prompt: string) {
  const result = await streamText({
    model: openai('gpt-4o'),
    prompt,
  });
  return result.toDataStreamResponse();
}
```

### Pattern 2: Local Embedding Worker
Generating embeddings can block the UI thread. Use a Web Worker or a Tauri background task to handle `Transformers.js` operations.
```typescript
// src/lib/ai/worker.ts
import { pipeline } from '@huggingface/transformers';

let embedder;
onmessage = async (e) => {
  if (!embedder) embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  const output = await embedder(e.data.text, { pooling: 'mean', normalize: true });
  postMessage({ id: e.data.id, embedding: Array.from(output.data) });
};
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Prompt Stuffing (The "Naïve" Context)
**What:** Sending the entire card database or all player history in every prompt.
**Why bad:** High token costs, latency, and context window overflow.
**Instead:** Use RAG via Orama to select only the top 5-10 relevant pieces of context.

### Anti-Pattern 2: Synchronous Local Search
**What:** Running heavy vector searches on the main UI thread.
**Why bad:** Janky UI during deck building.
**Instead:** Use `Orama`'s built-in asynchronous methods or run in a worker.

## Scalability Considerations

| Concern | 100 Cards | 25K Cards (MTG Scale) |
|---------|------------|-----------------------|
| **Search Latency** | < 1ms | ~10-20ms (Orama handles well) |
| **Initial Indexing** | ~2s | ~60-120s (needs progress bar) |
| **Storage (IndexedDB)**| ~1MB | ~50-100MB (Orama compression helps) |

## Sources
- [Vercel AI SDK - RAG Patterns](https://sdk.vercel.ai/docs/guides/rag) (HIGH)
- [Orama Performance Benchmarks](https://orama.com/docs/benchmarks) (HIGH)
- [Hugging Face JS - Performance Guide](https://huggingface.co/docs/transformers.js/performance) (HIGH)
