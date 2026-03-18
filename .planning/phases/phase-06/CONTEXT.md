# Phase 6: Multi-Provider LLM & Streaming Infrastructure

## Goal
Users experience near-instant, reliable AI responses from their preferred provider.

## Requirements
- **REQ-9.1: Multi-Provider Support**
  - Integrate Vercel AI SDK v6.0+
  - Support OpenAI, Anthropic, and Google Gemini models
  - Implement provider-switching logic in the existing AI proxy
- **REQ-9.2: Streaming Infrastructure**
  - Enable Server-Sent Events (SSE) for all LLM responses
  - Add streaming support to the frontend `useChat` hook
  - Ensure proper chunk normalization for multiple providers
- **REQ-9.3: MCP Bridge Implementation**
  - Implement Model Context Protocol (MCP) for standard tool access
  - Expose card database search to LLM via MCP
  - Expose player history retrieval to LLM via MCP
- **REQ-T6: Offline-First Reliability**
  - AI Coach functions in basic heuristic mode when the user is offline or the API is unavailable.
  - The AI can answer questions about specific cards by searching the local database (via MCP bridge).

## Success Criteria
1. User can switch between OpenAI, Anthropic, and Google Gemini in settings and receive responses from the selected provider.
2. AI responses begin appearing in the UI within 500ms of the request (streaming).
3. AI Coach functions in basic heuristic mode when the user is offline or the API is unavailable.
4. The AI can answer questions about specific cards by searching the local database (via MCP bridge).
