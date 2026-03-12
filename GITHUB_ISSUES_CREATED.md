# GitHub Issues Created from Deep Code Review

**Date:** March 11, 2026  
**Source:** DEEP_CODE_REVIEW_REPORT.md  
**Total Issues:** 47

---

## CRITICAL Priority Issues

### Issue #601: Security - Remove Client-Side AI API Calls with Exposed Keys
**Labels:** `critical`, `security`, `ai`  
**Assignee:** Unassigned  
**Milestone:** v0.2.0 Security

#### Description
Client-side AI provider files (`openai.ts`, `google.ts`, `zaic.ts`) contain direct API calls that expose API keys in browser code. This is a critical security vulnerability that could lead to unauthorized API usage and financial loss.

#### Affected Files
- `src/ai/providers/openai.ts` (line 124)
- `src/ai/providers/google.ts` (line 158)
- `src/ai/providers/zaic.ts` (line 125, 175)

#### Current Problematic Code
```typescript
// ❌ BAD - Current implementation in zaic.ts:175
export async function sendZAIChatStream(...) {
  const response = await fetch(`${API_ENDPOINTS.ZAI}/chat/completions`, {
    headers: {
      'Authorization': `Bearer ${config.apiKey}`, // EXPOSED IN CLIENT!
    },
    ...
  });
}
```

#### Required Changes
- [ ] Remove all direct API calls from client-side provider files
- [ ] Force all AI requests through `/api/ai-proxy` endpoint
- [ ] Remove streaming fallback in `sendZAIChatStream` or implement server-side streaming
- [ ] Audit all fetch calls to external APIs using grep: `grep -r "fetch.*api\." src/`
- [ ] Update tests to verify no direct API calls from client

#### Acceptance Criteria
- [ ] No API keys visible in browser DevTools Network tab
- [ ] All AI requests route through `/api/ai-proxy`
- [ ] No regression in AI functionality
- [ ] Security audit passes

#### Estimated Effort
2-3 days

#### Related Issues
- #522 (Server-side API key proxy)
- #543 (AI Proxy integration)

---

### Issue #602: Critical - Connect Game Engine to UI for Playable Gameplay
**Labels:** `critical`, `gameplay`, `ui-integration`, `engine`  
**Assignee:** Unassigned  
**Milestone:** v0.2.0 Core Gameplay

#### Description
The game board UI (`src/app/(app)/game-board/page.tsx`) uses mock data instead of the actual game state engine. Users cannot actually play the game despite README claiming "Complete" status.

#### Affected Files
- `src/app/(app)/game-board/page.tsx` (entire file, lines 1-753)
- `src/app/(app)/single-player/page.tsx` (lines 1-129)
- `src/app/(app)/game/[id]/page.tsx` (partial implementation)

#### Evidence
```typescript
// src/app/(app)/game-board/page.tsx - Line 330
const [players, setPlayers] = useState<PlayerState[]>(() => generateMockPlayer(2));

// src/app/(app)/single-player/page.tsx - Line 19
const handleStartGame = (mode: "self-play" | "ai") => {
  toast({
    title: "Starting Game (Prototype)",
    description: `Game board would be initialized for ${mode}...`,
  });
  // No actual game initialization!
};
```

#### Required Changes
- [ ] Replace `generateMockPlayer()` with actual `createInitialGameState()` from engine
- [ ] Implement game loop that processes actions each turn
- [ ] Connect UI interactions to engine functions:
  - [ ] `handleCardClick()` → `castSpell()`, `playLand()`, `activateAbility()`
  - [ ] `handleAttack()` → `declareAttackers()`
  - [ ] `handleBlock()` → `declareBlockers()`
- [ ] Update UI when game state changes
- [ ] Add priority system for turn-based play
- [ ] Implement phase progression

#### Acceptance Criteria
- [ ] User can play a land from hand
- [ ] User can cast a creature spell
- [ ] User can declare attackers
- [ ] User can declare blockers
- [ ] Combat damage is dealt correctly
- [ ] Game state persists between actions
- [ ] No mock data in production code

#### Estimated Effort
5-7 days

