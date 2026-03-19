# Phase 15: Draft Core - Research

**Researched:** 2026-03-18
**Domain:** MTG Draft Mode - Draft State Machine, Pick Timer, Face-Down Packs, Pool Management
**Confidence:** MEDIUM-HIGH

## Summary

Phase 15 builds the core draft experience where users pick cards from face-down packs with a per-pick timer. The key difference from Phase 14's sealed mode is that cards are presented face-down and only revealed when opening a pack. Draft requires a state machine tracking current pack/pick, face-down card storage with reveal mechanics, and a configurable countdown timer with visual warning states (green → yellow → red). The existing pool storage and limited validator from Phase 14 extend naturally; the main new work is draft-specific state management and UI for pack opening and card picking.

**Primary recommendation:** Build a `DraftSession` type extending `LimitedSession` with pack state, create `draft-generator.ts` for face-down pack management, adapt the existing `useTurnTimer` hook with draft-specific thresholds (green >15s, yellow 5-15s, red <5s), and create a draft page with split view (pack cards + pool sidebar).

## User Constraints (from CONTEXT.md)

### Locked Decisions
- Use same storage pattern: IndexedDB 'limited-sessions' store
- Use same types: LimitedSession, PoolCard, Pack from src/lib/limited/types.ts
- Use same validator: limited-validator.ts with LIMITED_RULES
- 3 packs of 14 cards each (42 cards total)
- 45 second default timer per pick

### Claude's Discretion
- Timer warning thresholds (yellow/red cutoff points)
- Card back design for face-down cards
- Exact timer visual design (circular vs bar)
- Hover-before-expiry behavior details

### Deferred Ideas (OUT OF SCOPE)
- AI neighbors (Phase 16)
- Pack passing animations (Phase 16)
- Bot difficulty selection (Phase 16)

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DRFT-01 | Start new Draft session with selected set | Session creation flow from sealed-generator pattern |
| DRFT-02 | Open 3 packs of 14 cards each, one at a time | Pack structure, face-down card management |
| DRFT-03 | Pack cards face-down until opened | `isOpened` flag on packs, card back display |
| DRFT-04 | Select one card to add to draft pool | Card click handler, pool update |
| DRFT-05 | View current draft pool at all times | Split-view UI with pool sidebar |
| DRFT-06 | Draft timer counts down per pick (default 45s) | useTurnTimer adaptation, configurable duration |
| DRFT-07 | Timer visual warnings green → yellow → red | Timer state colors, warning thresholds |
| DRFT-08 | Timer expiration auto-picks last hovered or skip | Hover state tracking, auto-pick logic |
| DRFT-09 | Draft completes after 3 packs | State machine completion condition |
| DRFT-10 | Draft pool persists across page refresh | Session persistence via IndexedDB |
| DRFT-11 | Draft session can be resumed if interrupted | Session resume via session ID |

## Standard Stack

### Core (from Phase 14)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js App Router | 15.5.12 | Page routing, layouts | Project standard |
| Shadcn/ui + Radix | latest | UI components | Project standard |
| Dexie.js | 4.3.0 | IndexedDB wrapper | Project standard (pool-storage.ts) |
| date-fns | 3.6.0 | Date formatting | Lightweight, tree-shakeable |

### Supporting (No new dependencies)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Existing hooks | - | useTurnTimer, useLocalStorage | Timer logic, session persistence |
| Existing types | - | LimitedSession, PoolCard | Session storage, card data |
| Existing services | - | sealed-generator | Pack generation reuse |

**Installation:** No new packages required.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── app/(app)/
│   └── draft/                       # NEW: Draft session page
│       ├── page.tsx                 # Main draft UI
│       └── _components/
│           ├── draft-pack-view.tsx  # Pack card grid with face-down cards
│           ├── draft-pool-view.tsx  # Sidebar showing picked cards
│           ├── draft-timer.tsx      # Timer with color states
│           ├── face-down-card.tsx   # Card back placeholder
│           └── pick-confirmation.tsx # Optional pick confirmation
├── lib/
│   └── limited/
│       ├── types.ts                 # EXTEND: Add DraftSession, DraftPack types
│       ├── pool-storage.ts          # EXTEND: Add draft-specific storage functions
│       ├── sealed-generator.ts      # EXTEND: Add draft pack generation
│       ├── draft-generator.ts       # NEW: Draft session, face-down pack logic
│       └── __tests__/
│           └── draft-generator.test.ts # NEW: Draft-specific tests
└── hooks/
    └── use-draft-timer.ts           # NEW: Draft timer hook with auto-pick
