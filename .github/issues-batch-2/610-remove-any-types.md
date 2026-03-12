# Remove `any` Types from Production Code

**Priority:** 🟠 HIGH  
**Labels:** `high`, `typescript`, `type-safety`  
**Milestone:** v0.2.0 Type Safety  
**Estimated Effort:** 3-4 days

---

## Description

Excessive use of `any` types in critical game logic **defeats TypeScript's type safety** and can lead to runtime errors that would otherwise be caught at compile time.

---

## Affected Files

| File | Line | Usage |
|------|------|-------|
| `src/app/(app)/game/[id]/page.tsx` | 129, 264, 283, 716, 809, 972 | Multiple |
| `src/app/(app)/game-board/page.tsx` | 330 | Player type |
| `src/ai/flows/*.ts` | Multiple | AI responses |
| Various files | Various | Error handling |

---

## Current Problematic Code

```typescript
// ❌ BAD - No type safety
const players: { [key: string]: any } = {};

// ❌ BAD - Error type unknown
catch (error: any) {
  console.error(error);
}

// ❌ BAD - Function return type unknown
function processGameData(data: any): any {
  return data;
}

// ❌ BAD - Array of unknown
const cards: any[] = [];
```

---

## Impact

1. **Runtime Errors:** Type mismatches not caught until runtime
2. **No IntelliSense:** IDE can't provide autocomplete
3. **Refactoring Risk:** Changes can break silently
4. **Documentation:** Types serve as documentation, lost with `any`

---

## Required Changes

### Step 1: Define Proper Types

```typescript
// ✅ GOOD - Proper types
interface PlayerMap {
  [key: string]: Player;
}

interface GameState {
  players: PlayerMap;
  // ...
}

const players: PlayerMap = {};
```

### Step 2: Use Unknown for Errors

```typescript
// ✅ GOOD - Type-safe error handling
catch (error: unknown) {
  if (error instanceof Error) {
    console.error('Game error:', error.message);
  } else {
    console.error('Unknown error:', error);
  }
}
```

### Step 3: Define Response Types

```typescript
// ✅ GOOD - Explicit types
interface AIResponse {
  decision: AIDecision;
  confidence: number;
  reasoning: string;
}

function processGameData(data: GameData): AIResponse {
  return {
    decision: data.decision,
    confidence: data.confidence,
    reasoning: data.reasoning,
  };
}
```

### Step 4: Fix All ESLint Warnings

Run ESLint and fix all `no-explicit-any` warnings:

```bash
npm run lint
# Fix all @typescript-eslint/no-explicit-any warnings
```

---

## Acceptance Criteria

- [ ] **Zero** `any` types in production code
- [ ] **ESLint passes** with no `no-explicit-any` warnings
- [ ] **All tests** passing
- [ ] **Type checking** passes with strict mode
- [ ] **No** `as any` type assertions
- [ ] **ESLint rule** enforced

---

## Common Replacements

| Instead of `any` | Use |
|-----------------|-----|
| `any` for objects | `Record<string, unknown>` or specific interface |
| `any` for errors | `unknown` with type guards |
| `any` for arrays | `T[]` with specific type |
| `any` for functions | `(arg: Type) => ReturnType` |
| `any` for API responses | Specific response interface |

---

## Examples

### Example 1: Player Data
```typescript
// ❌ Before
const players: { [key: string]: any } = {};

// ✅ After
interface Player {
  id: string;
  name: string;
  life: number;
  hand: Card[];
}

const players: Record<string, Player> = {};
```

### Example 2: Error Handling
```typescript
// ❌ Before
catch (error: any) {
  console.error(error.message);
}

// ✅ After
catch (error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(message);
}
```

### Example 3: API Response
```typescript
// ❌ Before
async function fetchCard(name: string): Promise<any> {
  const response = await fetch(`/api/cards/${name}`);
  return response.json();
}

// ✅ After
interface ScryfallCard {
  id: string;
  name: string;
  manaCost: string;
  // ...
}

async function fetchCard(name: string): Promise<ScryfallCard> {
  const response = await fetch(`/api/cards/${name}`);
  return response.json();
}
```

---

## ESLint Configuration

```javascript
// eslint.config.mjs
rules: {
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/prefer-unknown': 'warn',
}
```

---

## Testing

### Type Checking
```bash
npm run typecheck
# Should pass with no errors
```

### ESLint
```bash
npm run lint
# Should show no no-explicit-any warnings
```

---

## Related Issues

- #516 (Add TypeScript types to AI flows)
- #565 (Enforce strict typing)
- #604 (Unify GameState types)

---

## Migration Strategy

### Phase 1: Critical Paths (Day 1-2)
- Game state types
- Action handlers
- Error handling

### Phase 2: AI Flows (Day 2-3)
- AI request/response types
- Decision types

### Phase 3: Cleanup (Day 3-4)
- Remaining any types
- Add ESLint rule
- Final verification

---

## Tools

### Find All Any Types
```bash
# Find explicit any
grep -rn ": any" src/

# Find implicit any (function parameters)
grep -rn "function.*any" src/

# Find as any assertions
grep -rn "as any" src/
```

### TypeScript Strict Mode
```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true
  }
}
```