#### Related Issues
- #521 (Connect single-player UI)
- #541 (Game engine integration)
- #560 (Bridge game engine with UI)

---

### Issue #603: Add API Key Format Validation Before Usage
**Labels:** `critical`, `security`, `ai`, `validation`  
**Assignee:** Unassigned  
**Milestone:** v0.2.0 Security

#### Description
The AI proxy route (`src/app/api/ai-proxy/route.ts`) doesn't validate API key format before making requests to external APIs, causing unnecessary API calls and poor error messages.

#### Affected Files
- `src/app/api/ai-proxy/route.ts` (lines 145-160)
- `src/lib/server-api-key-storage.ts` (has validation function not being used)

#### Required Changes
- [ ] Import and use `validateApiKeyFormat()` from server-api-key-storage
- [ ] Add validation before making proxied requests
- [ ] Return clear error messages for invalid key formats
- [ ] Add tests for validation logic

#### Implementation Example
```typescript
// ✅ Add validation before making proxied request
const config = await getProviderConfig(provider, userId);
if (!config) {
  return NextResponse.json(
    { success: false, error: 'Provider not configured' },
    { status: 400 }
  );
}

// Validate key format
const isValid = validateApiKeyFormat(provider, config.apiKey);
if (!isValid) {
  return NextResponse.json(
    { success: false, error: 'Invalid API key format' },
    { status: 400 }
  );
}
```

#### Acceptance Criteria
- [ ] Invalid API keys rejected before external API call
- [ ] Clear error messages shown to users
- [ ] No wasted API quota on invalid keys
- [ ] Tests cover all validation scenarios

#### Estimated Effort
1 day

#### Related Issues
- #522 (Server-side API key proxy)

---

### Issue #604: Unify GameState Type Definitions
**Labels:** `critical`, `typescript`, `refactor`, `technical-debt`  
**Assignee:** Unassigned  
**Milestone:** v0.2.0 Architecture

#### Description
Two incompatible `GameState` type definitions exist:
- `src/types/game.ts` - Used by UI components
- `src/lib/game-state/types.ts` - Used by game engine

This creates maintenance burden and requires manual conversion functions.

#### Affected Files
- `src/types/game.ts`
- `src/lib/game-state/types.ts`
- `src/app/(app)/game/[id]/page.tsx` (lines 129-176 - conversion function)
- All files importing GameState

#### Required Changes
**Option A (Recommended): Unify types**
- [ ] Choose single source of truth (preferably `src/lib/game-state/types.ts`)
- [ ] Update UI components to use engine types
- [ ] Remove duplicate type definitions
- [ ] Update all imports

**Option B: Create proper conversion utilities**
- [ ] Create type conversion functions with tests
- [ ] Document conversion limitations
- [ ] Add type guards for safety

#### Acceptance Criteria
- [ ] Single GameState type used throughout codebase
- [ ] No manual conversion functions needed
- [ ] All existing tests pass
- [ ] Type checking passes with no errors

#### Estimated Effort
3-4 days

#### Related Issues
- #516 (Add TypeScript types to AI flows)
- #565 (Enforce strict typing)

---

### Issue #605: Move API Endpoints to Server-Side Only
**Labels:** `critical`, `security`, `configuration`  
**Assignee:** Unassigned  
**Milestone:** v0.2.0 Security

#### Description
API endpoints use `NEXT_PUBLIC_` environment variables, exposing infrastructure details in client bundle.

#### Affected Files
- `src/lib/env.ts` (lines 13-19)
- All files importing `API_ENDPOINTS`

#### Current Problematic Code
```typescript
export const API_ENDPOINTS = {
  ZAI: process.env.NEXT_PUBLIC_ZAI_API_URL || 'https://api.z-ai.com/v1',
  OPENAI: process.env.NEXT_PUBLIC_OPENAI_API_URL || 'https://api.openai.com/v1',
  GOOGLE: process.env.NEXT_PUBLIC_GOOGLE_API_URL || 'https://generativelanguage.googleapis.com/v1',
};
```

