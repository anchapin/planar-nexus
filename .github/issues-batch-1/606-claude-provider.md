# Implement or Remove Claude AI Provider

**Priority:** 🔴 CRITICAL  
**Labels:** `critical`, `documentation`, `ai`  
**Milestone:** v0.2.0 Features  
**Estimated Effort:** Option A: 3-4 days | Option B: 0.5 days

---

## Description

README.md claims "**Claude API integration via Anthropic SDK**" but **no Claude provider exists** in the codebase. This is misleading to users.

---

## Evidence

### README.md Claims
> "Bring Your Own Key - Use your own API keys from **Claude**, Copilot, Gemini, Z.ai, and more"

### GAP_ANALYSIS_ISSUES.md References
> Issue #517: "Fix or remove non-functional Claude AI provider"

### Code Search Results
```bash
grep -r "claude\|anthropic\|Anthropic" src/
# No matches found
```

### Provider Files That Exist
- ✅ `src/ai/providers/google.ts` - Implemented
- ✅ `src/ai/providers/openai.ts` - Implemented
- ✅ `src/ai/providers/zaic.ts` - Implemented
- ❌ `src/ai/providers/claude.ts` - **MISSING**

---

## Options

### Option A: Implement Claude Provider (Recommended if high demand)

#### Step 1: Create Claude Provider File
```typescript
// src/ai/providers/claude.ts
import { callAIProxy } from '@/lib/ai-proxy-client';
import type { AIProviderConfig } from './types';

export interface ClaudeProviderConfig extends AIProviderConfig {
  provider: 'claude';
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ClaudeMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ClaudeChatRequest {
  model: string;
  messages: ClaudeMessage[];
  max_tokens: number;
  temperature?: number;
  system?: string;
}

export interface ClaudeChatResponse {
  id: string;
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  content: {
    type: 'text';
    text: string;
  }[];
}

/**
 * Send chat completion to Claude via server-side proxy
 */
export async function sendClaudeChat(
  config: ClaudeProviderConfig,
  request: Omit<ClaudeChatRequest, 'model'>
): Promise<ClaudeChatResponse> {
  const proxyResponse = await callAIProxy<ClaudeChatResponse>({
    provider: 'claude',
    endpoint: 'messages',
    model: config.model || 'claude-sonnet-4-20250514',
    body: {
      model: config.model || 'claude-sonnet-4-20250514',
      messages: request.messages,
      max_tokens: config.maxTokens || request.max_tokens || 4096,
      temperature: config.temperature || request.temperature || 0.7,
      system: request.system,
    },
  });

  if (!proxyResponse.success) {
    throw new Error(`Claude Proxy error: ${proxyResponse.error}`);
  }

  if (!proxyResponse.data) {
    throw new Error('Claude Proxy returned no data');
  }

  return proxyResponse.data;
}

/**
 * Extract text from Claude response
 */
export function claudeResponseToText(response: ClaudeChatResponse): string {
  return response.content?.[0]?.text || '';
}

/**
 * Claude model options
 */
export const CLAUDE_MODELS = {
  'claude-sonnet-4-20250514': [
    'claude-sonnet-4-20250514',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
  ],
};
```

#### Step 2: Update Provider Types
```typescript
// src/ai/providers/types.ts
export type AIProvider = 'google' | 'openai' | 'zaic' | 'claude' | 'custom';

export const DEFAULT_CONFIGS: Record<AIProvider, AIProviderConfig> = {
  // ... existing configs
  claude: {
    provider: 'claude',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 4096,
    temperature: 0.7,
  },
  // ...
};
```

#### Step 3: Update Provider Index
```typescript
// src/ai/providers/index.ts
export * from './claude'; // Add this line

export function getAvailableProviders(): AIProvider[] {
  return ['google', 'openai', 'zaic', 'claude']; // Add claude
}
```

#### Step 4: Update UI
```typescript
// src/app/(app)/settings/page.tsx
// Add Claude to provider selection dropdown
<SelectItem value="claude">Claude (Anthropic)</SelectItem>
```

#### Step 5: Add Tests
```typescript
// src/ai/providers/__tests__/claude.test.ts
describe('Claude Provider', () => {
  it('should send chat request via proxy', async () => {
    // Test implementation
  });
  
  it('should extract text from response', () => {
    // Test implementation
  });
});
```

---

### Option B: Remove References (Recommended if low priority)

#### Step 1: Update README.md
```markdown
# Before
Bring Your Own Key - Use your own API keys from Claude, Copilot, Gemini, Z.ai, and more

# After
Bring Your Own Key - Use your own API keys from Gemini, OpenAI, Z.ai, and more

Coming Soon: Claude, Copilot support
```

#### Step 2: Update UI
Remove Claude from any provider selection dropdowns or documentation.

#### Step 3: Update Documentation
Update all documentation to reflect actual available providers.

---

## Acceptance Criteria

### Option A (Implement)
- [ ] Claude provider file created
- [ ] Claude added to provider types
- [ ] Claude added to provider switching UI
- [ ] Tests written and passing
- [ ] Documentation updated
- [ ] Claude actually works (tested with real API key)

### Option B (Remove)
- [ ] README.md updated to remove Claude references
- [ ] UI updated to remove Claude from dropdowns
- [ ] Documentation updated
- [ ] "Coming Soon" added if planned for future

---

## Recommendation

**Option B (Remove References)** is recommended unless there is specific user demand for Claude.

**Rationale:**
1. Three existing providers (Google, OpenAI, Z.ai) already cover major use cases
2. Implementing Claude properly requires ongoing maintenance
3. Better to have fewer, well-maintained providers than many incomplete ones
4. Can always add Claude later when there's more demand

If there is specific user demand for Claude, use **Option A**.

---

## Related Issues

- #517 (Fix or remove non-functional Claude provider)
- #601 (Remove client-side API calls) - Claude should use proxy if implemented

---

## Anthropic API Reference

- **Base URL:** `https://api.anthropic.com/v1`
- **Auth Header:** `x-api-key: YOUR_KEY`
- **Endpoint:** `/messages`
- **Models:** claude-sonnet-4-20250514, claude-3-5-sonnet-20241022, etc.
- **Docs:** https://docs.anthropic.com/claude/reference/messages_post
