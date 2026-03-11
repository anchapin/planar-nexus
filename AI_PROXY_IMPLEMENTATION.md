# Server-Side AI Proxy Implementation

**Issue #522**: Implement server-side API key validation and proxy for AI calls

## Overview

This implementation adds a server-side proxy for all AI provider API calls, ensuring that API keys are never exposed to the browser. This addresses critical security concerns including:

- API key exfiltration via XSS attacks
- Client-side validation bypass
- Lack of rate limiting and usage tracking
- No audit trail for API calls

## Architecture

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

## Components

### 1. Proxy API Route

**File**: `/src/app/api/ai-proxy/route.ts`

The main proxy endpoint that handles all AI provider requests:

- `POST /api/ai-proxy` - Proxy AI provider requests
- `GET /api/ai-proxy` - Get proxy status and configuration
- `GET /api/ai-proxy/validate` - Validate server-side API keys

Features:
- Server-side API key management
- Rate limiting per user/IP
- Usage tracking and logging
- Consistent error handling

### 2. Proxy Client Library

**File**: `/src/lib/ai-proxy-client.ts`

Client-side utilities for interacting with the proxy:

```typescript
import { callAIProxy, getProxyStatus, validateProviderKey } from '@/lib/ai-proxy-client';

// Make a proxied AI call
const response = await callAIProxy({
  provider: 'zaic',
  endpoint: 'chat/completions',
  model: 'default',
  body: { messages: [...] },
});

// Check proxy status
const status = await getProxyStatus();

// Validate API key
const validation = await validateProviderKey('google');
```

### 3. Updated AI Providers

All AI providers now use the server-side proxy by default:

- **Z.ai**: `/src/ai/providers/zaic.ts`
- **OpenAI**: `/src/ai/providers/openai.ts`
- **Google AI**: `/src/ai/providers/google.ts` (new)

Each provider supports a `useProxy` option (default: `true`):

```typescript
import { sendZAIChat } from '@/ai/providers/zaic';

// Uses server-side proxy (default)
const response = await sendZAIChat(config, request);

// Direct API call (deprecated, for backward compatibility)
const response = await sendZAIChat(
  { ...config, useProxy: false },
  request
);
```

### 4. Server-Side Support Libraries

- **API Key Storage**: `/src/lib/server-api-key-storage.ts`
  - Reads API keys from environment variables
  - Provider configuration management
  - API key format validation

- **Rate Limiter**: `/src/lib/server-rate-limiter.ts`
  - LRU cache-based rate limiting
  - Configurable per provider
  - Returns rate limit headers

- **Usage Logger**: `/src/lib/server-usage-logger.ts`
  - Tracks API usage per user
  - Token usage and cost estimation
  - Error tracking and reporting

## Configuration

### Environment Variables

Add these to your `.env.local` file:

```bash
# AI Provider API Keys (Server-Side Only - Never Exposed)
GOOGLE_AI_API_KEY=your_google_ai_key
OPENAI_API_KEY=your_openai_key
ZAI_API_KEY=your_zai_key
CUSTOM_AI_API_KEY=your_custom_key

# Optional: Custom Base URLs
CUSTOM_AI_BASE_URL=https://custom-ai-api.com/v1

# Rate Limiting Configuration
AI_RATE_LIMIT_MAX=100           # Max requests per window
AI_RATE_LIMIT_WINDOW_MS=60000   # Window size in milliseconds

# Per-provider rate limits (optional, overrides defaults)
AI_RATE_LIMIT_MAX_GOOGLE=150
AI_RATE_LIMIT_WINDOW_GOOGLE=60000
```

### Provider Configuration

The proxy automatically detects configured providers based on environment variables. Use the status endpoint to check:

```typescript
const status = await getProxyStatus();
console.log(status.configuredProviders); // ['google', 'zaic']
```

## Usage Examples

### Basic Chat Completion

```typescript
import { sendZAIChat } from '@/ai/providers/zaic';

const response = await sendZAIChat(
  {
    provider: 'zaic',
    model: 'default',
    temperature: 0.7,
    maxTokens: 1024,
  },
  {
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello!' },
    ],
  }
);

console.log(response.choices[0].message.content);
```

### Google AI (Gemini)