#### Required Changes
- [ ] Remove `NEXT_PUBLIC_` prefix from API endpoint env vars
- [ ] Move endpoint configuration to server-side only
- [ ] Update all API calls to use server actions or API routes
- [ ] Update `.env.example` with new variable names
- [ ] Update deployment documentation

#### Acceptance Criteria
- [ ] No `NEXT_PUBLIC_` API endpoints in client bundle
- [ ] All external API calls go through server
- [ ] Environment variables documented
- [ ] No regression in API functionality

#### Estimated Effort
2 days

#### Related Issues
- #519 (Move hardcoded API URLs to env variables)
- #601 (Remove client-side API calls)

---

### Issue #606: Implement or Remove Claude AI Provider
**Labels:** `critical`, `documentation`, `ai`  
**Assignee:** Unassigned  
**Milestone:** v0.2.0 Features

#### Description
README.md claims "Claude API integration via Anthropic SDK" but no Claude provider exists in code. This is misleading to users.

#### Evidence
- README.md: "Bring Your Own Key - Use your own API keys from Claude, Copilot, Gemini, Z.ai, and more"
- GAP_ANALYSIS_ISSUES.md references Issue #517: "Fix or remove non-functional Claude AI provider"
- No Claude/Anthropic code found in `src/ai/providers/`

#### Required Changes
**Option A: Implement Claude Provider**
- [ ] Create `src/ai/providers/claude.ts` following OpenAI pattern
- [ ] Add Anthropic SDK dependency
- [ ] Implement chat completion endpoint
- [ ] Add to provider switching UI
- [ ] Add tests

**Option B: Remove References (Recommended if low priority)**
- [ ] Update README.md to remove Claude references
- [ ] Update UI to remove Claude from provider list
- [ ] Update documentation
- [ ] Mark as "Coming Soon" if planned for future

#### Acceptance Criteria
- [ ] Documentation matches implemented features
- [ ] No misleading claims in README
- [ ] Users can only select available providers

#### Estimated Effort
Option A: 3-4 days | Option B: 0.5 days

#### Related Issues
- #517 (Fix or remove non-functional Claude provider)

---

### Issue #607: Fix Race Condition in AI Turn Execution
**Labels:** `critical`, `bug`, `ai`, `gameplay`  
**Assignee:** Unassigned  
**Milestone:** v0.2.0 Stability

#### Description
AI turn execution in useEffect doesn't prevent multiple simultaneous executions when `gameState?.priorityPlayerId` changes rapidly, causing duplicate AI actions.

#### Affected Files
- `src/app/(app)/game/[id]/page.tsx` (lines 507-600)

#### Current Problematic Code
```typescript
useEffect(() => {
  if (gameState?.priorityPlayerId === aiPlayerId) {
    // No guard against concurrent execution!
    executeAITurn();
  }
}, [gameState?.priorityPlayerId]);
```

#### Required Changes
- [ ] Add ref to track ongoing AI execution
- [ ] Prevent concurrent AI turn executions
- [ ] Add proper cleanup on unmount
- [ ] Add tests for concurrent scenarios

#### Implementation Example
```typescript
const aiExecutionRef = useRef(false);

useEffect(() => {
  if (gameState?.priorityPlayerId === aiPlayerId && !aiExecutionRef.current) {
    aiExecutionRef.current = true;
    executeAITurn().finally(() => {
      aiExecutionRef.current = false;
    });
  }
}, [gameState?.priorityPlayerId]);
```

#### Acceptance Criteria
- [ ] AI never executes two turns simultaneously
- [ ] No duplicate AI actions in game log
- [ ] Game state remains consistent
- [ ] Tests verify concurrent protection

#### Estimated Effort
1 day

#### Related Issues
- #544 (Server/Engine-Side Action Validation)

---

## HIGH Priority Issues

### Issue #608: Remove 650+ Console Logs from Production Code
**Labels:** `high`, `code-quality`, `performance`  
**Assignee:** Unassigned  
**Milestone:** v0.2.0 Quality

#### Description
Production code contains 650+ console.log statements that clutter browser console and impact performance.

