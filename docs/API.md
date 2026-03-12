# Planar Nexus API Documentation

**Version**: 1.0.0  
**Last Updated**: March 12, 2026

---

## Table of Contents

1. [Overview](#1-overview)
2. [AI Endpoints](#2-ai-endpoints)
3. [AI Providers](#3-ai-providers)
4. [Environment Variables](#4-environment-variables)
5. [Rate Limits](#5-rate-limits)
6. [Error Handling](#6-error-handling)
7. [Server Actions](#7-server-actions)
8. [Client-Side APIs](#8-client-side-apis)

---

## 1. Overview

Planar Nexus uses a minimal server-side proxy for optional LLM features. The application is primarily client-side, with server endpoints for:

- AI deck coaching analysis
- AI opponent move generation
- Card data proxying (optional)
- Multiplayer signaling (WebRTC handshake)

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

## 2. AI Endpoints

### 2.1 POST /api/ai/coach/review

Analyze a deck and generate a comprehensive coach report.

**Request**:
```typescript
interface CoachReviewRequest {
  deck: {
    name: string;
    format: string;  // "commander" | "standard" | "modern" | "legacy" | "vintage"
    cards: Array<{
      name: string;
      count: number;
    }>;
  };
  provider?: "google" | "openai" | "claude" | "zai";
}
```

**Example Request**:
```json
{
  "deck": {
    "name": "Burn",
    "format": "standard",
    "cards": [
      {"name": "Lightning Bolt", "count": 4},
      {"name": "Goblin Guide", "count": 4},
      {"name": "Monastery Swiftspear", "count": 4},
      {"name": "Rift Bolt", "count": 4},
      {"name": "Lava Spike", "count": 4},
      {"name": "Mountain", "count": 20}
    ]
  },
  "provider": "google"
}
```

**Response**:
```typescript
interface CoachReviewResponse {
  success: boolean;
  data?: {
    archetype: {
      primary: string;
      confidence: number;
      secondary?: string;
      secondaryConfidence?: number;
    };
    synergies: Array<{
      name: string;
      score: number;
      cards: string[];
      description: string;
    }>;
    missingSynergies: Array<{
      name: string;
      impact: "HIGH" | "MEDIUM" | "LOW";
      description: string;
      suggestedCards: string[];
    }>;
    keyCards: Array<{
      name: string;
      role: string;
    }>;
    suggestions: string[];
  };
  error?: string;
  errorCode?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}
```

**Example Response**:
```json
{
  "success": true,
  "data": {
    "archetype": {
      "primary": "Burn",
      "confidence": 0.92,
      "secondary": "Aggro",
      "secondaryConfidence": 0.75
    },
    "synergies": [
      {
        "name": "Lightning Bolt + Damage Boost",
        "score": 0.85,
        "cards": ["Lightning Bolt", "Rift Bolt"],
        "description": "Direct damage spells provide consistent burn damage"
      }
    ],
    "missingSynergies": [
      {
        "name": "Card Draw",
        "impact": "MEDIUM",
        "description": "Deck may run out of steam in long games",
        "suggestedCards": ["Opt", "Wizard's Lightning"]
      }
    ],
    "keyCards": [
      {
        "name": "Lightning Bolt",
        "role": "Primary damage source, essential win condition"
      }
    ],
    "suggestions": [
      "Consider adding 2-3 more burn spells for consistency",
      "Sideboard options against control: Spell Pierce"
    ]
  },
  "usage": {
    "inputTokens": 245,
    "outputTokens": 512,
    "totalTokens": 757
  }
}
```

---

### 2.2 POST /api/ai/play

Get an AI move recommendation for a game state.

**Request**:
```typescript
interface AIPlayRequest {
  gameState: AIGameState;
  playerId: string;
  difficulty?: "easy" | "medium" | "hard" | "expert";
  provider?: "google" | "openai" | "claude" | "zai";
}
```

**Example Request**:
```json
{
  "gameState": {
    "players": {
      "player-1": {
        "life": 20,
        "hand": ["Lightning Bolt", "Mountain"],
        "battlefield": ["Goblin Guide"],
        "manaAvailable": 3
      },
      "player-2": {
        "life": 18,
        "hand": [],
        "battlefield": ["Grizzly Bears"],
        "manaAvailable": 2
      }
    },
    "phase": "precombat_main",
    "turn": 3,
    "activePlayer": "player-1"
  },
  "playerId": "player-1",
  "difficulty": "medium"
}
```

**Response**:
```typescript
interface AIPlayResponse {
  success: boolean;
  data?: {
    action: "cast_spell" | "play_land" | "attack" | "block" | "activate_ability" | "pass";
    cardId?: string;
    target?: string;
    details?: Record<string, unknown>;
    reasoning?: string;
  };
  error?: string;
  errorCode?: string;
}
```

**Example Response**:
```json
{
  "success": true,
  "data": {
    "action": "cast_spell",
    "cardId": "lightning-bolt-1",
    "target": "player-2",
    "reasoning": "Deal 3 damage to opponent to push for lethal next turn"
  }
}
```

---

### 2.3 POST /api/ai/opponent/generate

Generate an AI opponent deck based on parameters.

**Request**:
```typescript
interface OpponentGenerateRequest {
  format: string;
  difficulty: "easy" | "medium" | "hard" | "expert";
  theme?: "aggro" | "control" | "combo" | "midrange" | "random";
  provider?: "google" | "openai" | "claude" | "zai";
}
```

**Response**:
```typescript
interface OpponentGenerateResponse {
  success: boolean;
  data?: {
    name: string;
    format: string;
    cards: Array<{
      name: string;
      count: number;
    }>;
    archetype: string;
    difficulty: string;
  };
  error?: string;
}
```

---

### 2.4 GET /api/ai-proxy/status

Get the current status of the AI proxy.

**Response**:
```json
{
  "success": true,
  "serverProxyEnabled": true,
  "configuredProviders": ["google", "openai"],
  "availableProviders": ["google", "openai", "claude", "zai"]
}
```

---

### 2.5 GET /api/ai-proxy/validate

Validate a server-side API key for a provider.

**Query Parameters**:
- `provider`: The provider to validate

**Response**:
```json
{
  "success": true,
  "provider": "google",
  "valid": true,
  "message": "API key is valid and working"
}
```

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

**Configuration**:
```typescript
const claudeConfig = {
  provider: "claude",
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
    provider: 'claude',
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

**Configuration**:
```typescript
const zaiConfig = {
  provider: "zai",
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

## 7. Server Actions

Planar Nexus uses Next.js Server Actions for server-side operations.

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

### Per-Provider Configuration

```typescript
// src/lib/server-rate-limiter.ts

const PROVIDER_LIMITS = {
  google: {
    max: parseInt(process.env.AI_RATE_LIMIT_MAX_GOOGLE || '150'),
    windowMs: parseInt(process.env.AI_RATE_LIMIT_WINDOW_GOOGLE || '60000'),
  },
  openai: {
    max: parseInt(process.env.AI_RATE_LIMIT_MAX_OPENAI || '100'),
    windowMs: parseInt(process.env.AI_RATE_LIMIT_WINDOW_OPENAI || '60000'),
  },
  claude: {
    max: parseInt(process.env.AI_RATE_LIMIT_MAX_CLAUDE || '50'),
    windowMs: parseInt(process.env.AI_RATE_LIMIT_WINDOW_CLAUDE || '60000'),
  },
  zai: {
    max: parseInt(process.env.AI_RATE_LIMIT_MAX_ZAI || '100'),
    windowMs: parseInt(process.env.AI_RATE_LIMIT_WINDOW_ZAI || '60000'),
  },
};
```

---

## Support

- **API Issues**: [GitHub Issues](https://github.com/anchapin/planar-nexus/issues)
- **Provider Documentation**:
  - [Google AI](https://ai.google.dev/docs)
  - [OpenAI API](https://platform.openai.com/docs)
  - [Anthropic API](https://docs.anthropic.com/claude/docs)
  - [Z.ai API](https://platform.z.ai/docs)
