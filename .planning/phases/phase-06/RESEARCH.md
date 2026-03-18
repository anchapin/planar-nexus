# Phase 6: Multi-Provider LLM & Streaming Infrastructure - Research

**Researched:** 2026-03-18
**Domain:** AI Infrastructure & Model Context Protocol (MCP)
**Confidence:** HIGH

## Summary
The current AI infrastructure in Planar Nexus uses a custom server-side proxy (`/api/ai-proxy`) that supports OpenAI, Google (Gemini), and Zaic. It already implements basic SSE streaming but lacks a unified interface. The AI Coach currently relies on a heuristic fallback system for offline use. Integrating Vercel AI SDK v4+ (referenced as v6.0+ in requirements) will unify these providers, simplify streaming, and provide a robust framework for tool-calling via MCP.

**Primary recommendation:** Replace the manual proxy logic in `POST /api/ai-proxy` with Vercel AI SDK's `streamText` and `createDataStreamResponse` to handle multi-provider normalization and SSE.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ai` (Vercel AI SDK) | ^4.1.0 | Unified LLM API | Industry standard for Next.js AI apps |
| `@ai-sdk/openai` | ^1.1.0 | OpenAI Provider | Official adapter |
| `@ai-sdk/anthropic` | ^1.1.0 | Anthropic Provider | Official adapter |
| `@ai-sdk/google` | ^1.1.0 | Google AI Provider | Official adapter |
| `@modelcontextprotocol/sdk` | ^1.0.0 | MCP Protocol | Standard for tool interop |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|--------------|
| `zod` | ^3.24.0 | Schema Validation | Defining tool parameters for LLMs |

## Architecture Patterns

### Recommended Project Structure
```
src/
├── ai/
│   ├── providers/     # Vercel AI SDK provider configurations
│   ├── tools/         # MCP-compliant tool definitions
│   └── mcp-server.ts  # MCP Bridge implementation
├── app/api/chat/      # Unified streaming endpoint
└── hooks/             # Frontend useChat integration
```

### MCP Bridge Pattern
The MCP bridge will expose the local card database as a tool to the LLM. 
1. **Server**: Implement a local MCP server that wraps `src/lib/server-card-operations.ts`.
2. **Client**: The Vercel AI SDK will act as the MCP client, calling these tools during `streamText`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SSE normalization | Custom buffer logic | `createDataStreamResponse` | Handles edge cases, protocol headers, and "DONE" signals |
| Multi-provider mapping | Custom switch statements | AI SDK Providers | Standardizes message formats and usage stats |
| Tool calling | Custom function parsing | AI SDK `tools` | Automated schema generation and execution |

## Common Pitfalls

### Pitfall 1: Streaming Proxy Buffering
**What goes wrong:** Next.js or Vercel edge functions may buffer the response, causing a delay until the full message is ready.
**How to avoid:** Ensure `dynamic = 'force-dynamic'` and use `createDataStreamResponse`.

### Pitfall 2: MCP Tool Latency
**What goes wrong:** Calling a local card database search for every token/chunk.
**How to avoid:** Use tool-calling only when the LLM explicitly requests it (standard AI SDK behavior).

## Code Examples

### Unified Streaming Backend
```typescript
import { openai } from '@ai-sdk/openai';
import { streamText, createDataStreamResponse } from 'ai';

export async function POST(req: Request) {
  const { messages, provider } = await req.json();
  const result = await streamText({
    model: getModel(provider),
    messages,
    tools: {
      searchCards: {
        description: 'Search the Magic card database',
        parameters: z.object({ query: z.string() }),
        execute: async ({ query }) => searchLocalDatabase(query),
      },
    },
  });
  return createDataStreamResponse(result);
}
```

## Validation Architecture
- **Framework**: Vitest (preferred for Next.js 15)
- **Gap**: Current tests for AI are mostly validation-based. Need E2E streaming tests using Playwright to ensure SSE chunks are received correctly.

---

### Key Findings
1.  **Existing Proxy**: The proxy at `src/app/api/ai-proxy/route.ts` is robust but uses a custom "manual" streaming implementation that should be migrated to Vercel AI SDK for better maintainability.
2.  **AI Coach**: The heuristic mode in `src/ai/flows/ai-deck-coach-review.ts` provides a perfect fallback for "Offline-First" requirements (REQ-T6).
3.  **MCP Readiness**: The local card database operations are already isolated in `lib/`, making them easy to wrap as MCP tools.

### Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | Vercel AI SDK is the direct answer to REQ-9.1. |
| Architecture | MEDIUM | MCP implementation details vary; standardizing on the AI SDK's tool protocol is safest. |
| Pitfalls | HIGH | Buffer issues are common in Next.js streaming. |

### Open Questions
1.  **Vercel AI SDK v6.0**: The latest stable is v4.x. I assume the user meant "latest version" or a specific future-proofed implementation.
2.  **MCP Transport**: Should the MCP bridge use stdio or HTTP? Recommendation: HTTP/SSE for a web app context.