#### Affected Files (Top offenders)
- `src/ai/game-state-evaluator-example.ts` (200+ logs)
- `src/ai/decision-making/combat-examples.ts` (100+ logs)
- `src/app/(app)/game/[id]/page.tsx` (50+ logs)
- Multiple other files

#### Required Changes
- [ ] Create logging utility with log levels (debug, info, warn, error)
- [ ] Replace console.log with logging utility
- [ ] Gate debug logs behind environment variable
- [ ] Remove example files from production build or mark as dev-only
- [ ] Add logging configuration to settings

#### Implementation Example
```typescript
// src/lib/logger.ts
export const logger = {
  debug: (...args: any[]) => {
    if (process.env.NODE_ENV === 'development') {
      console.debug(...args);
    }
  },
  info: console.info,
  warn: console.warn,
  error: console.error,
};
```

#### Acceptance Criteria
- [ ] Zero console.log in production build
- [ ] Debug logs visible in development only
- [ ] No regression in debugging capability
- [ ] ESLint rule added to prevent future console.log

#### Estimated Effort
3-4 days

#### Related Issues
- #525 (Remove unused imports and variables)

---

### Issue #609: Add Error Handling to Async Operations
**Labels:** `high`, `error-handling`, `reliability`  
**Assignee:** Unassigned  
**Milestone:** v0.2.0 Stability

#### Description
Multiple files have empty catch blocks that silently swallow errors, making debugging impossible.

#### Affected Files
- `src/hooks/use-storage-backup.ts` (line 90)
- `src/lib/connection-fallback.ts` (line 175)
- `src/lib/websocket-connection.ts` (line 306)

#### Current Problematic Code
```typescript
.catch(() => {}) // Silent failure!
```

#### Required Changes
- [ ] Replace all empty catch blocks with proper error handling
- [ ] Add error logging
- [ ] Add user notifications for critical failures
- [ ] Add recovery logic where possible
- [ ] Add tests for error scenarios

#### Implementation Example
```typescript
.catch((error) => {
  console.error('Backup failed:', error);
  toast({
    title: 'Backup Failed',
    description: 'Your changes may not be saved',
    variant: 'destructive',
  });
  // Add recovery logic
});
```

#### Acceptance Criteria
- [ ] Zero empty catch blocks in codebase
- [ ] All errors logged appropriately
- [ ] Users notified of critical failures
- [ ] Tests cover error scenarios

#### Estimated Effort
2-3 days

#### Related Issues
- #518 (Add consistent error handling to API fetch calls)

---

### Issue #610: Remove `any` Types from Production Code
**Labels:** `high`, `typescript`, `type-safety`  
**Assignee:** Unassigned  
**Milestone:** v0.2.0 Type Safety

#### Description
Excessive use of `any` types in critical game logic defeats TypeScript's type safety and can lead to runtime errors.

#### Affected Files
- `src/app/(app)/game/[id]/page.tsx` (lines 129, 264, 283, 716, 809, 972)
- `src/app/(app)/game-board/page.tsx` (line 330)
- `src/ai/flows/*.ts` (multiple)

#### Current Problematic Code
```typescript
const players: { [key: string]: any } = {};
catch (error: any) { ... }
```

#### Required Changes
- [ ] Define proper types for all variables
- [ ] Use `unknown` for error handling with type guards
- [ ] Add ESLint rule to prevent future `any` types
- [ ] Fix all TypeScript no-explicit-any warnings
- [ ] Add tests to verify type safety

#### Acceptance Criteria
- [ ] Zero `any` types in production code
- [ ] ESLint passes with no `no-explicit-any` warnings
- [ ] All existing tests pass
- [ ] Type checking passes with strict mode

#### Estimated Effort
3-4 days

#### Related Issues
- #516 (Add TypeScript types to AI flows)
- #565 (Enforce strict typing)

---

### Issue #611: Add Integration Tests for Game Engine + UI
**Labels:** `high`, `tests`, `integration`  
**Assignee:** Unassigned  
**Milestone:** v0.2.0 Testing

#### Description
All 26 test files are unit tests. No integration tests exist for game engine + UI interaction, leaving critical integration points untested.

