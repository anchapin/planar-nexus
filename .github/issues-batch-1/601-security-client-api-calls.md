# Security - Remove Client-Side AI API Calls with Exposed Keys

**Priority:** 🔴 CRITICAL  
**Labels:** `critical`, `security`, `ai`  
**Milestone:** v0.2.0 Security  
**Estimated Effort:** 2-3 days

---

## Description

Client-side AI provider files contain direct API calls that expose API keys in browser code. This is a **critical security vulnerability** that could lead to unauthorized API usage and financial loss.

API keys exposed in client-side code can be extracted from browser DevTools Network tab, leading to:
- Unauthorized usage of paid AI APIs
- Potential financial loss
- Violation of API provider terms of service
- Security breach for users who trust the platform with their keys

---

## Affected Files

- `src/ai/providers/openai.ts` (line 124)
- `src/ai/providers/google.ts` (line 158)
- `src/ai/providers/zaic.ts` (line 125, 175)
- `src/ai/providers/index.ts` (indirect usage)

---

## Current Problematic Code

```typescript
// ❌ BAD - Current implementation in zaic.ts:175
export async function sendZAIChatStream(
  config: ZAIProviderConfig,
  request: Omit<ZAIChatRequest, 'model'>
): Promise<ZAIChatResponse> {
  // Direct API call with exposed key!
  const response = await fetch(`${API_ENDPOINTS.ZAI}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`, // EXPOSED IN CLIENT!
    },
    body: JSON.stringify({
      model: config.model || DEFAULT_MODELS.zaic,
      ...request,
    }),
  });
  // ...
}
```

---

## Required Changes

### 1. Remove Direct API Calls
- [ ] Remove `sendZAIChatStream` direct fetch implementation
- [ ] Remove `sendOpenAIChat` direct fetch implementation  
- [ ] Remove `sendGoogleAIRequest` direct fetch implementation
- [ ] Force all AI requests through `/api/ai-proxy` endpoint

### 2. Update Provider Files
- [ ] Update `src/ai/providers/zaic.ts` to use proxy only
- [ ] Update `src/ai/providers/openai.ts` to use proxy only
- [ ] Update `src/ai/providers/google.ts` to use proxy only
- [ ] Remove any fallback to direct API calls

### 3. Audit All API Calls
- [ ] Run grep to find all fetch calls: `grep -r "fetch.*api\." src/`
- [ ] Check for any hardcoded API endpoints
- [ ] Verify no API keys in client bundle

### 4. Update Tests
- [ ] Add tests to verify no direct API calls from client
- [ ] Update existing tests to mock proxy instead of direct API
- [ ] Add security audit test

---

## Implementation Example

```typescript
// ✅ GOOD - Should use proxy
export async function sendZAIChatStream(
  config: ZAIProviderConfig,
  request: Omit<ZAIChatRequest, 'model'>
): Promise<ZAIChatResponse> {
  const proxyResponse = await callAIProxy<ZAIChatResponse>({
    provider: 'zaic',
    endpoint: 'chat/completions',
    model: config.model || DEFAULT_MODELS.zaic,
    body: {
      messages: request.messages,
      max_tokens: config.maxTokens || request.maxTokens,
      temperature: config.temperature || request.temperature,
    },
  });

  if (!proxyResponse.success) {
    throw new Error(`ZAI Proxy error: ${proxyResponse.error}`);
  }

  if (!proxyResponse.data) {
    throw new Error('ZAI Proxy returned no data');
  }

  return proxyResponse.data;
}
```

---

## Acceptance Criteria

- [ ] **Zero** direct API calls to AI providers from client-side code
- [ ] **No** API keys visible in browser DevTools Network tab
- [ ] **All** AI requests route through `/api/ai-proxy`
- [ ] **No** regression in AI functionality (all features still work)
- [ ] **Security audit** passes - no keys in client bundle
- [ ] **Tests** verify proxy-only usage

---

## Testing Steps

1. Open browser DevTools
2. Go to Network tab
3. Use any AI feature (Deck Coach, AI Opponent, etc.)
4. Verify requests go to `/api/ai-proxy` NOT external APIs
5. Verify no API keys in request headers
6. Verify AI features still work correctly

---

## Related Issues

- #522 (Server-side API key proxy)
- #543 (AI Proxy integration)
- #603 (Add API key validation)
- #605 (Move API endpoints server-side)

---

## Security Notes

⚠️ **This is a critical security vulnerability.** API keys should **never** be exposed in client-side code. Users who input their API keys trust the platform to keep them secure. This fix is required before any production deployment.

---

## References

- [OWASP: Don't Store Secrets in Client-Side Code](https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html)
- [Best Practices for API Key Security](https://docs.github.com/en/code-security/secret-scanning/about-secret-scanning)
