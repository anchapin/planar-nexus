# Issue #522: Server-Side API Key Validation and Proxy for AI Calls

## Implementation Summary

This document describes the implementation of server-side API key validation and proxy for AI calls, enhancing security by keeping API keys on the server and providing rate limiting, usage tracking, and logging.

## Architecture

### Components

1. **Server-Side API Key Storage** (`src/lib/server-api-key-storage.ts`)
   - Manages API keys from environment variables
   - Provider configuration management
   - API key format validation

2. **Server-Side Rate Limiter** (`src/lib/server-rate-limiter.ts`)
   - LRU cache-based rate limiting
   - Per-user/per-IP rate limiting
   - Configurable windows and limits
   - Rate limit headers for responses

3. **Server-Side Usage Logger** (`src/lib/server-usage-logger.ts`)
   - Tracks API usage per provider
   - Token usage and cost estimation
   - Success/failure logging
   - 90-day data retention

4. **AI Proxy API Route** (`src/app/api/ai-proxy/route.ts`)
   - Main proxy endpoint for AI requests
   - Request forwarding to providers
   - Response handling and error propagation
   - Rate limit enforcement

5. **Validation Endpoint** (`src/app/api/ai-proxy/validate/route.ts`)
   - API key validation endpoint
   - Format and connectivity testing

6. **Proxy Client Utilities** (`src/lib/ai-proxy-client.ts`)
   - Client-side interface for proxy
   - Smart fallback to client-side calls
   - Rate limit status handling

## Environment Variables

### Required for Server Proxy

```bash
# Enable server-side proxy
AI_PROXY_ENABLED=true

# Server-side API keys (NEVER expose these to client)
GOOGLE_AI_API_KEY=your_google_ai_key
OPENAI_API_KEY=your_openai_key
ZAI_API_KEY=your_zai_key
CUSTOM_AI_API_KEY=your_custom_key

# Optional: Custom base URLs
ZAI_BASE_URL=https://api.z-ai.com/v1
CUSTOM_AI_BASE_URL=https://your-custom-api.com

# Rate limiting configuration
AI_RATE_LIMIT_MAX=100              # Default max requests per window
AI_RATE_LIMIT_WINDOW_MS=60000      # Default window in milliseconds
AI_RATE_LIMIT_TTL_MS=300000        # Rate limit cache TTL

# Per-provider rate limits (optional overrides)
AI_RATE_LIMIT_MAX_GOOGLE=100
AI_RATE_LIMIT_WINDOW_GOOGLE=60000
AI_RATE_LIMIT_MAX_OPENAI=100
AI_RATE_LIMIT_WINDOW_OPENAI=60000
AI_RATE_LIMIT_MAX_ZAI=100
AI_RATE_LIMIT_WINDOW_ZAI=60000
AI_RATE_LIMIT_MAX_CUSTOM=100
AI_RATE_LIMIT_WINDOW_CUSTOM=60000
```

### Client-Side Variables (Unchanged)

```bash
# These are still used for client-side fallback
NEXT_PUBLIC_ZAI_API_URL=https://api.z-ai.com/v1
NEXT_PUBLIC_OPENAI_API_URL=https://api.openai.com/v1
NEXT_PUBLIC_GOOGLE_API_URL=https://generativelanguage.googleapis.com/v1
NEXT_PUBLIC_AI_RATE_LIMIT_MAX=10
NEXT_PUBLIC_AI_RATE_LIMIT_WINDOW_MS=60000
```

## API Endpoints

### POST /api/ai-proxy

Proxy AI provider requests through the server.

**Request Body:**
```typescript
{
  provider: 'google' | 'openai' | 'zaic' | 'custom';
  endpoint: string;              // API endpoint path
  model?: string;                // Model to use
  body: Record<string, unknown>; // Request body for provider
  userId?: string;               // Optional user ID for tracking
}
```

**Response:**
```typescript
{
  success: boolean;
  data?: unknown;                // Provider response
  error?: string;                // Error message if failed
  errorCode?: string;            // Error code for programmatic handling
  usage?: {                      // Token usage (if available)
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  rateLimit?: {                  // Rate limit status
    remaining: number;
    resetAt: number;
  };
  retryAfter?: number;           // Seconds until retry (if rate limited)
}
```

**HTTP Status Codes:**
- `200`: Success
- `400`: Invalid request
- `401`: API key validation failed
- `429`: Rate limit exceeded
- `502`: Provider API error
- `503`: Provider not configured
- `500`: Internal server error