#### Missing Test Coverage
- Game engine → UI rendering
- User actions → Game state updates
- Multiplayer synchronization
- AI opponent gameplay
- Full game flow

#### Required Changes
- [ ] Set up React Testing Library for integration tests
- [ ] Create test utilities for game state setup
- [ ] Add tests for core gameplay flows:
  - [ ] Playing a land
  - [ ] Casting a spell
  - [ ] Combat sequence
  - [ ] Turn progression
- [ ] Add multiplayer sync tests
- [ ] Add AI integration tests
- [ ] Achieve 80%+ integration test coverage

#### Example Test
```typescript
describe('GameBoard Integration', () => {
  it('should update UI when game state changes', async () => {
    const { gameState, render } = setupGame();
    await userEvent.click(screen.getByText('Play Land'));
    expect(screen.getByText('Forest')).toBeInTheDocument();
    expect(gameState.players[0].lands).toHaveLength(1);
  });
});
```

#### Acceptance Criteria
- [ ] 20+ integration tests covering core flows
- [ ] All tests passing in CI
- [ ] 80%+ code coverage
- [ ] Tests run in under 5 minutes

#### Estimated Effort
5-7 days

#### Related Issues
- #515 (Fix test coverage failures)
- #542 (Restore CI pipeline)

---

### Issue #612: Fix Memory Leak in Auto-Save Timer
**Labels:** `high`, `bug`, `performance`, `memory-leak`  
**Assignee:** Unassigned  
**Milestone:** v0.2.0 Stability

#### Description
Auto-save timer in game page captures stale `gameState` in interval callback, causing memory leaks and saving outdated state.

#### Affected Files
- `src/app/(app)/game/[id]/page.tsx` (lines 481-493)

#### Current Problematic Code
```typescript
useEffect(() => {
  autoSaveTimerRef.current = setInterval(() => {
    if (gameState) { // Captures stale gameState!
      saveGame(gameState);
    }
  }, 30000);
  
  return () => {
    if (autoSaveTimerRef.current) {
      clearInterval(autoSaveTimerRef.current);
    }
  };
}, []); // Missing gameState dependency!
```

#### Required Changes
- [ ] Use ref-based state access in interval callback
- [ ] Add proper dependencies to useEffect
- [ ] Test for memory leaks using DevTools
- [ ] Add cleanup verification tests

#### Implementation Example
```typescript
const gameStateRef = useRef(gameState);
gameStateRef.current = gameState;

useEffect(() => {
  autoSaveTimerRef.current = setInterval(() => {
    const currentState = gameStateRef.current;
    if (currentState) {
      saveGame(currentState);
    }
  }, 30000);
  
  return () => {
    if (autoSaveTimerRef.current) {
      clearInterval(autoSaveTimerRef.current);
    }
  };
}, []); // Now safe
```

#### Acceptance Criteria
- [ ] No memory leaks in DevTools Memory profiler
- [ ] Auto-save uses current game state
- [ ] Timer properly cleaned up on unmount
- [ ] Tests verify cleanup behavior

#### Estimated Effort
1 day

#### Related Issues
- None

---

### Issue #613: Clean Up Dead Code and Unused Imports
**Labels:** `high`, `code-quality`, `cleanup`  
**Assignee:** Unassigned  
**Milestone:** v0.2.0 Quality

#### Description
Codebase contains 50+ unused imports, dead code from previous implementations, and stub code that's never used.

#### Affected Files
- `src/ai/genkit.ts` (stub code never used)
- Multiple files with unused imports (see ESLint output)
- Example files not used in production

#### Required Changes
- [ ] Run ESLint and fix all no-unused-vars warnings
- [ ] Remove unused imports
- [ ] Delete dead code files
- [ ] Remove example files or mark as dev-only
- [ ] Run tree-shaking analysis
- [ ] Add ESLint rule to prevent future unused imports

#### Acceptance Criteria
- [ ] Zero ESLint unused-vars warnings
- [ ] Reduced bundle size
- [ ] Cleaner codebase
- [ ] No broken imports after cleanup

#### Estimated Effort
2 days

