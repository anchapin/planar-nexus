# Move API Endpoints to Server-Side Only

**Priority:** 🔴 CRITICAL  
**Labels:** `critical`, `security`, `configuration`  
**Milestone:** v0.2.0 Security  
**Estimated Effort:** 2 days

---

## Description

API endpoints use `NEXT_PUBLIC_` environment variables, which are **bundled into client-side JavaScript**. This exposes infrastructure details and makes it harder to change endpoints without rebuilding.

While not as critical as exposed API keys, this is still a security best practice violation and should be fixed.

---

## Affected Files

### Configuration Files
- `src/lib/env.ts` (lines 13-19)

### Files Importing API_ENDPOINTS
- `src/ai/providers/openai.ts`
- `src/ai/providers/google.ts`
- `src/ai/providers/zaic.ts`
- `src/app/api/ai-proxy/route.ts`
- `src/lib/ai-proxy-client.ts`
- Any other files making external API calls

---

## Current Problematic Code

```typescript
// src/lib/env.ts
export const API_ENDPOINTS = {
  ZAI: process.env.NEXT_PUBLIC_ZAI_API_URL || 'https://api.z-ai.com/v1',
  OPENAI: process.env.NEXT_PUBLIC_OPENAI_API_URL || 'https://api.openai.com/v1',
  GOOGLE: process.env.NEXT_PUBLIC_GOOGLE_API_URL || 'https://generativelanguage.googleapis.com/v1',
};
```

### Why This is a Problem

1. **NEXT_PUBLIC_ variables are client-side**: Any `NEXT_PUBLIC_` environment variable is embedded in the JavaScript bundle sent to browsers
2. **Infrastructure exposure**: Attackers can see your API endpoints
3. **Harder to rotate**: Changing endpoints requires full rebuild
4. **Security through obscurity lost**: While not secret, endpoints should not be public

---

## Required Changes

### Step 1: Update Environment Variables

#### .env.example
```bash
# ❌ OLD - Client-side
# NEXT_PUBLIC_ZAI_API_URL=https://api.z-ai.com/v1
# NEXT_PUBLIC_OPENAI_API_URL=https://api.openai.com/v1
# NEXT_PUBLIC_GOOGLE_API_URL=https://generativelanguage.googleapis.com/v1

# ✅ NEW - Server-side only
ZAI_API_URL=https://api.z-ai.com/v1
OPENAI_API_URL=https://api.openai.com/v1
GOOGLE_API_URL=https://generativelanguage.googleapis.com/v1
```

### Step 2: Update env.ts

```typescript
// src/lib/env.ts

// ❌ OLD - Client-side accessible
export const API_ENDPOINTS = {
  ZAI: process.env.NEXT_PUBLIC_ZAI_API_URL || 'https://api.z-ai.com/v1',
  OPENAI: process.env.NEXT_PUBLIC_OPENAI_API_URL || 'https://api.openai.com/v1',
  GOOGLE: process.env.NEXT_PUBLIC_GOOGLE_API_URL || 'https://generativelanguage.googleapis.com/v1',
};

// ✅ NEW - Server-side only
// Remove this file entirely or make it server-only
// API endpoints should only be accessed in:
// - Server Actions
// - API Routes
// - Server Components
```

### Step 3: Update All API Calls

#### For Server-Side Code (API Routes, Server Actions)
```typescript
// src/app/api/ai-proxy/route.ts

// ✅ Direct access in server code
const ZAI_API_URL = process.env.ZAI_API_URL || 'https://api.z-ai.com/v1';

const response = await fetch(`${ZAI_API_URL}/chat/completions`, {
  // ...
});
```

#### For Client-Side Code
```typescript
// ❌ Client should NOT make direct API calls
// This should be fixed in Issue #601

// ✅ Client should call /api/ai-proxy instead
const response = await callAIProxy({
  provider: 'zaic',
  endpoint: 'chat/completions',
  // ...
});
```

### Step 4: Update .env.example

```bash
# AI Provider API Keys (Server-side only)
ZAI_API_KEY=
OPENAI_API_KEY=
GOOGLE_API_KEY=

# AI Provider API URLs (Server-side only)
ZAI_API_URL=https://api.z-ai.com/v1
OPENAI_API_URL=https://api.openai.com/v1
GOOGLE_API_URL=https://generativelanguage.googleapis.com/v1

# DO NOT use NEXT_PUBLIC_ prefix for sensitive configuration
```

---

## Acceptance Criteria

- [ ] **No** `NEXT_PUBLIC_` API endpoints in client bundle
- [ ] **All** external API calls go through server
- [ ] **Environment variables** documented in .env.example
- [ ] **No regression** in API functionality
- [ ] **Build** completes successfully
- [ ] **Tests** pass

---

## Verification Steps

### 1. Check Client Bundle
```bash
npm run build
grep -r "NEXT_PUBLIC" .next/static/
# Should find NO API endpoints
```

### 2. Check Environment Variables
```bash
# In production, verify these are set server-side:
echo $ZAI_API_URL
echo $OPENAI_API_URL
echo $GOOGLE_API_URL
```

### 3. Test API Calls
```bash
# Test all AI features still work:
- AI Deck Coach
- AI Opponent
- AI Gameplay Assistance
- AI Post-Game Analysis
```

---

## Migration Guide

### For Developers

1. **Update your local .env file:**
```bash
# Remove old variables
# NEXT_PUBLIC_ZAI_API_URL=...

# Add new variables
ZAI_API_URL=https://api.z-ai.com/v1
```

2. **Update deployment configuration:**
   - Vercel: Update environment variables in dashboard
   - Firebase: Update in Firebase Console
   - Docker: Update in docker-compose.yml or .env

3. **Rebuild the application:**
```bash
npm run build
```

---

## Related Issues

- #519 (Move hardcoded API URLs to env variables)
- #601 (Remove client-side API calls)
- #603 (Add API key validation)

---

## Security Benefits

1. **Reduced Attack Surface:** API endpoints not visible in client bundle
2. **Better Security Posture:** Follows security best practices
3. **Easier Key Rotation:** Can change endpoints without client update
4. **Compliance:** Better alignment with security standards

---

## Notes

This issue should be completed **after** Issue #601 (Remove client-side API calls), as that issue removes all direct client API calls. Once all API calls go through the server proxy, moving endpoint configuration to server-side is straightforward.