**Response Headers:**
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1678901234567
Retry-After: 60  (only when rate limited)
```

### GET /api/ai-proxy

Get proxy status and configuration.

**Query Parameters:**
- `action=status`: Get detailed status

**Response:**
```typescript
{
  success: boolean;
  serverProxyEnabled: boolean;
  configuredProviders: string[];
  availableProviders: string[];
}
```

### GET /api/ai-proxy/validate

Validate server-side API key for a provider.

**Query Parameters:**
- `provider`: Provider name (required)

**Response:**
```typescript
{
  success: boolean;
  provider: string;
  valid: boolean;
  message?: string;
  error?: string;
}
```

## Usage Examples

### Client-Side Usage

```typescript
import { makeProxyRequest, checkProxyStatus } from '@/lib/ai-proxy-client';

// Check if proxy is available
const status = await checkProxyStatus();
console.log('Proxy enabled:', status.serverProxyEnabled);
console.log('Configured providers:', status.configuredProviders);

// Make a request through the proxy
try {
  const response = await makeProxyRequest({
    provider: 'openai',
    endpoint: 'chat/completions',
    model: 'gpt-4o',
    body: {
      messages: [
        { role: 'user', content: 'Hello!' }
      ],
      max_tokens: 100,
    },
  });

  if (response.success) {
    console.log('Response:', response.data);
    console.log('Token usage:', response.usage);
    console.log('Rate limit remaining:', response.rateLimit?.remaining);
  } else {
    console.error('Error:', response.error);
  }
} catch (error) {
  if (error instanceof RateLimitError) {
    console.error(`Rate limited. Retry after ${error.retryAfter} seconds`);
  }
  throw error;
}
```

### Smart Request with Fallback

```typescript
import { smartAIRequest } from '@/lib/ai-proxy-client';

// Automatically use server proxy if available, otherwise fall back to client-side
const result = await smartAIRequest(
  {
    provider: 'openai',
    endpoint: 'chat/completions',
    model: 'gpt-4o',
    body: { messages: [{ role: 'user', content: 'Hello!' }] },
  },
  // Client-side fallback function
  async () => {
    // Your existing client-side implementation
    return callOpenAIClientSide();
  }
);
```

### Server-Side Usage (Next.js API Routes)

```typescript
import { getProviderConfig, isProviderConfigured } from '@/lib/server-api-key-storage';

// Check if provider is configured
if (isProviderConfigured('openai')) {
  const config = getProviderConfig('openai');
  console.log('OpenAI is configured with rate limit:', config?.rateLimit);
}
```

## Rate Limiting

### Configuration

Rate limits are configurable per provider:

```bash
# Default rate limit
AI_RATE_LIMIT_MAX=100          # 100 requests per window
AI_RATE_LIMIT_WINDOW_MS=60000  # 60 second window

# Per-provider overrides
AI_RATE_LIMIT_MAX_GOOGLE=50    # 50 requests for Google
AI_RATE_LIMIT_MAX_OPENAI=200   # 200 requests for OpenAI
```

### Client Identification

The proxy identifies clients for rate limiting using:
1. User ID (from local user system)
2. IP address (from `X-Forwarded-For` or `X-Real-IP`)
3. Session fingerprint (user agent hash, fallback)

### Rate Limit Headers

All proxy responses include rate limit headers:
- `X-RateLimit-Limit`: Maximum requests per window
- `X-RateLimit-Remaining`: Remaining requests in current window
- `X-RateLimit-Reset`: Unix timestamp when limit resets
- `Retry-After`: Seconds to wait (only on 429 responses)

## Usage Tracking

### Tracked Metrics

- Provider and endpoint
- Token usage (input/output/total)
- Cost estimation (based on provider pricing)
- Request duration
- Success/failure status
- Error codes and messages
- Client information (IP, user agent)

### Data Retention

Usage logs are retained for 90 days and stored in IndexedDB (client-side) or can be extended to use server-side storage.

### Accessing Usage Statistics

```typescript
import { getProviderUsageStats, getUsageSummary } from '@/lib/server-usage-logger';

// Get stats for a specific provider
const openaiStats = await getProviderUsageStats('openai', 30);
console.log('Total requests:', openaiStats.totalRequests);
console.log('Total tokens:', openaiStats.totalTokens);
console.log('Total cost:', openaiStats.totalCost);