#### Related Issues
- #525 (Remove unused imports and variables)

---

### Issue #614: Complete Combat System Implementation
**Labels:** `high`, `gameplay`, `engine`, `rules`  
**Assignee:** Unassigned  
**Milestone:** v0.2.0 Game Rules

#### Description
Combat system (`src/lib/game-state/combat.ts`) is missing full implementation of blocker ordering, trample, first strike/double strike damage steps.

#### Affected Files
- `src/lib/game-state/combat.ts` (lines 1-630)

#### Missing Features
- [ ] Blocker ordering (CR 509.2)
- [ ] Trample damage assignment (CR 702.19)
- [ ] First strike damage step (CR 510.1)
- [ ] Double strike damage steps (CR 702.4)
- [ ] Multiple blocker damage assignment (CR 510.1)
- [ ] Damage prevention effects in combat

#### Required Changes
- [ ] Implement full combat damage assignment
- [ ] Add first strike/double strike damage steps
- [ ] Implement trample damage calculation
- [ ] Add tests for complex combat scenarios
- [ ] Update documentation with combat flow

#### Acceptance Criteria
- [ ] All combat keywords work correctly
- [ ] Complex combat scenarios handled properly
- [ ] Tests cover all combat variations
- [ ] No rules violations in combat

#### Estimated Effort
4-5 days

#### Related Issues
- #544 (Server/Engine-Side Action Validation)

---

### Issue #615: Add Accessibility Support to Game Board
**Labels:** `high`, `accessibility`, `a11y`, `ui`  
**Assignee:** Unassigned  
**Milestone:** v0.2.0 Accessibility

#### Description
Game board components lack ARIA labels, keyboard navigation, and screen reader support, violating WCAG 2.1 guidelines.

#### Affected Files
- `src/components/game-board.tsx`
- `src/components/hand-display.tsx`
- `src/components/zone-display.tsx`

#### Missing Features
- [ ] ARIA labels for all interactive elements
- [ ] Keyboard navigation (Tab, Enter, Escape)
- [ ] Screen reader announcements for game state changes
- [ ] Focus management
- [ ] High contrast mode support
- [ ] Keyboard shortcuts for common actions

#### Required Changes
- [ ] Add ARIA labels and roles
- [ ] Implement keyboard navigation
- [ ] Add screen reader support
- [ ] Test with screen readers (NVDA, VoiceOver)
- [ ] Add accessibility tests

#### Acceptance Criteria
- [ ] WCAG 2.1 AA compliant
- [ ] Fully navigable with keyboard only
- [ ] Screen reader announces game state
- [ ] Accessibility tests pass

#### Estimated Effort
3-4 days

#### Related Issues
- None

---

## MEDIUM Priority Issues

### Issue #616: Add Retry Logic for Failed AI Requests
**Labels:** `medium`, `ai`, `reliability`, `network`  
**Assignee:** Unassigned  
**Milestone:** v0.2.0 Reliability

#### Description
Failed AI requests are not retried, causing transient network issues to result in permanent failures.

#### Affected Files
- `src/lib/ai-proxy-client.ts`
- `src/ai/providers/*.ts`

#### Required Changes
- [ ] Implement exponential backoff retry logic
- [ ] Add retry configuration (max retries, delay)
- [ ] Show retry status to user
- [ ] Add tests for retry scenarios

#### Acceptance Criteria
- [ ] Transient failures automatically retried
- [ ] User informed of retry attempts
- [ ] Configurable retry settings
- [ ] Tests verify retry behavior

#### Estimated Effort
2 days

---

### Issue #617: Add Client-Side Rate Limiting for AI Requests
**Labels:** `medium`, `ai`, `performance`, `cost-control`  
**Assignee:** Unassigned  
**Milestone:** v0.2.0 Cost Control

#### Description
Client doesn't implement rate limiting before calling the proxy, leading to unnecessary network requests that will fail server-side.

#### Required Changes
- [ ] Implement client-side debouncing
- [ ] Add rate limiting hook
- [ ] Show rate limit status to user
- [ ] Add tests

#### Estimated Effort
2 days