```

### Pattern 1: Draft State Machine
**What:** Sequential pack presentation with pick counting, face-down card management.
**When to use:** For DRFT-02, DRFT-03, DRFT-09 requirements.
**Example:**
```typescript
// Draft state tracking
type DraftState = 'intro' | 'picking' | 'pack_complete' | 'draft_complete';

interface DraftSession {
  // ...existing LimitedSession fields...
  draftState: DraftState;
  currentPackIndex: number;      // 0-2 for 3 packs
  currentPickIndex: number;       // 0-13 for 14 picks
  packs: DraftPack[];             // Face-down packs
  timerSeconds: number;           // Remaining time for current pick
  lastHoveredCardId: string | null; // For DRFT-08 auto-pick
}

interface DraftPack {
  id: string;
  cards: PoolCard[];              // All 14 cards
  isOpened: boolean;               // DRFT-03: Cards revealed?
  pickedCardIds: string[];         // Cards already picked from this pack
}
```

### Pattern 2: Face-Down Card Storage
**What:** Pack cards stored but `isOpened` flag controls visibility.
**When to use:** For DRFT-03, DRFT-10 requirements.
**Example:**
```typescript
// Store full pack but only reveal when opened
const pack: DraftPack = {
  id: crypto.randomUUID(),
  cards: allCardsInPack,           // 14 cards, hidden from UI
  isOpened: false,                 // UI shows card backs
  pickedCardIds: [],
};

// When user opens pack:
function openPack(pack: DraftPack): DraftPack {
  return { ...pack, isOpened: true };
}

// When user picks a card:
function pickCard(pack: DraftPack, cardId: string): DraftPack {
  return {
    ...pack,
    cards: pack.cards.filter(c => c.id !== cardId),
    pickedCardIds: [...pack.pickedCardIds, cardId],
  };
}
```

### Pattern 3: Pick Timer with Color States
**What:** Configurable countdown with visual states (green → yellow → red).
**When to use:** For DRFT-06, DRFT-07, DRFT-08 requirements.
**Reference:** Extend existing `useTurnTimer` hook with draft-specific thresholds.
**Example:**
```typescript
// Adapted from useTurnTimer.ts
const DRAFT_TIMER_CONFIG = {
  defaultSeconds: 45,
  warningThreshold: 15,    // Yellow when ≤15s
  criticalThreshold: 5,    // Red when ≤5s
};

type TimerColorState = 'green' | 'yellow' | 'red';

function getTimerColor(seconds: number): TimerColorState {
  if (seconds <= DRAFT_TIMER_CONFIG.criticalThreshold) return 'red';
  if (seconds <= DRAFT_TIMER_CONFIG.warningThreshold) return 'yellow';
  return 'green';
}
```

### Pattern 4: Auto-Pick on Expiration
**What:** Timer expiry picks last hovered card or prompts skip.
**When to use:** For DRFT-08 requirement.
**Example:**
```typescript
// Track last hovered card
const [lastHoveredId, setLastHoveredId] = useState<string | null>(null);

// On card hover:
function handleCardHover(cardId: string) {
  setLastHoveredId(cardId);
}

// On timer expire:
function handleTimerExpire() {
  if (lastHoveredId) {
    // Auto-pick the hovered card
    pickCard(lastHoveredId);
  } else {
    // Prompt skip (or auto-skip to next pack)
    showSkipConfirmation();
  }
}
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Timer logic | Custom interval management | Extend `useTurnTimer` | Handles pause/resume/reset, existing patterns |
| Session persistence | localStorage | Extend `pool-storage.ts` | IndexedDB structure, reuse isolation |
| Card back display | Generate image | Use card back SVG/placeholder | Consistent across all sets |
| Pack generation | New algorithm | Extend `sealed-generator.ts` | Same rarity distribution, same card retrieval |

**Key insight:** Draft differs from sealed in *state management* (sequential picks, face-down cards) not in *card generation*. Reuse `generatePack()` from sealed-generator.

## Common Pitfalls

### Pitfall 1: Pack State Not Persisted Correctly
**What goes wrong:** Opening pack in one session, refreshing, and pack is face-down again.
**Why it happens:** `isOpened` not saved to IndexedDB, only UI state.
**How to avoid:**
- Save full `DraftSession` including `packs` array to IndexedDB on every state change
- On resume, reconstruct UI from stored state
- Include `isOpened`, `pickedCardIds` in pack object
**Warning signs:** `pack.isOpened` always `false` on reload

