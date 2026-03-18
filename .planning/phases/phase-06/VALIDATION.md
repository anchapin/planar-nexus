# Phase 6: Multi-Provider LLM & Streaming Infrastructure - Validation Architecture

**Phase:** 6
**Goal:** Users experience near-instant, reliable AI responses from their preferred provider.
**Date:** 2026-03-18

## Verification Strategy

### Layer 1: Unit & Integration (Vitest)
- **AI Factory**: Test `getAIModel` with all supported providers (OpenAI, Anthropic, Google).
- **MCP Tools**: Test `searchCards` and `getPlayerHistory` tools in isolation with mocked data.
- **AI Proxy**: Test the refactored proxy endpoint to ensure it still accepts legacy request formats and returns valid SSE streams.

### Layer 2: E2E (Playwright)
- **Streaming Verification**: Assert that the `useChat` hook receives multiple chunks during a single response.
- **Provider Switching**: Automate the settings toggle and verify the `X-Vercel-AI-Provider` or similar internal metadata matches.
- **Offline Fallback**: Use Playwright's network throttling/interception to simulate offline state and assert that the "Heuristic Mode" UI appears.
- **Tool Calling**: Verify the "Black Lotus" test case (LLM -> tool -> response).

### Layer 3: Performance (REQ-T5)
- **TTFT (Time to First Token)**: Measure the time from request start to the first SSE chunk. Must be < 500ms.
- **Local Tool Latency**: Measure `searchCards` tool execution time. Must be < 50ms.

## Success Criteria Mapping

| Requirement | Test File | Method |
|-------------|-----------|--------|
| REQ-9.1: Multi-Provider | `src/ai/providers/factory.test.ts` | Unit |
| REQ-9.2: Streaming | `e2e/ai-streaming.spec.ts` | E2E (SSE check) |
| REQ-9.3: MCP Bridge | `e2e/ai-streaming.spec.ts` | E2E (Tool calling) |
| REQ-T6: Offline-First | `e2e/ai-streaming.spec.ts` | E2E (Network mock) |

## Key Artifacts
- `src/app/api/chat/route.ts`
- `src/ai/tools/card-search.ts`
- `src/ai/tools/player-history.ts`
- `e2e/ai-streaming.spec.ts`