// Get overall summary
const summary = await getUsageSummary(30);
console.log('All providers summary:', summary);
```

## Security Considerations

### API Key Protection

1. **Server-Side Storage**: API keys are stored in environment variables, never exposed to client
2. **Format Validation**: Keys are validated for format before use
3. **Connectivity Testing**: Validation endpoint tests actual connectivity

### Rate Limiting Benefits

1. **Abuse Prevention**: Server-side rate limiting cannot be bypassed by clients
2. **Cost Control**: Prevents unexpected API charges from runaway clients
3. **Fair Usage**: Ensures fair resource allocation across users

### Logging and Auditing

1. **Complete Audit Trail**: All requests are logged with timestamps
2. **Error Tracking**: Failed requests are tracked with error codes
3. **Usage Analytics**: Provides insights into API usage patterns

## Migration Guide

### From Client-Side to Server Proxy

1. **Set Environment Variables**:
   ```bash
   AI_PROXY_ENABLED=true
   GOOGLE_AI_API_KEY=your_key
   OPENAI_API_KEY=your_key
   ```

2. **Update AI Provider Calls**:
   ```typescript
   // Before (client-side)
   const response = await fetch(providerUrl, {
     headers: { 'Authorization': `Bearer ${apiKey}` }
   });

   // After (server proxy)
   const response = await makeProxyRequest({
     provider: 'openai',
     endpoint: 'chat/completions',
     body: { /* ... */ }
   });
   ```

3. **Handle Rate Limits**:
   ```typescript
   try {
     await makeProxyRequest(config);
   } catch (error) {
     if (error instanceof RateLimitError) {
       // Handle rate limiting
       console.log(`Retry after ${error.retryAfter} seconds`);
     }
   }
   ```

## Testing

### Manual Testing

```bash
# Check proxy status
curl http://localhost:3000/api/ai-proxy?action=status

# Validate API key
curl http://localhost:3000/api/ai-proxy/validate?provider=openai

# Make a test request
curl -X POST http://localhost:3000/api/ai-proxy \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "openai",
    "endpoint": "chat/completions",
    "model": "gpt-4o",
    "body": {
      "messages": [{"role": "user", "content": "Hello!"}],
      "max_tokens": 10
    }
  }'
```

### Automated Testing

```typescript
import { describe, it, expect } from '@jest/globals';
import { makeProxyRequest } from '@/lib/ai-proxy-client';

describe('AI Proxy', () => {
  it('should check proxy status', async () => {
    const status = await checkProxyStatus();
    expect(status.serverProxyEnabled).toBeDefined();
  });

  it('should handle rate limiting', async () => {
    // Make multiple requests to trigger rate limit
    // ...
  });
});
```

## Troubleshooting

### Common Issues

**Provider Not Configured (503)**
- Check that API keys are set in environment variables
- Verify `AI_PROXY_ENABLED=true` is set
- Restart the server after setting environment variables

**Rate Limit Exceeded (429)**
- Check rate limit configuration
- Wait for the window to reset (see `Retry-After` header)
- Consider increasing limits if appropriate

**Network Errors (502)**
- Verify provider API is accessible from server
- Check firewall/proxy settings on server
- Verify API key is valid using validation endpoint

### Debug Logging

Enable debug logging by checking server logs:
```bash
# Server logs will show:
AI Proxy POST error: ...
AI Proxy validation error: ...
```

## Future Enhancements

Potential improvements for future iterations:

1. **Persistent Storage**: Integrate with database for long-term usage tracking
2. **User Authentication**: Integrate with full authentication system
3. **Quota Management**: Per-user quotas and limits
4. **Analytics Dashboard**: Visual usage analytics and cost tracking
5. **Caching**: Response caching for identical requests
6. **Load Balancing**: Multiple API keys for high-volume providers
7. **Webhook Notifications**: Alerts for rate limits and errors

## Related Files

- `src/lib/server-api-key-storage.ts` - Server-side API key management
- `src/lib/server-rate-limiter.ts` - Rate limiting implementation
- `src/lib/server-usage-logger.ts` - Usage tracking and logging
- `src/app/api/ai-proxy/route.ts` - Main proxy API route
- `src/app/api/ai-proxy/validate/route.ts` - Validation endpoint
- `src/lib/ai-proxy-client.ts` - Client utilities
- `src/lib/env.ts` - Environment configuration

## References

- Issue #522: Implement server-side API key validation and proxy for AI calls
- Issue #48: Implement secure local storage for API keys
- Issue #51: Add usage tracking per provider
- Issue #526: Add rate limiting and debouncing for AI API calls