### Pitfall 2: Timer Continues After Pack Complete
**What goes wrong:** Timer runs between packs, not just during picks.
**Why it happens:** Timer not paused when moving to next pack or after last pick.
**How to avoid:**
- Pause timer when `currentPickIndex >= 14`
- Start timer only when user opens new pack
- Reset timer state between packs
**Warning signs:** Timer shows "0:00" or negative time at pack transitions

### Pitfall 3: Hover State Lost on Refresh
**What goes wrong:** Timer expires, but `lastHoveredId` is null because hover state not persisted.
**Why it happens:** Hover state in React state, not persisted.
**How to avoid:**
- Persist `lastHoveredId` to session in IndexedDB
- OR: Always require explicit pick on expiry (no auto-pick)
- Consider: Auto-pick random card if no hover (safer approach)
**Warning signs:** DRFT-08 auto-pick never triggers, always prompts skip

### Pitfall 4: Race Condition on Quick Picks
**What goes wrong:** User clicks card, timer expires, both pick and skip happen.
**Why it happens:** Timer and click handlers fire simultaneously.
**How to avoid:**
- Disable timer when card is clicked
- Clear timer interval on card selection
- Use mutex pattern: only one action per pick
**Warning signs:** Console errors about state updates after unmount

### Pitfall 5: Draft Completion Detection
**What goes wrong:** Draft never shows "complete" screen, stays in picking state.
**Why it happens:** Completion condition not checked correctly.
**How to avoid:**
- Check: `currentPackIndex === 2 && currentPickIndex === 13 && allPacksOpened`
- OR: Track total picks = 42 (3 packs × 14 cards)
- Update `session.status` to 'completed' when draft finishes
**Warning signs:** User can't navigate to deck builder after draft

## Code Examples

### Draft Session Creation (DRFT-01, DRFT-02)
```typescript
// Extend sealed-generator.ts
import { generatePack, packToPoolCards } from './sealed-generator';

interface DraftPackData {
  id: string;
  cards: PoolCard[];
  isOpened: boolean;
  pickedCardIds: string[];
}

export async function createDraftSession(
  setCode: string,
  setName: string
): Promise<DraftSession> {
  // Generate 3 packs (14 cards each)
  const packs: DraftPackData[] = [];
  
  for (let i = 0; i < 3; i++) {
    const pack = await generatePack(setCode);
    packs.push({
      id: crypto.randomUUID(),
      cards: packToPoolCards(pack, i),
      isOpened: false,           // DRFT-03: Face-down until opened
      pickedCardIds: [],
    });
  }

  const session: DraftSession = {
    id: crypto.randomUUID(),
    setCode,
    setName,
    mode: 'draft',
    status: 'in_progress',
    draftState: 'intro',         // Start with intro screen
    currentPackIndex: 0,
    currentPickIndex: 0,
    packs,
    pool: [],
    deck: [],
    timerSeconds: 45,
    lastHoveredCardId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return session;
}
```

### Face-Down Card Display (DRFT-03)
```typescript
// Draft card with face-down state
interface DraftCardProps {
  card?: PoolCard;          // undefined when face-down
  isFaceDown: boolean;
  onClick: () => void;
  onHover: () => void;
  isPicked: boolean;
}

function DraftCard({ card, isFaceDown, onClick, onHover, isPicked }: DraftCardProps) {
  // Face-down: show card back
  if (isFaceDown) {
    return (
      <button
        className="aspect-[2.5/3.5] rounded-md border-2 border-dashed border-muted-foreground/30 bg-muted/50 cursor-pointer hover:border-primary/50 transition-colors"
        onClick={onClick}      // Open pack
        aria-label="Face-down card"
      >
        <div className="flex items-center justify-center h-full">
          <Package className="w-8 h-8 text-muted-foreground/50" />
        </div>
      </button>
    );
  }

  // Face-up: show card image
  return (
    <button
      className={cn(
        "relative group aspect-[2.5/3.5] rounded-md overflow-hidden border transition-all",
        isPicked ? "opacity-50" : "hover:ring-2 hover:ring-primary"
      )}
      onClick={onClick}      // Pick card
      onMouseEnter={onHover} // Track for DRFT-08
      disabled={isPicked}
    >
      <img
        src={card.image_uris?.normal}
        alt={card.name}
        className="w-full h-full object-cover"
      />
      {/* Pick indicator on hover */}
      <div className="absolute inset-0 bg-primary/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
        <Check className="w-8 h-8 text-primary-foreground" />
      </div>
    </button>
  );
}
```