```typescript
import { sendGoogleAIChat, convertMessagesToGoogleAI } from '@/ai/providers/google';

const contents = convertMessagesToGoogleAI([
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Explain quantum computing.' },
]);

const response = await sendGoogleAIChat(
  {
    provider: 'google',
    model: 'gemini-1.5-flash-latest',
    temperature: 0.7,
  },
  {
    contents,
    generationConfig: {
      maxOutputTokens: 1024,
    },
  }
);

console.log(response.candidates[0].content.parts[0].text);
```

### OpenAI

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
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'What is TypeScript?' },
    ],
  }
);

console.log(response.choices[0].message.content);
```

## Security Features

### 1. API Key Protection

- API keys stored only in server environment variables
- Keys never sent to or stored in the browser
- Keys not visible in DevTools Network tab

### 2. Rate Limiting

Default: 100 requests per minute per user/IP

```typescript
// Rate limit headers in response
{
  'X-RateLimit-Limit': '100',
  'X-RateLimit-Remaining': '95',
  'X-RateLimit-Reset': '1710234567890',
  'Retry-After': '30', // If rate limited
}
```

### 3. Usage Tracking

All API calls are logged with:
- User identifier
- Provider and endpoint
- Token usage (input/output)
- Cost estimation
- Success/failure status
- Error codes

### 4. Error Handling

Consistent error responses with error codes:

```typescript
{
  success: false,
  error: 'Rate limit exceeded. Please try again later.',
  errorCode: 'RATE_LIMIT_EXCEEDED',
  retryAfter: 30,
}
```

## Migration Guide

### From Direct API Calls

**Before** (client-side API keys):
```typescript
import { sendZAIChat } from '@/ai/providers/zaic';

const config = {
  provider: 'zaic',
  apiKey: 'sk-xxx', // Exposed in browser!
  model: 'default',
};

const response = await sendZAIChat(config, request);
```

**After** (server-side proxy):
```typescript
import { sendZAIChat } from '@/ai/providers/zaic';

const config = {
  provider: 'zaic',
  model: 'default',
  // No API key needed - uses server-side proxy
};

const response = await sendZAIChat(config, request);
```

### Enabling the Proxy

1. Set environment variables for your AI providers
2. Update provider calls to remove API keys
3. (Optional) Set `useProxy: true` explicitly

## API Reference

### Proxy Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ai-proxy` | POST | Proxy AI provider requests |
| `/api/ai-proxy` | GET | Get proxy status |
| `/api/ai-proxy?action=status` | GET | Get detailed status |
| `/api/ai-proxy/validate` | GET | Validate API key |

### Request Body (POST /api/ai-proxy)

```typescript
interface AIProxyRequest {
  provider: 'google' | 'openai' | 'zaic' | 'custom';
  endpoint: string;  // e.g., 'chat/completions'
  model?: string;
  body: Record<string, unknown>;
  userId?: string;
}
```

### Response Format

```typescript
interface AIProxyResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  errorCode?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  rateLimit?: {
    remaining: number;
    resetAt: number;
  };
}
```

## Troubleshooting

### Provider Not Configured

**Error**: `PROVIDER_NOT_CONFIGURED`

**Solution**: Set the appropriate environment variable:
- Google: `GOOGLE_AI_API_KEY`
- OpenAI: `OPENAI_API_KEY`
- Z.ai: `ZAI_API_KEY`

### Rate Limit Exceeded

**Error**: `RATE_LIMIT_EXCEEDED`

**Solution**: 
- Wait for the rate limit window to reset
- Increase rate limits in environment variables
- Implement request queuing on the client

### Invalid API Key

**Error**: `PROVIDER_ERROR_401`

**Solution**: Verify the API key in environment variables is correct and has not expired.

## Future Enhancements (Phase 2)

- [ ] User authentication integration
- [ ] Per-user usage quotas
- [ ] Admin dashboard for API monitoring
- [ ] Caching for common AI responses
- [ ] Streaming support through proxy
- [ ] CSRF protection for API routes

## Related Files

- `/src/app/api/ai-proxy/route.ts` - Main proxy route
- `/src/app/api/ai-proxy/validate/route.ts` - Validation endpoint
- `/src/lib/ai-proxy-client.ts` - Client library
- `/src/lib/server-api-key-storage.ts` - Server-side key management
- `/src/lib/server-rate-limiter.ts` - Rate limiting
- `/src/lib/server-usage-logger.ts` - Usage tracking
- `/src/ai/providers/zaic.ts` - Z.ai provider (updated)
- `/src/ai/providers/openai.ts` - OpenAI provider (updated)
- `/src/ai/providers/google.ts` - Google AI provider (new)
