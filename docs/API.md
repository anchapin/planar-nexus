# Planar Nexus API Documentation

**Version**: v1.7+ (pre-v1.8)  
**Last Updated**: July 17, 2026

---

## Table of Contents

1. [Overview](#1-overview)
2. [API Routes](#2-api-routes)
3. [AI Providers](#3-ai-providers)
4. [Environment Variables](#4-environment-variables)
5. [Rate Limits](#5-rate-limits)
6. [Error Handling](#6-error-handling)
7. [Server-Side Wrappers](#7-server-side-wrappers)
8. [Client-Side APIs](#8-client-side-apis)

---

## 1. Overview

Planar Nexus uses a minimal set of server-side route handlers for the features
that genuinely need a server. The application is primarily client-side;
`src/app/api/` exports exactly six route files exposing nine endpoints:

- **AI proxy** — server-side relay to LLM providers, keeping API keys off the
  client and enforcing rate limits (`/api/ai-proxy`, `/api/ai-proxy/validate`).
- **Chat** — unified streaming chat and the conversational deck coach
  (`/api/chat`, `/api/chat/coach`).
- **Deck import** — server-side fetch + parse of a decklist from a supported
  hosting URL (`/api/deck-import`).
- **Multiplayer signaling** — WebRTC handshake exchange for PeerJS P2P
  (`/api/signaling`).

> Gameplay (the AI opponent's turn loop) runs **client-side** through the AI
> flows in [`src/ai/`](../src/ai) (e.g. `ai-turn-loop.ts`,
> `ai-opponent-deck-generation.ts`); there is no HTTP gameplay endpoint.
> Likewise card data is served from the in-browser IndexedDB store, not a
> server route. See [`docs/USER_GUIDE.md`](./USER_GUIDE.md) for the user-facing
> feature map.

### Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│   Browser   │────▶│  Next.js Server  │────▶│  AI Provider │
│   (Client)  │     │   (Proxy API)    │     │   (External) │
└─────────────┘     └──────────────────┘     └──────────────┘
     │                      │                        │
     │  1. Request          │  2. Auth & Rate Limit  │
     │     (no API key)     │     Check              │
     │                      │  3. Log Usage          │
     │                      │                        │
     │◀──── 4. Response ────│◀──── 5. API Call ──────│
│     (no API key)      │     (with API key)    │
```

### Security Model

- **API keys stored server-side only** - Never exposed to browser
- **Rate limiting per user/IP** - Prevents abuse
- **Usage tracking** - Monitor API consumption
- **Consistent error handling** - Clear error messages

---

## 2. API Routes

> **Source of truth:** this section mirrors the exports of
> `src/app/api/**/route.ts`. Every handler listed below exists in the route
> tree; any endpoint not listed here does **not** exist (the previously
> documented `POST /api/ai/coach/review`, `POST /api/ai/play`,
> `POST /api/ai/opponent/generate`, and `GET /api/ai-proxy/status` have been
> removed — they 404'd).
>
> **Testing**: route handlers have co-located unit tests under
> `src/app/api/<route>/__tests__/route.test.ts`; API mocking uses MSW
> (`src/test-utils/msw/`). See [TESTING.md](./TESTING.md).

### Route map

| Method | Path                      | Purpose                                                            | Handler                                                                |
| ------ | ------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| GET    | `/api/ai-proxy`           | Proxy status + configured providers (use `?action=status` for full) | [`ai-proxy/route.ts`](../src/app/api/ai-proxy/route.ts)               |
| POST   | `/api/ai-proxy`           | Relay a provider chat request (streaming or one-shot)              | [`ai-proxy/route.ts`](../src/app/api/ai-proxy/route.ts)               |
| GET    | `/api/ai-proxy/validate`  | Validate a server-side API key (`?provider=`)                      | [`ai-proxy/validate/route.ts`](../src/app/api/ai-proxy/validate/route.ts) |
| POST   | `/api/chat`               | Unified streaming chat (Vercel AI SDK)                             | [`chat/route.ts`](../src/app/api/chat/route.ts)                       |
| POST   | `/api/chat/coach`         | Conversational deck coach (Server-Sent Events stream)              | [`chat/coach/route.ts`](../src/app/api/chat/coach/route.ts)           |
| POST   | `/api/deck-import`        | Fetch + parse a decklist from a supported hosting URL              | [`deck-import/route.ts`](../src/app/api/deck-import/route.ts)         |
| GET    | `/api/signaling`          | Poll a multiplayer signaling session                               | [`signaling/route.ts`](../src/app/api/signaling/route.ts)             |
| POST   | `/api/signaling`          | Create / join / exchange offers+answers+ICE / close a session      | [`signaling/route.ts`](../src/app/api/signaling/route.ts)             |
| DELETE | `/api/signaling`          | Tear down a session (`?sessionId=`)                                | [`signaling/route.ts`](../src/app/api/signaling/route.ts)             |

---

### 2.1 GET /api/ai-proxy

Returns proxy status and the providers configured on the server. Pass
`?action=status` for the extended payload (includes the full provider
availability list).

**Query Parameters**:

| Param   | Required | Description                                  |
| ------- | -------- | -------------------------------------------- |
| `action` | no       | Set to `status` for the extended status body |

**Response (`?action=status`)**:
```json
{
  "success": true,
  "serverProxyEnabled": true,
  "configuredProviders": ["google", "openai"],
  "availableProviders": ["google", "openai", "anthropic", "zaic", "custom"]
}
```

**Response (default)**:
```json
{
  "success": true,
  "message": "AI Proxy is running (Vercel AI SDK enabled)",
  "configuredProviders": ["google", "openai"]
}
```

> The canonical provider ids are `google | openai | anthropic | zaic | custom`
> (see [`AIProvider` in `src/ai/providers/types.ts`](../src/ai/providers/types.ts)).

---

### 2.2 POST /api/ai-proxy

Relays a chat-completion request to a configured provider using the Vercel AI
SDK, keeping the API key server-side. Supports both streaming and one-shot
responses. Enforces per-client rate limiting and logs usage; the rate-limit key
is derived from server-verified request metadata only (a client-supplied
`userId` is **ignored** — see issue #1393).

**Request**:
```typescript
interface AIProxyRequest {
  provider: "google" | "openai" | "anthropic" | "zaic" | "custom";
  endpoint: string;
  model?: string;
  body: {
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
    max_tokens?: number;      // alias: maxTokens
    stream?: boolean;         // true → text stream; false/omitted → JSON
  };
  userId?: string;            // accepted for logging only; never seeds rate limit
}
```

**Response (non-streaming)** wraps the provider result in an OpenAI-style
envelope for legacy compatibility:
```typescript
interface AIProxyResponse {
  success: boolean;
  data?: {
    choices: Array<{
      message: { role: "assistant"; content: string };
      finish_reason: string;
    }>;
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  };
  error?: string;
  errorCode?: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  rateLimit?: { remaining: number; resetAt: number };
}
```

When `body.stream === true`, the route returns a `text/plain` chunk stream (via
`streamText().toTextStreamResponse()`) rather than JSON. Rate-limit headers are
attached to both response shapes.

> **Tests:** [`src/app/api/ai-proxy/__tests__/route.test.ts`](../src/app/api/ai-proxy/__tests__/route.test.ts)

---

### 2.3 GET /api/ai-proxy/validate

Validates that a server-side API key for a provider is configured and actually
works, by issuing a minimal request to the provider's API.

**Query Parameters**:

| Param      | Required | Description                                                          |
| ---------- | -------- | -------------------------------------------------------------------- |
| `provider` | yes      | One of `google`, `openai`, `zaic`, `custom` (note: `anthropic` is not validateable through this endpoint) |

**Response (success)**:
```json
{
  "success": true,
  "provider": "google",
  "valid": true,
  "message": "API key is valid and working"
}
```

**Response (failure — 401)**:
```json
{
  "success": false,
  "provider": "google",
  "valid": false,
  "error": "API validation failed: 401 - ...",
  "errorCode": "VALIDATION_FAILED_401"
}
```

> **Tests:** [`src/app/api/ai-proxy/validate/__tests__/route.test.ts`](../src/app/api/ai-proxy/validate/__tests__/route.test.ts)

---

### 2.4 POST /api/chat

Unified streaming chat endpoint built on the Vercel AI SDK. Defaults to OpenAI
when `provider` is omitted. Exposes a `searchCards` tool to the model. Returns a
text stream (not JSON).

**Request**:
```typescript
interface ChatRequest {
  messages: Array<{ role: string; content: string }>;
  provider?: "google" | "openai" | "anthropic" | "zaic" | "custom"; // default "openai"
  modelId?: string;
}
```

**Response**: a `text/plain` chunk stream from `streamText().toTextStreamResponse()`.

**Errors** (JSON):
```json
{ "error": "Missing or invalid messages" }   // 400
{ "error": "<provider message>" }            // 5xx, provider-attributed
```

---

### 2.5 POST /api/chat/coach

The **Conversational AI Coach** (v1.7). Streams responses token-by-token as
Server-Sent Events so the chat panel can render progressively and be cancelled
mid-generation. Performs transparent provider failover and applies prompt-
injection guardrails end-to-end (every message is sanitized; client-supplied
`system` messages are dropped; the system prompt is always rebuilt server-side).

The route **pre-fetches** structured deck analysis in parallel (cached) before
invoking the model (issue #928), and prefers a client-supplied
`digestedContext.structuredAnalysisText` for large/Commander decks so the full
deck need not be re-sent. Conversation history is pruned against a token budget
(issue #1238); the latest user turn is always retained.

**Request**:
```typescript
interface CoachChatRequest {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  deckCards?: DeckCard[];        // required unless digestedContext is supplied
  digestedContext?: { structuredAnalysisText?: string; [k: string]: unknown };
  format: string;                // e.g. "commander" | "standard" | "modern"
  archetype?: string;
  strategy?: string;
  difficulty?: string;
  provider?: AIProvider;         // primary provider; others tried on failure
  modelId?: string;
  maxHistoryMessages?: number;
  maxHistoryTokens?: number;
}
```

**Response**: `text/event-stream` of SSE events produced by
`eventToSse(...)`. Terminal event types include `error` (carries a `value`
message). The `Content-Type` is `text/event-stream; charset=utf-8` with
`Cache-Control: no-cache, no-transform`.

**Errors** (JSON, non-streaming):
```json
{ "success": false, "error": "Messages are required and must be an array" }  // 400
{ "success": false, "error": "Either deckCards or digestedContext is required" } // 400
{ "success": false, "error": "Format is required" }                          // 400
```

> **Tests:**
> - Route — [`src/app/api/chat/coach/__tests__/route.test.ts`](../src/app/api/chat/coach/__tests__/route.test.ts)
> - Stream layer — [`src/ai/flows/__tests__/coach-stream.test.ts`](../src/ai/flows/__tests__/coach-stream.test.ts)
> - Context prefetch — [`src/ai/flows/__tests__/coach-context-prefetch.test.ts`](../src/ai/flows/__tests__/coach-context-prefetch.test.ts)
> - History pruning — [`src/ai/flows/__tests__/prepare-conversation-history.test.ts`](../src/ai/flows/__tests__/prepare-conversation-history.test.ts)
> - Prompt construction — [`src/ai/flows/__tests__/coach-prompt.test.ts`](../src/ai/flows/__tests__/coach-prompt.test.ts)

---

### 2.6 POST /api/deck-import

Server-side fetch + parse of a decklist from a supported hosting site
(MTGGoldfish, TappedOut, Moxfield, and others). Returns the parsed decklist text
for the client to resolve into cards. Strictly validates the URL scheme and
hostname (no SSRF schemes, no embedded credentials, exact/subdomain hostname
match — issue #1392) and caps both request body (512 KB) and returned rows
(250) to prevent abuse (issue #1277).

**Request**:
```typescript
interface DeckImportRequest {
  url: string;   // https/http only, no credentials, must be a supported site
}
```

**Response (success)**:
```json
{
  "success": true,
  "decklist": "4 Lightning Bolt\n4 Goblin Guide\n20 Mountain",
  "siteName": "MTGGoldfish",
  "cardCount": 22
}
```

**Errors**:
| Status | When                                                |
| ------ | --------------------------------------------------- |
| 400    | Missing/invalid URL, unsupported scheme/creds, unsupported site (includes `supportedSites` + `suggestion`) |
| 413    | Request body exceeds 512 KB                         |
| 422    | Page fetched but no decklist could be parsed        |
| 5xx    | Upstream fetch failure / internal error             |

> **Tests:** [`src/app/api/deck-import/__tests__/route.test.ts`](../src/app/api/deck-import/__tests__/route.test.ts)

---

### 2.7 GET /api/signaling

Poll a multiplayer signaling session by game code or session id. Returns the
session state appropriate to the caller's `role`. Sessions are in-memory and
expire after 5 minutes.

**Query Parameters**:

| Param       | Required                  | Description                          |
| ----------- | ------------------------- | ------------------------------------ |
| `gameCode`  | one of `gameCode`/`sessionId` | The human-readable room code        |
| `sessionId` | one of `gameCode`/`sessionId` | The internal session id            |
| `role`      | no                        | `host` or `client`; selects which WebRTC fields are returned |

**Response (host)**: includes `answer`, `clientCandidates`, `clientId`,
`clientName`. **Response (client)**: includes `offer`, `hostCandidates`,
`hostId`. Both shapes include `sessionId`, `gameCode`, `hostName`,
`clientName`, `createdAt`, `expiresAt`.

**Errors**: `400` (`gameCode or sessionId required`), `404` (`Session not found`).

> **Tests:** [`src/app/api/signaling/__tests__/route.test.ts`](../src/app/api/signaling/__tests__/route.test.ts)

---

### 2.8 POST /api/signaling

Create a session, join one, or exchange WebRTC signaling data. The `type`
field selects the handler; `payload` is type-specific.

**Request**:
```typescript
interface SignalingMessage {
  type: "create" | "join" | "offer" | "answer" | "ice-candidate" | "close";
  payload: unknown; // shape depends on `type` (see handler)
}
```

| `type`          | `payload`                                                                     |
| --------------- | ----------------------------------------------------------------------------- |
| `create`        | `{ hostId, hostName, offer? }` → returns `{ sessionId, gameCode }`            |
| `join`          | `{ gameCode, clientId, clientName }`                                          |
| `offer`         | `{ sessionId, offer }`                                                        |
| `answer`        | `{ sessionId, answer }`                                                       |
| `ice-candidate` | `{ sessionId, candidate, role: "host" \| "client" }`                          |
| `close`         | `{ sessionId }`                                                               |

**Errors**: `400` (invalid JSON, unknown `type`, or missing required fields),
`404` (session not found for join/exchange/close).

---

### 2.9 DELETE /api/signaling

Tear down a signaling session.

**Query Parameters**:

| Param       | Required | Description              |
| ----------- | -------- | ------------------------ |
| `sessionId` | yes      | The session to delete    |

**Response (success)**: `{ "success": true }`. **Errors**: `400` (`sessionId required`), `404` (`Session not found`).

---

## 3. AI Providers

### 3.1 Google (Gemini)

**Configuration**:
```typescript
const googleConfig = {
  provider: "google",
  model: "gemini-1.5-flash-latest",
  temperature: 0.7,
  maxTokens: 2048,
};
```

**Setup**:
1. Get API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Add to environment: `GOOGLE_AI_API_KEY=your_key_here`
3. Validate in Settings → AI

**Features**:
- Fast response times
- Good for deck analysis
- Free tier available (60 requests/minute)

**Example Usage**:
```typescript
import { sendGoogleAIChat } from '@/ai/providers/google';

const response = await sendGoogleAIChat(
  {
    provider: 'google',
    model: 'gemini-1.5-flash-latest',
    temperature: 0.7,
  },
  {
    contents: [
      {
        role: 'user',
        parts: [{ text: 'Analyze this deck: ...' }],
      },
    ],
  }
);
```

---

### 3.2 OpenAI (GPT)

**Configuration**:
```typescript
const openaiConfig = {
  provider: "openai",
  model: "gpt-4o-mini",
  temperature: 0.7,
  maxTokens: 2048,
};
```

**Setup**:
1. Get API key from [OpenAI Platform](https://platform.openai.com/api-keys)
2. Add to environment: `OPENAI_API_KEY=sk-...`
3. Validate in Settings → AI

**Features**:
- High-quality analysis
- Good reasoning capabilities
- Paid (usage-based pricing)

**Example Usage**:
```typescript
import { sendOpenAIChat } from '@/ai/providers/openai';

const response = await sendOpenAIChat(
  {
    provider: 'openai',
    model: 'gpt-4o-mini',
    temperature: 0.7,
  },
  {
    messages: [
      { role: 'system', content: 'You are an MTG expert.' },
      { role: 'user', content: 'Analyze this deck: ...' },
    ],
  }
);
```

---

### 3.3 Claude (Anthropic)

> The wire `provider` id is **`anthropic`** (see
> [`AIProvider`](../src/ai/providers/types.ts)); "Claude" is the product name.

**Configuration**:
```typescript
const claudeConfig = {
  provider: "anthropic",
  model: "claude-3-haiku-20240307",
  temperature: 0.7,
  maxTokens: 2048,
};
```

**Setup**:
1. Get API key from [Anthropic Console](https://console.anthropic.com/)
2. Add to environment: `ANTHROPIC_API_KEY=sk-ant-...`
3. Validate in Settings → AI

**Features**:
- Excellent reasoning
- Long context window
- Paid (usage-based pricing)

**Example Usage**:
```typescript
import { sendClaudeChat } from '@/ai/providers/claude';

const response = await sendClaudeChat(
  {
    provider: 'anthropic',
    model: 'claude-3-haiku-20240307',
    temperature: 0.7,
  },
  {
    messages: [
      { role: 'system', content: 'You are an MTG expert.' },
      { role: 'user', content: 'Analyze this deck: ...' },
    ],
  }
);
```

---

### 3.4 Z.ai (GLM)

> The wire `provider` id is **`zaic`** (see
> [`AIProvider`](../src/ai/providers/types.ts)); the API-endpoint env key is
> `ZAI` (`API_ENDPOINTS.ZAI` in [`src/lib/env.ts`](../src/lib/env.ts)).

**Configuration**:
```typescript
const zaiConfig = {
  provider: "zaic",
  model: "glm-4-flash",
  temperature: 0.7,
  maxTokens: 2048,
};
```

**Setup**:
1. Get API key from [Z.ai Platform](https://platform.z.ai/)
2. Add to environment: `ZAI_API_KEY=your_key_here`
3. Validate in Settings → AI

**Features**:
- Cost-effective
- Good performance
- Paid (usage-based pricing)

---

## 4. Environment Variables

### Required (for AI features)

| Variable | Description | Example |
|----------|-------------|---------|
| `GOOGLE_AI_API_KEY` | Google AI API key | `AIzaSy...` |
| `OPENAI_API_KEY` | OpenAI API key | `sk-...` |
| `ANTHROPIC_API_KEY` | Anthropic API key | `sk-ant-...` |
| `ZAI_API_KEY` | Z.ai API key | `...` |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `AI_PROXY_ENABLED` | Enable server proxy | `true` |
| `AI_RATE_LIMIT_MAX` | Default rate limit (requests/window) | `100` |
| `AI_RATE_LIMIT_WINDOW_MS` | Rate limit window (milliseconds) | `60000` |
| `AI_RATE_LIMIT_MAX_GOOGLE` | Google-specific rate limit | Uses default |
| `AI_RATE_LIMIT_MAX_OPENAI` | OpenAI-specific rate limit | Uses default |
| `NODE_ENV` | Environment mode | `development` |

### Example `.env.local`

```bash
# AI Provider API Keys (Server-Side Only)
GOOGLE_AI_API_KEY=AIzaSyD...
OPENAI_API_KEY=sk-proj-...
ANTHROPIC_API_KEY=sk-ant-...

# Rate Limiting
AI_RATE_LIMIT_MAX=100
AI_RATE_LIMIT_WINDOW_MS=60000

# Environment
NODE_ENV=development
```

---

## 5. Rate Limits

### Default Rate Limits

| Provider | Free Tier | Paid Tier |
|----------|-----------|-----------|
| Google (Gemini) | 60 req/min | 1500 req/min |
| OpenAI | 3 req/min | 500 req/min |
| Claude | N/A (paid only) | 200 req/min |
| Z.ai | 10 req/min | 100 req/min |

### Server-Side Rate Limiting

The proxy enforces additional rate limits per user/IP:

```typescript
// Default configuration
{
  maxRequests: 100,        // Max requests per window
  windowMs: 60000,         // Window size (1 minute)
  ttlMs: 300000,           // Rate limit cache TTL (5 minutes)
}
```

### Rate Limit Headers

All responses include rate limit headers:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1710234567890
Retry-After: 60  (only on 429 responses)
```

### Handling Rate Limits

```typescript
try {
  const response = await callAIProxy(request);
  
  if (!response.success && response.errorCode === 'RATE_LIMIT_EXCEEDED') {
    const retryAfter = response.retryAfter || 60;
    console.log(`Rate limited. Retry after ${retryAfter} seconds`);
    
    // Implement exponential backoff
    await sleep(retryAfter * 1000);
    return callAIProxy(request);
  }
  
  return response;
} catch (error) {
  console.error('AI request failed:', error);
  throw error;
}
```

---

## 6. Error Handling

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `INVALID_JSON` | 400 | Request body is not valid JSON |
| `INVALID_PROVIDER` | 400 | Provider parameter is missing or invalid |
| `PROVIDER_NOT_CONFIGURED` | 503 | Provider not configured on server |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `NETWORK_ERROR` | 502 | Failed to reach provider API |
| `INVALID_RESPONSE` | 502 | Invalid response from provider |
| `PROVIDER_ERROR_401` | 401 | Invalid API key |
| `PROVIDER_ERROR_429` | 429 | Rate limited by provider |
| `INTERNAL_ERROR` | 500 | Internal server error |

### Error Response Format

```typescript
interface ErrorResponse {
  success: false;
  error: string;
  errorCode: string;
  retryAfter?: number;  // Seconds until retry is allowed
  details?: Record<string, unknown>;
}
```

### Example Error Response

```json
{
  "success": false,
  "error": "Rate limit exceeded. Please try again later.",
  "errorCode": "RATE_LIMIT_EXCEEDED",
  "retryAfter": 45
}
```

### Client-Side Error Handling

```typescript
import { callAIProxy, RateLimitError, ProviderNotConfiguredError } from '@/lib/ai-proxy-client';

async function analyzeDeck(deck: Deck) {
  try {
    const response = await callAIProxy({
      provider: 'google',
      endpoint: 'coach/review',
      body: { deck },
    });

    if (!response.success) {
      throw new Error(response.error);
    }

    return response.data;
  } catch (error) {
    if (error instanceof RateLimitError) {
      // Show user-friendly rate limit message
      return {
        archetype: null,
        synergies: [],
        suggestions: ['Analysis temporarily unavailable. Please try again.'],
      };
    }
    
    if (error instanceof ProviderNotConfiguredError) {
      // Prompt user to configure API key
      return {
        archetype: null,
        synergies: [],
        suggestions: ['Please configure your API key in Settings.'],
      };
    }
    
    throw error;
  }
}
```

---

## 7. Server-Side Wrappers

> **Heads up:** despite the filename, [`src/app/actions.ts`](../src/app/actions.ts)
> does **not** export Next.js Server Actions — it has no `"use server"`
> directive. The exports below are **client-side** wrapper functions that call
> the AI flows in [`src/ai/flows/`](../src/ai/flows) (and the routes in
> [Section 2](#2-api-routes)) from the browser. Real persistence is
> client-side via IndexedDB/Dexie. The signatures are kept here as the
> public call surface; treat the comments below as descriptive, not literal
> `'use server'` exports.

### 7.1 Card Search

```typescript
// src/app/actions.ts
'use server';

export async function searchScryfall(query: string): Promise<ScryfallCard[]> {
  // Searches local IndexedDB database
  // Falls back to Scryfall API if needed
}

export async function searchCards(
  query: string,
  format: string
): Promise<ScryfallCard[]> {
  // Format-aware card search
}

export async function validateCardLegality(
  cards: Array<{ name: string; quantity: number }>,
  format: string
): Promise<{
  found: string[];
  notFound: string[];
  illegal: string[];
}> {
  // Validates deck against format rules
}
```

### 7.2 Deck Persistence

```typescript
// src/app/actions.ts
'use server';

export async function saveDeck(deck: SavedDeck): Promise<void> {
  // Saves deck to local storage
}

export async function loadDeck(id: string): Promise<SavedDeck | null> {
  // Loads deck from local storage
}

export async function deleteDeck(id: string): Promise<void> {
  // Deletes deck from local storage
}

export async function listDecks(): Promise<SavedDeck[]> {
  // Lists all saved decks
}
```

### 7.3 AI Operations

```typescript
// src/app/actions.ts
'use server';

export async function getDeckCoachReview(
  deck: DeckCard[],
  provider?: string
): Promise<CoachReport> {
  // Calls AI proxy for deck analysis
}

export async function generateOpponentDeck(
  format: string,
  difficulty: string,
  theme?: string
): Promise<DeckCard[]> {
  // Generates AI opponent deck
}
```

---

## 8. Client-Side APIs

### 8.1 AI Proxy Client

```typescript
// src/lib/ai-proxy-client.ts

import { callAIProxy, getProxyStatus, validateProviderKey } from '@/lib/ai-proxy-client';

// Make a proxied AI call
const response = await callAIProxy({
  provider: 'google',
  endpoint: 'coach/review',
  model: 'default',
  body: { deck: myDeck },
  userId: 'user-123',
});

// Check proxy status
const status = await getProxyStatus();
console.log(status.configuredProviders); // ['google', 'openai']

// Validate API key
const validation = await validateProviderKey('google');
console.log(validation.valid); // true or false
```

### 8.2 Card Database Client

```typescript
// src/lib/card-database.ts

import {
  initializeCardDatabase,
  searchCardsOffline,
  getCardByName,
  validateDeckOffline,
} from '@/lib/card-database';

// Initialize database (call once on app load)
await initializeCardDatabase();

// Search cards
const results = await searchCardsOffline('Sol Ring', {
  maxCards: 20,
  format: 'commander',
});

// Get specific card
const card = await getCardByName('Lightning Bolt');

// Validate deck
const validation = await validateDeckOffline(decklist, 'commander');
console.log(validation.valid); // true or false
```

### 8.3 Game State Serialization

```typescript
// src/lib/game-state/serialization.ts

import { engineToAIState, aiToEngineState } from '@/lib/game-state/serialization';

// Convert engine state to AI-friendly format
const aiState = engineToAIState(engineGameState);

// Convert AI state back to engine format
const engineState = aiToEngineState(aiState, baseEngineState);
```

---

## Appendix A: Type Definitions

### Core Types

```typescript
interface DeckCard {
  name: string;
  count: number;
  set?: string;
  collectorNumber?: string;
}

interface SavedDeck {
  id: string;
  name: string;
  format: string;
  cards: DeckCard[];
  createdAt: string;
  updatedAt: string;
  description?: string;
}

interface CoachReport {
  archetype: {
    primary: string;
    confidence: number;
    secondary?: string;
  };
  synergies: Synergy[];
  missingSynergies: MissingSynergy[];
  keyCards: KeyCard[];
  suggestions: string[];
}

interface Synergy {
  name: string;
  score: number;
  cards: string[];
  description: string;
}

interface MissingSynergy {
  name: string;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
  suggestedCards: string[];
}

interface KeyCard {
  name: string;
  role: string;
}
```

### AI Game State Types

```typescript
interface AIGameState {
  players: { [playerId: string]: AIPlayerState };
  phase: 'beginning' | 'precombat_main' | 'combat' | 'postcombat_main' | 'end';
  stack: AIStackObject[];
  turn: number;
  activePlayer: string;
  priority: string;
}

interface AIPlayerState {
  id: string;
  life: number;
  poison: number;
  hand: string[];  // Card IDs
  battlefield: AIPermanent[];
  graveyard: string[];
  library: number;  // Count
  mana: { available: number; pool: ManaPool };
  commander?: AICommander;
}

interface AIPermanent {
  id: string;
  name: string;
  tapped: boolean;
  type: 'creature' | 'land' | 'artifact' | 'enchantment' | 'planeswalker';
  power?: number;
  toughness?: number;
  abilities: string[];
  counters: { [key: string]: number };
}
```

---

## Appendix B: Rate Limit Configuration

### Server-Side Limiter

The proxy enforces a single global limit per client (per provider-config
`rateLimit`). The previously documented per-provider `PROVIDER_LIMITS` map no
longer exists in the source.

```typescript
// src/lib/server-rate-limiter.ts
const maxRequests = parseInt(process.env.AI_RATE_LIMIT_MAX || '100', 10);
```

| Env var                 | Default | Meaning                              |
| ----------------------- | ------- | ------------------------------------ |
| `AI_RATE_LIMIT_MAX`     | `100`   | Max requests per window per client   |
| `AI_RATE_LIMIT_WINDOW_MS` | `60000` | Window length in ms (see [Section 5](#5-rate-limits)) |

Per-provider ceilings are still bounded upstream by each provider's own API
quota (see the "Default Rate Limits" table in [Section 5](#5-rate-limits)); the
server limiter sits in front of those as a coarse abuse guard, with the key
derived from server-verified request metadata only (issue #1393).

---

## Support

- **API Issues**: [GitHub Issues](https://github.com/anchapin/planar-nexus/issues)
- **Provider Documentation**:
  - [Google AI](https://ai.google.dev/docs)
  - [OpenAI API](https://platform.openai.com/docs)
  - [Anthropic API](https://docs.anthropic.com/claude/docs)
  - [Z.ai API](https://platform.z.ai/docs)