#### Related Issues
- #526 (Add rate limiting for AI API calls)

---

### Issue #618: Implement Performance Virtualization for Large Battlefields
**Labels:** `medium`, `performance`, `ui`  
**Assignee:** Unassigned  
**Milestone:** v0.2.0 Performance

#### Description
`VIRTUALIZATION_THRESHOLD = 20` is defined but not implemented. Performance degrades with many permanents.

#### Required Changes
- [ ] Implement virtualization using @tanstack/react-virtual
- [ ] Add lazy loading for card images
- [ ] Optimize re-renders with memoization
- [ ] Add performance tests

#### Estimated Effort
3 days

---

### Issue #619: Standardize Error Message Formats
**Labels:** `medium`, `ux`, `error-handling`  
**Assignee:** Unassigned  
**Milestone:** v0.2.0 UX

#### Description
Error messages vary in format and detail across the codebase, creating poor user experience.

#### Required Changes
- [ ] Create error message utility
- [ ] Define error code system
- [ ] Standardize error message format
- [ ] Add user-friendly messages
- [ ] Add tests

#### Estimated Effort
2 days

---

### Issue #620: Add Missing JSDoc Comments
**Labels:** `medium`, `documentation`, `code-quality`  
**Assignee:** Unassigned  
**Milestone:** v0.2.0 Documentation

#### Description
Many functions lack documentation, making code harder to understand and maintain.

#### Required Changes
- [ ] Add JSDoc comments to all exported functions
- [ ] Document parameters and return types
- [ ] Add examples for complex functions
- [ ] Generate API documentation

#### Estimated Effort
3 days

---

### Issue #621: Break Down Long Functions
**Labels:** `medium`, `code-quality`, `refactor`  
**Assignee:** Unassigned  
**Milestone:** v0.2.0 Quality

#### Description
Functions like `handleCardClick` span 200+ lines, making them hard to test and maintain.

#### Required Changes
- [ ] Identify functions over 50 lines
- [ ] Break into smaller, focused functions
- [ ] Add tests for each sub-function
- [ ] Add ESLint rule for function length

#### Estimated Effort
3 days

---

## LOW Priority Issues

### Issue #622: Add Bundle Size Analysis to CI
**Labels:** `low`, `performance`, `ci-cd`  
**Estimated Effort:** 1 day

### Issue #623: Add Visual Regression Tests
**Labels:** `low`, `tests`, `ui`  
**Estimated Effort:** 2 days

### Issue #624: Add Husky Pre-commit Hooks
**Labels:** `low`, `code-quality`, `ci-cd`  
**Estimated Effort:** 1 day

### Issue #625: Add GitHub Issue Templates
**Labels:** `low`, `documentation`  
**Estimated Effort:** 0.5 days

### Issue #626: Add Pull Request Template
**Labels:** `low`, `documentation`  
**Estimated Effort:** 0.5 days

### Issue #627: Add CHANGELOG.md
**Labels:** `low`, `documentation`  
**Estimated Effort:** 1 day

### Issue #628: Add Benchmark Tests
**Labels:** `low`, `performance`, `tests`  
**Estimated Effort:** 2 days

### Issue #629: Enable Source Maps for Production
**Labels:** `low`, `debugging`  
**Estimated Effort:** 0.5 days

---

## Summary

| Priority | Count | Estimated Effort |
|----------|-------|-----------------|
| **CRITICAL** | 7 | 14-21 days |
| **HIGH** | 8 | 21-29 days |
| **MEDIUM** | 5 | 12-15 days |
| **LOW** | 8 | 8-10 days |
| **TOTAL** | **28** | **55-75 days** |

---

## Quick Create Script

To create these issues via GitHub CLI:

```bash
# Example for creating Issue #601
gh issue create \
  --title "Security - Remove Client-Side AI API Calls with Exposed Keys" \
  --body-file "issues/601-security-client-api-calls.md" \
  --label "critical,security,ai" \
  --milestone "v0.2.0 Security"
```

---

**Generated:** March 11, 2026  
**From:** DEEP_CODE_REVIEW_REPORT.md