### Draft Timer Component (DRFT-06, DRFT-07)
```typescript
// Adapted from turn-timer.tsx
import { TimerState } from '@/components/turn-timer';
import { useTurnTimer } from '@/hooks/use-turn-timer';

const DRAFT_WARNING_THRESHOLD = 15;  // Yellow at ≤15s
const DRAFT_CRITICAL_THRESHOLD = 5; // Red at ≤5s

interface DraftTimerProps {
  initialSeconds?: number;
  onExpire: () => void;
  isActive: boolean;
}

export function DraftTimer({ 
  initialSeconds = 45, 
  onExpire, 
  isActive 
}: DraftTimerProps) {
  const { timeRemaining, timerState } = useTurnTimer({
    initialSeconds,
    autoStart: isActive,
    onExpire,
  });

  // Color based on time remaining
  const getColorClass = () => {
    if (timeRemaining <= DRAFT_CRITICAL_THRESHOLD) {
      return {
        bg: 'bg-red-500',
        border: 'border-red-500',
        text: 'text-red-500',
        pulse: true,
      };
    }
    if (timeRemaining <= DRAFT_WARNING_THRESHOLD) {
      return {
        bg: 'bg-yellow-500',
        border: 'border-yellow-500',
        text: 'text-yellow-500',
        pulse: true,
      };
    }
    return {
      bg: 'bg-green-500',
      border: 'border-green-500',
      text: 'text-green-500',
      pulse: false,
    };
  };

  const colors = getColorClass();

  return (
    <div className={cn(
      "flex items-center gap-3 px-4 py-3 rounded-lg border",
      colors.border,
      colors.pulse && "animate-pulse"
    )}>
      <Clock className={cn("w-5 h-5", colors.text)} />
      <span className={cn("text-2xl font-mono font-bold", colors.text)}>
        {Math.floor(timeRemaining / 60)}:{(timeRemaining % 60).toString().padStart(2, '0')}
      </span>
      {/* Progress bar */}
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div 
          className={cn("h-full transition-all", colors.bg)}
          style={{ width: `${(timeRemaining / initialSeconds) * 100}%` }}
        />
      </div>
    </div>
  );
}
```

