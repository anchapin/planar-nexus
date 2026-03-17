# Technology Stack: AI Intelligence & Advanced Coaching

**Project:** Planar Nexus (v1.2)
**Researched:** 2026-03-18
**Overall Confidence:** HIGH

## Recommended Stack

For the v1.2 milestone, the stack is expanded to support advanced LLM orchestration, local vector search (RAG), and adaptive coaching history while maintaining the offline-first, client-side nature of the application.

### Core AI Infrastructure
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **Vercel AI SDK** | `^6.0.0` | LLM Orchestration & Streaming | Unified API for OpenAI, Anthropic, and Google Gemini. First-class React 19 / Next.js 15 support. |
| **Model Context Protocol (MCP)** | `Standard` | AI Integration Layer | Standardizes how LLMs interact with the local Card Database and Player History. |
| **AI Proxy** | `Existing` | API Security & Relay | Manages provider keys and provides an SSE endpoint for streaming responses to the client. |

### Local Intelligence & RAG
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **Orama** | `^3.0.0` | Local Vector & Hybrid Search | Blazing fast local search for card synergies and coaching history. Built-in RAG and MCP support. |
| **@huggingface/transformers** | `^3.8.0` | Local Embeddings | Generates vector embeddings for card text and game logs directly in the browser/Tauri (WebGPU support). |
| **Dexie.js** | `^4.0.0` | Persistent Game Logs | Robust IndexedDB wrapper for storing structured player history, game states, and learned patterns. |

### Infrastructure & Desktop
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **Tauri 2.0** | `^2.x` | Desktop Distribution | Lightweight wrapper with IPC Channels for streaming data between Rust (background logic) and Frontend. |
| **Server-Sent Events (SSE)** | `Standard` | Response Streaming | Lightweight, one-way streaming standard for LLM responses through the AI Proxy. |

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| **LLM SDK** | Vercel AI SDK | LangChain.js | LangChain is more verbose and has a larger bundle size; Vercel SDK is optimized for Next.js 15. |
| **Vector DB** | Orama | LanceDB (WASM) | Orama is easier to integrate with React and has better hybrid search (text + vector) for card queries. |
| **Embeddings** | Transformers.js | Remote Embeddings | Remote embeddings break the "Offline-First" principle and add latency/cost for simple card searches. |
| **Streaming** | SSE | WebSockets | WebSockets are overkill for one-way LLM streaming and harder to manage through standard proxies. |

## Installation

```bash
# Core AI & UI
npm install ai @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google

# Local Search & Vectorization
npm install @orama/core @orama/plugin-embeddings @huggingface/transformers dexie dexie-react-hooks

# Developer Tools
npm install -D @ai-sdk/devtools
```

## Integration Points

### 1. Advanced LLM Streaming (SSE)
The frontend uses the `useChat` hook from Vercel AI SDK v6, pointing to the AI Proxy. The proxy relays the stream from the provider using Server-Sent Events (SSE).
- **Client**: `fetch(proxy_url, { stream: true })`
- **Tauri**: Can also use `tauri::ipc::Channel` if processing requires Rust-side intervention (e.g., complex deck validation during streaming).

### 2. AI Deck Assistant (Local RAG)
1. **Indexing**: On first run or card import, `@huggingface/transformers` generates embeddings for all cards.
2. **Storage**: Embeddings are stored in **Orama**.
3. **Synergy Search**: When building a deck, the assistant performs a hybrid search (vector similarity to current cards + keyword filters) to suggest additions.

### 3. Adaptive Coaching (History Learning)
1. **Tracking**: **Dexie.js** logs every game action and AI coaching interaction.
2. **Indexing**: Coaching outcomes are indexed in **Orama** for semantic retrieval.
3. **Context Injection**: When a player asks for advice, relevant past mistakes/successes are retrieved from Orama and injected into the LLM prompt via **MCP**.

## Sources
- [Vercel AI SDK v6 Documentation](https://sdk.vercel.ai/docs) (HIGH)
- [Orama v3 Answer Engine Features](https://orama.com/blog) (HIGH)
- [Hugging Face Transformers.js v3/v4 Release Notes](https://huggingface.co/docs/transformers.js) (HIGH)
- [Tauri 2.0 IPC Documentation](https://v2.tauri.app/reference/ipc/) (HIGH)
- [Model Context Protocol (MCP) Specification](https://modelcontextprotocol.io/) (MEDIUM)
