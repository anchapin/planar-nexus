# Clean Up Dead Code and Unused Imports

**Priority:** 🟠 HIGH  
**Labels:** `high`, `code-quality`, `cleanup`  
**Milestone:** v0.2.0 Quality  
**Estimated Effort:** 2 days

---

## Description

Codebase contains **50+ unused imports**, dead code from previous implementations, and stub code that's never used. This increases bundle size and maintenance burden.

---

## Affected Files

### Files with Unused Imports (from ESLint)
- `src/ai/flows/ai-gameplay-assistance.ts` - 2 unused
- `src/ai/flows/ai-post-game-analysis.ts` - 4 unused
- `src/ai/providers/google.ts` - 1 unused
- `src/app/(app)/deck-builder/_components/card-search.tsx` - 2 unused
- `src/app/(app)/game/[id]/page.tsx` - 12 unused
- `src/app/(app)/multiplayer/host/page.tsx` - 1 unused
- `src/app/(app)/multiplayer/join/page.tsx` - 1 unused
- `src/app/(app)/settings/page.tsx` - 2 unused
- `src/app/api/ai-proxy/route.ts` - 6 unused
- `src/components/connection-data-entry.tsx` - 5 unused
- `src/components/connection-status-indicator.tsx` - 2 unused
- And many more...

### Dead Code Files
- `src/ai/genkit.ts` - Contains stub code never used
- `src/ai/game-state-evaluator-example.ts` - Example file not used
- `src/ai/decision-making/combat-examples.ts` - Example file not used
- `src/ai/decision-making/COMBAT_AI.md` - Documentation for incomplete features

---

## Current Problematic Code

```typescript
// src/ai/genkit.ts - Stub code never used
const googleAiPluginStub: any = {
  name: 'google-ai',
  // ... never imported or used
};

// src/app/(app)/game/[id]/page.tsx - Unused imports
import {
  serializeGameState,      // ❌ Never used
  deserializeGameState,    // ❌ Never used
  gainLife,               // ❌ Never used
  dealDamageToPlayer,     // ❌ Never used
  emptyManaPool,          // ❌ Never used
  canCastSpell,           // ❌ Never used
  canPlayLand,            // ❌ Never used
  Player,                 // ❌ Never used
  Phase,                  // ❌ Never used
  // ... more unused imports
} from '@/lib/game-state';
```

---

## Required Changes

### Step 1: Run ESLint and Fix

```bash
# Find all unused variables
npm run lint 2>&1 | grep "no-unused-vars"

# Auto-fix where possible
npx eslint src/ --fix
```

### Step 2: Remove Unused Imports

```typescript
// ❌ Before
import { Button, Card, Input } from "@/components/ui";
import { useState, useEffect, useCallback } from "react";

// ✅ After
import { Button, Card } from "@/components/ui";
import { useState } from "react";
```

### Step 3: Remove Dead Code Files

```bash
# Move or delete example files
mv src/ai/game-state-evaluator-example.ts src/ai/__examples__/
mv src/ai/decision-making/combat-examples.ts src/ai/decision-making/__examples__/

# Delete stub files
rm src/ai/genkit.ts  # If truly unused
```

### Step 4: Clean Up Components

```typescript
// src/components/connection-status-indicator.tsx
// ❌ Remove unused eslint-disable
// eslint-disable-next-line no-fallthrough  // No fallthrough exists

// Remove unused functions
const getConnectionStateIcon = (state: ConnectionState) => {
  // Never called
};
```

---

## Acceptance Criteria

- [ ] **Zero ESLint** unused-vars warnings
- [ ] **Reduced bundle size** (measure before/after)
- [ ] **Cleaner codebase** - easier to navigate
- [ ] **No broken imports** after cleanup
- [ ] **All tests passing**
- [ ] **Documentation updated** if removing files

---

## Verification

### Before Cleanup
```bash
npm run lint 2>&1 | grep "no-unused-vars" | wc -l
# Should show 50+ warnings
```

### After Cleanup
```bash
npm run lint 2>&1 | grep "no-unused-vars" | wc -l
# Should show 0 warnings
```

### Bundle Size
```bash
npm run build
# Check bundle size in .next/
```

---

## Related Issues

- #525 (Remove unused imports and variables)
- #608 (Remove console logs from production)

---

## Prevention

### ESLint Configuration
```javascript
// eslint.config.mjs
rules: {
  '@typescript-eslint/no-unused-vars': ['error', {
    argsIgnorePattern: '^_',
    varsIgnorePattern: '^_',
  }],
}
```

### Pre-commit Hook
```json
// .husky/pre-commit
#!/bin/sh
npm run lint
```

---

## Rollout Plan

### Day 1: Automated Cleanup
1. Run ESLint with --fix
2. Remove obviously unused imports
3. Update tsconfig paths if needed

### Day 2: Manual Review
1. Review each file manually
2. Remove dead code files
3. Test all features still work
4. Run full test suite

---

## Risk Mitigation

### Risk: Breaking Imports
**Mitigation:** Run typecheck after each change
```bash
npm run typecheck
```

### Risk: Removing Used Code
**Mitigation:** 
1. Search for usages before deleting
2. Use IDE "Find Usages" feature
3. Test after each removal

### Risk: Breaking Tests
**Mitigation:** Run tests after cleanup
```bash
npm test
```

---

## Tools

### Find Unused Exports
```bash
# Using ts-prune
npx ts-prune
```

### Find Dead Code
```bash
# Using unimported
npx unimported
```

### Bundle Analysis
```bash
# Using webpack-bundle-analyzer
npm install --save-dev webpack-bundle-analyzer
npm run build -- --analyze
```