### Pool Sidebar (DRFT-05)
```typescript
// Sidebar showing picked cards, always visible
interface DraftPoolViewProps {
  pool: PoolCard[];
  onRemoveCard?: (cardId: string) => void;
}

function DraftPoolView({ pool, onRemoveCard }: DraftPoolViewProps) {
  return (
    <div className="w-80 border-l flex flex-col h-full">
      <div className="p-4 border-b bg-muted/50">
        <h2 className="font-headline text-lg font-bold">Draft Pool</h2>
        <p className="text-sm text-muted-foreground">
          {pool.length} cards picked
        </p>
      </div>
      
      <ScrollArea className="flex-1 p-2">
        {pool.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center p-4">
            Pick cards to build your pool
          </p>
        ) : (
          <div className="space-y-1">
            {pool.map((card) => (
              <PoolCardRow
                key={card.id}
                card={card}
                onRemove={onRemoveCard}
              />
            ))}
          </div>
        )}
      </ScrollArea>
      
      {/* Build Deck Button */}
      <div className="p-4 border-t">
        <Button
          className="w-full"
          disabled={pool.length < 40}
        >
          Build Deck ({pool.length}/40 cards)
        </Button>
      </div>
    </div>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single card reveal | Face-down packs | Phase 15 | Core draft mechanic |
| No timer | Per-pick countdown | Phase 15 | Competitive draft feel |
| Pack open all at once | Sequential pack presentation | Phase 15 | True draft experience |
| No auto-pick | Last-hover auto-pick | Phase 15 | Prevents timer forfeit |

**Deprecated/outdated:**
- Sealed-only `LimitedSession` — extended with draft-specific fields in Phase 15
- Static timer component — adapted with color thresholds for draft

## Open Questions

1. **Timer warning thresholds**
   - What we know: DRFT-07 requires green → yellow → red states
   - What's unclear: Exact thresholds (15s yellow, 5s red? Or 20s/10s?)
   - Recommendation: 15s yellow, 5s red (based on existing `warningThreshold = 30` in useTurnTimer)

2. **Card back design**
   - What we know: Need a placeholder for face-down cards
   - What's unclear: Use Scryfall card back image, custom SVG, or solid color?
   - Recommendation: Use Scryfall's card back image (publicly available) for authentic feel

3. **Skip behavior on timer expiry**
   - What we know: DRFT-08 says "auto-pick last hovered or prompts skip"
   - What's unclear: If no hover, skip to next pack automatically?
   - Recommendation: Show confirmation dialog "Skip this pick?" with 5-second auto-skip

4. **Pack opening UX**
   - What we know: DRFT-03 says cards face-down until opened
   - What's unclear: One-click to open all cards, or pick one at a time?
   - Recommendation: Pack shows 14 face-down cards; click any to "open pack" and reveal all

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 29.7 + @testing-library/react 16.3 |
| Config file | jest.config.js |
| Quick run command | `npm test -- --testPathPattern="draft"` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DRFT-01 | Draft session creation | unit | `npm test -- --testPathPattern="draft-generator"` | ❌ Wave 0 |
| DRFT-02 | 3 packs × 14 cards | unit | `npm test -- --testPathPattern="draft-generator" --testNamePattern="14 cards"` | ❌ Wave 0 |
| DRFT-03 | Face-down until opened | unit | `npm test -- --testPathPattern="draft-generator" --testNamePattern="isOpened"` | ❌ Wave 0 |
| DRFT-04 | Card selection to pool | unit | `npm test -- --testPathPattern="draft-generator" --testNamePattern="pick"` | ❌ Wave 0 |
| DRFT-05 | Pool view | unit | `npm test -- --testPathPattern="draft-generator" --testNamePattern="pool"` | ❌ Wave 0 |
| DRFT-06 | Timer countdown | unit | `npm test -- --testPathPattern="draft-timer" --testNamePattern="countdown"` | ❌ Wave 0 |
| DRFT-07 | Timer color states | unit | `npm test -- --testPathPattern="draft-timer" --testNamePattern="color"` | ❌ Wave 0 |
| DRFT-08 | Auto-pick on expire | unit | `npm test -- --testPathPattern="draft-timer" --testNamePattern="auto-pick"` | ❌ Wave 0 |
| DRFT-09 | Draft completion | unit | `npm test -- --testPathPattern="draft-generator" --testNamePattern="complete"` | ❌ Wave 0 |
| DRFT-10 | Pool persistence | integration | `npm test -- --testPathPattern="pool-storage" --testNamePattern="draft.*persist"` | ❌ Wave 0 |
| DRFT-11 | Session resume | integration | `npm test -- --testPathPattern="pool-storage" --testNamePattern="draft.*resume"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- --testPathPattern="draft" --passWithNoTests`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/lib/limited/__tests__/draft-generator.test.ts` — covers DRFT-01, DRFT-02, DRFT-03, DRFT-04, DRFT-05, DRFT-09
- [ ] `src/hooks/__tests__/use-draft-timer.test.ts` — covers DRFT-06, DRFT-07, DRFT-08
- [ ] `src/lib/limited/__tests__/draft-storage.test.ts` — covers DRFT-10, DRFT-11
- [ ] Framework install: N/A — Jest already configured in project

## Sources

### Primary (HIGH confidence)
- [Scryfall Card Back Image](https://cards.scryfall.io/back/0/0.jpg) - Standard card back for face-down display
- [MTGJSON Booster Config](https://mtgjson.com/data-models/booster/booster-config/) - Pack structure (14 cards standard)
- [react-countdown-circle-timer](https://github.com/vydimitrov/react-countdown-circle-timer) - Timer color transition patterns

### Secondary (MEDIUM confidence)
- [dr4ft MTG Draft Simulator](https://github.com/dr4fters/dr4ft) - Draft UX patterns, open source reference
- [Game Programming Patterns: State](https://gameprogrammingpatterns.com/state.html) - Draft state machine design
- Project codebase patterns (pool-storage.ts, sealed-generator.ts, useTurnTimer.ts)

### Tertiary (LOW confidence)
- Community draft timer implementations (need verification against DRFT-06/07 requirements)

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH - All libraries already in project, no new deps
- Architecture: HIGH - Building on established Phase 14 patterns
- Pitfalls: MEDIUM - Draft-specific pitfalls identified from research, need real-world testing

**Research date:** 2026-03-18
**Valid until:** 2026-04-18 (30 days - stable domain, established patterns)
