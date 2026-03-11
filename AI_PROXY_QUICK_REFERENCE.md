# AI Proxy Quick Reference

## Setup (Server Environment)

```bash
# Enable the proxy
export AI_PROXY_ENABLED=true

# Set server-side API keys (NEVER expose these)
export GOOGLE_AI_API_KEY="your_google_key"
export OPENAI_API_KEY="sk-your_openai_key"
export ZAI_API_KEY="your_zai_key"

# Optional: Configure rate limits
export AI_RATE_LIMIT_MAX=100        # Requests per window
export AI_RATE_LIMIT_WINDOW_MS=60000  # Window size (ms)

# Start the server
npm run dev
```

---

## API Endpoints

### Check Proxy Status
```bash
GET /api/ai-proxy?action=status
```

Response:
```json
{
  "success": true,
  "serverProxyEnabled": true,
  "configuredProviders": ["openai", "google"],
  "availableProviders": ["google", "openai", "zaic", "custom"]
}
```

### Validate API Key
```bash
GET /api/ai-proxy/validate?provider=openai
```

Response:
```json
{
  "success": true,
  "provider": "openai",
  "valid": true,
  "message": "API key is valid and working"
}
```

### Proxy AI Request
```bash
POST /api/ai-proxy
Content-Type: application/json

{
  "provider": "openai",
  "endpoint": "chat/completions",
  "model": "gpt-4o",
  "body": {
    "messages": [
      {"role": "user", "content": "Hello!"}
    ],
    "max_tokens": 100
  }
}
```

Response:
```json
{
  "success": true,
  "data": { /* AI response */ },
  "usage": {
    "inputTokens": 10,
    "outputTokens": 25,
    "totalTokens": 35
  },
  "rateLimit": {
    "remaining": 99,
    "resetAt": 1678901234567
  }
}
```

---

## Client-Side Usage

### Basic Usage

```typescript
import { makeProxyRequest } from '@/lib/ai-proxy-client';

const response = await makeProxyRequest({
  provider: 'openai',
  endpoint: 'chat/completions',
  model: 'gpt-4o',
  body: {
    messages: [{ role: 'user', content: 'Hello!' }],
    max_tokens: 100,
  },
});

if (response.success) {
  console.log(response.data);
  console.log('Tokens:', response.usage);
  console.log('Rate limit:', response.rateLimit?.remaining);
}
```

### With Error Handling

```typescript
import { 
  makeProxyRequest, 
  RateLimitError,
  ProviderNotConfiguredError 
} from '@/lib/ai-proxy-client';

try {
  const response = await makeProxyRequest({
    provider: 'openai',
    endpoint: 'chat/completions',
    model: 'gpt-4o',
    body: { messages: [{ role: 'user', content: 'Hello!' }] },
  });
  
  if (!response.success) {
    throw new Error(response.error);
  }
  
  return response.data;
} catch (error) {
  if (error instanceof RateLimitError) {
    console.log(`Rate limited. Wait ${error.retryAfter}s`);
    // Implement retry logic
  } else if (error instanceof ProviderNotConfiguredError) {
    console.log('Provider not configured on server');
    // Fall back to client-side or show error
  } else {
    console.error('AI request failed:', error);
    throw error;
  }
}
```

### Smart Request with Fallback

```typescript
import { smartAIRequest } from '@/lib/ai-proxy-client';

// Automatically uses server proxy if available,
// otherwise falls back to client-side
const result = await smartAIRequest(
  {
    provider: 'openai',
    endpoint: 'chat/completions',
    model: 'gpt-4o',
    body: { messages: [{ role: 'user', content: 'Hello!' }] },
  },
  // Client-side fallback function
  async () => {
    return callOpenAIClientSide();
  }
);
```

### Check Proxy Status

```typescript
import { checkProxyStatus } from '@/lib/ai-proxy-client';

const status = await checkProxyStatus();

if (status.serverProxyEnabled) {
  console.log('Proxy is enabled');
  console.log('Configured providers:', status.configuredProviders);
} else {
  console.log('Proxy is disabled, using client-side');
}
```

### Validate Server API Key

```typescript
import { validateServerApiKey } from '@/lib/ai-proxy-client';

const result = await validateServerApiKey('openai');

if (result.valid) {
  console.log('Server API key is valid');
} else {
  console.log('Server API key validation failed:', result.error);
}
```

---

## Error Codes

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

---

## Rate Limit Headers

All responses include rate limit headers:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1678901234567
Retry-After: 60  (only on 429 responses)
```

Access via:
```typescript
const response = await makeProxyRequest(...);
// Headers are included in the response object
```

---

## Usage Tracking

Access usage statistics:

```typescript
import { getProviderUsageStats, getUsageSummary } from '@/lib/server-usage-logger';

// Get stats for specific provider
const stats = await getProviderUsageStats('openai', 30);
console.log('Total requests:', stats.totalRequests);
console.log('Total tokens:', stats.totalTokens);
console.log('Total cost:', stats.totalCost);

// Get overall summary
const summary = await getUsageSummary(30);
console.log('All providers:', summary);
```

---

## Configuration Reference

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AI_PROXY_ENABLED` | Enable server proxy | `false` |
| `GOOGLE_AI_API_KEY` | Google AI API key | - |
| `OPENAI_API_KEY` | OpenAI API key | - |
| `ZAI_API_KEY` | Z.ai API key | - |
| `CUSTOM_AI_API_KEY` | Custom provider API key | - |
| `AI_RATE_LIMIT_MAX` | Default max requests | `100` |
| `AI_RATE_LIMIT_WINDOW_MS` | Default window (ms) | `60000` |
| `AI_RATE_LIMIT_TTL_MS` | Rate limit cache TTL | `300000` |
| `AI_RATE_LIMIT_MAX_GOOGLE` | Google-specific limit | - |
| `AI_RATE_LIMIT_MAX_OPENAI` | OpenAI-specific limit | - |
| `AI_RATE_LIMIT_MAX_ZAI` | Z.ai-specific limit | - |

---

## Troubleshooting

### Provider Not Configured (503)
```bash
# Check environment variables
echo $OPENAI_API_KEY

# Verify AI_PROXY_ENABLED
echo $AI_PROXY_ENABLED

# Restart server after setting variables
```

### Rate Limit Exceeded (429)
```typescript
// Wait for retry period
if (error instanceof RateLimitError) {
  await sleep(error.retryAfter * 1000);
  // Retry request
}
```

### Network Error (502)
- Check server can reach provider API
- Verify firewall settings
- Test API key with validation endpoint

---

## Files Reference

- `src/lib/server-api-key-storage.ts` - API key management
- `src/lib/server-rate-limiter.ts` - Rate limiting
- `src/lib/server-usage-logger.ts` - Usage tracking
- `src/app/api/ai-proxy/route.ts` - Main proxy endpoint
- `src/app/api/ai-proxy/validate/route.ts` - Validation endpoint
- `src/lib/ai-proxy-client.ts` - Client utilities
- `ISSUE_522_IMPLEMENTATION.md` - Full documentation
