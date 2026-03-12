# Remove 650+ Console Logs from Production Code

**Priority:** 🟠 HIGH  
**Labels:** `high`, `code-quality`, `performance`  
**Milestone:** v0.2.0 Quality  
**Estimated Effort:** 3-4 days

---

## Description

Production code contains **650+ console.log statements** that:
- Clutter browser console
- Impact performance from string formatting
- Potentially leak sensitive information
- Make debugging harder (signal-to-noise ratio)

---

## Affected Files (Top Offenders)

| File | Log Count | Lines |
|------|-----------|-------|
| `src/ai/game-state-evaluator-example.ts` | 200+ | 377-591 |
| `src/ai/decision-making/combat-examples.ts` | 100+ | Multiple |
| `src/app/(app)/game/[id]/page.tsx` | 50+ | Multiple |
| `src/lib/game-state/*.ts` | 150+ | Multiple |
| `src/ai/*.ts` | 150+ | Multiple |

---

## Examples of Problematic Code

```typescript
// src/ai/game-state-evaluator-example.ts:377
console.log('=== Example 1: Basic Game State Evaluation ===\n');
console.log('Total Score:', evaluation.totalScore);
console.log('\nFactor Scores:');
// ... 200+ more lines

// src/app/(app)/game/[id]/page.tsx
console.log('Card clicked:', card);
console.log('Game state:', gameState);
console.log('AI decision:', decision);
```

---

## Required Changes

### Step 1: Create Logging Utility

```typescript
// src/lib/logger.ts
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerConfig {
  level: LogLevel;
  showTimestamp?: boolean;
  enabled?: boolean;
}

class Logger {
  private config: LoggerConfig;

  constructor(config: LoggerConfig = { level: 'info', enabled: true }) {
    this.config = config;
  }

  private shouldLog(level: LogLevel): boolean {
    if (!this.config.enabled) return false;
    
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.config.level);
  }

  private formatMessage(message: string): string {
    if (this.config.showTimestamp) {
      const timestamp = new Date().toISOString();
      return `[${timestamp}] ${message}`;
    }
    return message;
  }

  debug(...args: any[]) {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage(args.join(' ')));
    }
  }

  info(...args: any[]) {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage(args.join(' ')));
    }
  }

  warn(...args: any[]) {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage(args.join(' ')));
    }
  }

  error(...args: any[]) {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage(args.join(' ')));
    }
  }
}

// Export configured logger
export const logger = new Logger({
  level: process.env.NODE_ENV === 'development' ? 'debug' : 'warn',
  showTimestamp: true,
  enabled: true,
});

// Export for testing
export { Logger };
```

### Step 2: Replace Console Logs

```typescript
// ❌ Before
console.log('Card clicked:', card);
console.log('Game state:', gameState);

// ✅ After
import { logger } from '@/lib/logger';

logger.debug('Card clicked:', card);
logger.info('Game state updated:', gameState);
```

### Step 3: Remove Example Files

Files like `game-state-evaluator-example.ts` should be:
- Moved to `__examples__/` directory (excluded from build)
- Or deleted if not needed
- Or marked as dev-only with build exclusion

### Step 4: Update ESLint Configuration

```javascript
// eslint.config.mjs
rules: {
  'no-console': ['error', { 
    allow: ['warn', 'error'] // Only allow warn and error
  }],
}
```

---

## Acceptance Criteria

- [ ] **Zero** console.log in production build
- [ ] **Debug logs** visible in development only
- [ ] **No regression** in debugging capability
- [ ] **ESLint rule** added to prevent future console.log
- [ ] **All tests** passing
- [ ] **Bundle size** reduced

---

## Migration Script

```bash
#!/bin/bash
# Find all console.log statements
grep -rn "console\.log" src/ --include="*.ts" --include="*.tsx"

# Count occurrences
grep -r "console\.log" src/ | wc -l
```

---

## Testing

### Verify No Logs in Production
```bash
npm run build
npm start
# Use app, verify console is clean
```

### Verify Logs in Development
```bash
npm run dev
# Use app, verify debug logs appear
```

---

## Related Issues

- #525 (Remove unused imports and variables)
- #613 (Clean up dead code)

---

## Performance Impact

**Before:** 650+ console.log statements
- Each log requires string formatting
- DevTools overhead for displaying
- Potential memory from console buffer

**After:** Logger with level filtering
- Debug logs skipped in production
- No string formatting overhead
- Cleaner console for actual debugging

---

## Rollout Plan

1. **Week 1:** Create logger utility, add to core files
2. **Week 2:** Replace logs in game engine
3. **Week 3:** Replace logs in UI components
4. **Week 4:** Add ESLint rule, final cleanup
