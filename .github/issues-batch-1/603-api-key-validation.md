# Add API Key Format Validation Before Usage

**Priority:** 🔴 CRITICAL  
**Labels:** `critical`, `security`, `ai`, `validation`  
**Milestone:** v0.2.0 Security  
**Estimated Effort:** 1 day

---

## Description

The AI proxy route (`src/app/api/ai-proxy/route.ts`) doesn't validate API key format before making requests to external APIs. This causes:
- Unnecessary API calls with invalid keys
- Wasted API quota
- Poor user experience with cryptic error messages from external APIs
- Potential rate limiting from providers due to invalid requests

---

## Affected Files

- `src/app/api/ai-proxy/route.ts` (lines 145-160)
- `src/lib/server-api-key-storage.ts` (has `validateApiKeyFormat()` not being used)

---

## Current Code (Missing Validation)

```typescript
// src/app/api/ai-proxy/route.ts - Lines 145-160
export async function POST(request: NextRequest): Promise<NextResponse> {
  // ... parse body ...
  
  const { provider, endpoint, model, userId = 'anonymous' } = body;
  
  // Check if provider is configured on server
  const config = await getProviderConfig(provider as AIProvider, userId);
  
  if (!config) {
    return NextResponse.json(
      { success: false, error: 'Provider not configured' },
      { status: 400 }
    );
  }
  
  // ❌ Missing: API key format validation!
  // Request goes directly to external API without validation
  
  const externalResponse = await fetch(`${PROVIDER_ENDPOINTS[provider]}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      // ...
    },
    body: JSON.stringify(body.body),
  });
  // ...
}
```

---

## Required Changes

### 1. Import Validation Function
```typescript
import {
  getProviderConfig,
  validateApiKeyFormat,  // ✅ Add this import
} from '@/lib/server-api-key-storage';
```

### 2. Add Validation Before External API Call
```typescript
// Check if provider is configured
const config = await getProviderConfig(provider as AIProvider, userId);

if (!config) {
  return NextResponse.json(
    { success: false, error: 'Provider not configured' },
    { status: 400 }
  );
}

// ✅ Add format validation
const isValid = validateApiKeyFormat(provider as AIProvider, config.apiKey);
if (!isValid) {
  return NextResponse.json(
    { 
      success: false, 
      error: 'Invalid API key format',
      errorCode: 'INVALID_API_KEY_FORMAT',
      hint: getApiKeyFormatHint(provider)
    },
    { status: 400 }
  );
}

// Now safe to make external API call
const externalResponse = await fetch(...);
```

### 3. Add Helper Function for Format Hints
```typescript
function getApiKeyFormatHint(provider: AIProvider): string {
  switch (provider) {
    case 'google':
      return 'Google AI keys start with "AIza"';
    case 'openai':
      return 'OpenAI keys start with "sk-"';
    case 'zaic':
      return 'Z.ai keys are 32-character alphanumeric strings';
    default:
      return 'Please check your API key format';
  }
}
```

---

## Acceptance Criteria

- [ ] Invalid API keys **rejected before** external API call
- [ ] **Clear error messages** shown to users with format hints
- [ ] **No wasted API quota** on invalid keys
- [ ] **Tests** cover all validation scenarios:
  - [ ] Valid key format passes
  - [ ] Invalid key format rejected
  - [ ] Empty key rejected
  - [ ] Malformed key rejected
- [ ] **No regression** in valid key functionality

---

## Test Cases

### Unit Tests
```typescript
// src/app/api/ai-proxy/__tests__/route.test.ts
describe('API Key Validation', () => {
  it('should reject invalid Google API key format', async () => {
    const response = await makeRequest({
      provider: 'google',
      apiKey: 'invalid-key-format',
    });
    
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid API key format');
  });
  
  it('should reject invalid OpenAI API key format', async () => {
    const response = await makeRequest({
      provider: 'openai',
      apiKey: 'not-starting-with-sk',
    });
    
    expect(response.status).toBe(400);
  });
  
  it('should accept valid API key format', async () => {
    const response = await makeRequest({
      provider: 'openai',
      apiKey: 'sk-valid-key-format-12345',
    });
    
    // Should proceed to external API
  });
});
```

---

## API Key Format Examples

### Google AI
- **Format:** `AIzaSy...` (39 characters)
- **Example:** `AIzaSyDaGmWKa4JsXZ-HjGw7ISLn_3namBGewQe`

### OpenAI
- **Format:** `sk-...` (variable length)
- **Example:** `sk-proj-abcdefghijklmnopqrstuvwxyz123456789`

### Z.ai
- **Format:** 32-character alphanumeric
- **Example:** `abc123def456ghi789jkl012mno345pq`

---

## Error Response Format

```json
{
  "success": false,
  "error": "Invalid API key format",
  "errorCode": "INVALID_API_KEY_FORMAT",
  "hint": "OpenAI keys start with 'sk-'",
  "provider": "openai"
}
```

---

## Related Issues

- #522 (Server-side API key proxy)
- #601 (Remove client-side API calls)
- #605 (Move API endpoints server-side)

---

## Security Benefits

1. **Prevents Wasted Quota:** Invalid keys don't consume API quota
2. **Better UX:** Users get helpful error messages immediately
3. **Reduced Latency:** No need to wait for external API to reject
4. **Rate Limit Protection:** Fewer invalid requests to providers
