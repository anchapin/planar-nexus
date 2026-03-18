# Architecture Research: Draft/Sealed Limited Modes

**Domain:** MTG-like digital tabletop with Draft/Sealed modes
**Project:** Planar Nexus v1.4
**Researched:** 2026-03-18
**Confidence:** MEDIUM-HIGH

## Executive Summary

Draft and Sealed are **asynchronous** limited formats that differ fundamentally from constructed play. Draft requires pack-by-pack card selection with passing mechanics, while Sealed is a simpler pool-building experience. Both formats need new state management that operates **orthogonally** to the existing deck builder, with different persistence requirements and UI flows.

The existing codebase has strong foundations:
- Card database with IndexedDB persistence
- AI draft assistant (text-based, not interactive)
- Limited format rules already defined
- Timer hooks available

**Key gap:** No pack generation, draft state machine, or sealed pool management exists.

## Recommended Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        LAYER 1: UI Components                        │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐│
│  │DraftPicker  │  │SealedPool   │  │DraftTimer   │  │LimitedDeck  ││
│  │Modal        │  │Viewer        │  │Display      │  │Builder      ││
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘│
├─────────┴────────────────┴─────────────────┴─────────────────────────┤
│                        LAYER 2: State Management                     │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              LimitedSessionContext (React Context)            │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │   │
│  │  │ DraftState  │  │ SealedState │  │ TimerState  │         │   │
│  │  │ - picks[]   │  │ - pool[]    │  │ - remaining │         │   │
│  │  │ - packIdx   │  │ - colors[]  │  │ - isRunning │         │   │
│  │  │ - passed[]  │  │ - deck[]    │  │             │         │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘         │   │
│  └──────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────┤
│                        LAYER 3: Business Logic                      │
├─────────────────────────────────────────────────────────────────────┤
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐        │
│  │PackGenerator  │  │DraftEngine    │  │SealedEngine  │        │
│  │- randomCards()│  │- makePick()   │  │- openPool()   │        │
│  │- setFilter()  │  │- getPool()    │  │- buildDeck()  │        │
│  └───────────────┘  └───────────────┘  └───────────────┘        │
├─────────────────────────────────────────────────────────────────────┤
│                        LAYER 4: Persistence                         │
├─────────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              LimitedStorage (IndexedDB Store)                  │  │
│  │  - drafts: in-progress drafts                                 │  │
│  │  - sealed: sealed pools                                       │  │
│  │  - sessions: completed events                                 │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Implementation |
|-----------|---------------|----------------|
| `DraftPickerModal` | Pack display, card selection, passing animation | New component |
| `SealedPoolViewer` | Pool cards grid, color filtering, deck preview | New component |
| `DraftTimerDisplay` | Countdown timer, pause/resume, warnings | Extend existing `use-turn-timer.ts` |
| `LimitedDeckBuilder` | Pool-aware deck building with drag-drop | Extend existing deck-builder |
| `LimitedSessionContext` | Session state, persistence sync, undo support | New React Context |
| `PackGenerator` | Seeded random pack creation from card set | New utility class |
| `DraftEngine` | Pick tracking, pool management, AI opponent simulation | New utility class |
| `SealedEngine` | Pool generation, deck optimization | New utility class |
| `LimitedStorage` | IndexedDB operations for limited data | Extend `indexeddb-storage.ts` |

## Project Structure

```
src/
├── lib/
│   ├── limited/
│   │   ├── types.ts                 # Draft/Sealed types
│   │   ├── pack-generator.ts        # Pack creation logic
│   │   ├── draft-engine.ts          # Draft session management
│   │   ├── sealed-engine.ts         # Sealed session management
│   │   ├── limited-rules.ts         # Format-specific rules
│   │   └── limited-storage.ts       # IndexedDB persistence
│   ├── game-rules.ts               # EXISTING - add limited format
│   └── card-database.ts            # EXISTING - reuse for card access
├── hooks/
│   ├── use-limited-session.ts      # Main session hook
│   ├── use-draft-timer.ts          # Draft-specific timer
│   └── use-limited-storage.ts       # Persistence hook
├── contexts/
│   └── limited-session-context.tsx  # React Context provider
├── components/
│   ├── limited/
│   │   ├── draft-picker-modal.tsx
│   │   ├── pack-display.tsx
│   │   ├── passed-cards-viewer.tsx
│   │   ├── sealed-pool-viewer.tsx
│   │   ├── sealed-deck-builder.tsx
│   │   ├── draft-timer.tsx
│   │   ├── color-filter.tsx
│   │   └── limited-deck-stats.tsx
│   └── ui/                         # EXISTING shadcn components
├── app/(app)/
│   ├── draft/                      # NEW - Draft mode route
│   │   └── page.tsx
│   ├── sealed/                     # NEW - Sealed mode route
│   │   └── page.tsx
│   └── draft-assistant/           # EXISTS - enhance with interactive mode
│       └── page.tsx
└── ai/
    └── flows/
        └── ai-draft-assistant.ts   # EXISTS - integrate with draft engine
```

### Structure Rationale

- **`lib/limited/`:** Pure business logic, no React dependencies. Testable in isolation.
- **`hooks/use-limited-session.ts`:** Bridge between engine and UI. Handles React lifecycle.
- **`contexts/limited-session-context.tsx`:** Provides session state to nested components without prop drilling.
- **`components/limited/`:** UI-only components. Receive data via props/context.
- **Route pages:** Entry points that set up providers and wire up components.

## Data Types

### Core Types (`lib/limited/types.ts`)

```typescript
// Shared limited types
interface LimitedCard {
  cardId: string;           // Reference to card-database card
  pickedAt: number;         // Timestamp for undo
  packNumber: number;       // Which pack
  pickNumber: number;       // Which pick in that pack
  sourcePack: string;       // Set code of origin
}

interface LimitedSession {
  id: string;
  type: 'draft' | 'sealed';
  format: LimitedFormat;
  startedAt: string;
  updatedAt: string;
  status: 'in_progress' | 'completed' | 'abandoned';
  cards: LimitedCard[];      // All cards acquired
  deck: LimitedCard[];       // Cards in current deck
  sideboard: LimitedCard[];  // Cards not in deck
}

// Draft-specific
interface DraftSession extends LimitedSession {
  type: 'draft';
  totalPacks: number;        // Usually 3 for single-color, 6 for 2-player
  currentPack: number;
  currentPick: number;
  timePerPick: number;       // Seconds
  picks: DraftPick[];
  passedPacks: DraftPack[];  // Cards that were passed
  aiNeighbors: AINeighborState[];
}

interface DraftPack {
  packNumber: number;
  pickNumber: number;
  cards: LimitedCard[];
  receivedFrom: 'self' | 'left' | 'right';
  passedTo: 'left' | 'right' | null;
}

interface DraftPick {
  packNumber: number;
  pickNumber: number;
  pickedCard: LimitedCard;
  timestamp: string;
}

// Sealed-specific  
interface SealedSession extends LimitedSession {
  type: 'sealed';
  pools: SealedPool[];
  currentDeck: SealedDeck;
}

interface SealedPool {
  setCode: string;
  cards: LimitedCard[];
  openedAt: string;
}

interface SealedDeck {
  maindeck: LimitedCard[];
  sideboard: LimitedCard[];
  colors: string[];
}

// Format definitions
type LimitedFormat = 'draft' | 'sealed' | 'flex-draft';

interface PackConfiguration {
  totalCards: number;        // 14 for normal, 15 for foil
  rareRarity: 'mythic' | 'rare';
  commonCount: number;
  uncommonCount: number;
  rareCount: number;
  landSlot: boolean;
  foilSlot: boolean;
}
```

### Integration with Existing Types

```typescript
// Extend existing DeckCard type for limited use
interface LimitedDeckCard extends DeckCard {
  limitedSessionId?: string;
  poolEntry?: {
    packNumber: number;
    pickNumber: number;
  };
}

// Extend SavedDeck for limited
interface SavedLimitedDeck extends SavedDeck {
  limitedSessionId?: string;
  buildFromSealed?: boolean;
}
```

## Pack Generation

### Architecture

```
PackGenerator
    │
    ├── getSeededRandom() → deterministic for replay/sharing
    ├── getRandom() → true random for fresh packs
    │
    ├── filterBySet(setCode) → cards from specific set
    ├── filterByLegalFormats(formats[]) → legal cards only
    │
    └── generatePack(config) → LimitedCard[]
```

### Implementation

```typescript
// lib/limited/pack-generator.ts
export class PackGenerator {
  private cardDatabase: CardDatabase;
  
  async generatePack(
    setCode: string,
    config: PackConfiguration = DEFAULT_PACK_CONFIG
  ): Promise<LimitedCard[]> {
    const allCards = await this.cardDatabase.getCardsBySet(setCode);
    
    // Seeded random for reproducibility
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const rng = new SeededRandom(seed);
    
    const pack: LimitedCard[] = [];
    
    // Mythic/rare slot
    pack.push(this.selectByRarity(allCards, ['mythic', 'rare'], rng));
    
    // Uncommons (3 for normal, double for rare-draft)
    for (let i = 0; i < config.uncommonCount; i++) {
      pack.push(this.selectByRarity(allCards, ['uncommon'], rng));
    }
    
    // Commons
    for (let i = 0; i < config.commonCount; i++) {
      pack.push(this.selectByRarity(allCards, ['common'], rng));
    }
    
    // Basic land slot (sometimes)
    if (config.landSlot && rng.next() > 0.9) {
      pack.push(this.selectLandSlot(allCards, rng));
    }
    
    // Foil slot (can be any rarity)
    if (config.foilSlot) {
      pack.push(this.selectFoilCard(allCards, rng));
    }
    
    return pack;
  }
  
  async generateSealedPool(
    setCode: string,
    packCount: number = 6
  ): Promise<LimitedCard[]> {
    const pool: LimitedCard[] = [];
    
    for (let i = 0; i < packCount; i++) {
      const pack = await this.generatePack(setCode);
      pool.push(...pack.map(card => ({
        ...card,
        packNumber: i + 1,
      })));
    }
    
    // Add basic lands
    pool.push(...this.generateBasicLands());
    
    return pool;
  }
}
```

### Default Pack Configuration

```typescript
const DEFAULT_PACK_CONFIG: PackConfiguration = {
  totalCards: 14,
  rareRarity: 'rare',
  commonCount: 10,
  uncommonCount: 3,
  rareCount: 1,
  landSlot: false,
  foilSlot: true,
};
```

## Draft State Machine

### States

```
┌─────────────┐
│   IDLE     │ ──startDraft()──> ┌─────────────────┐
└─────────────┘                   │   PACK_OPENING  │
                                  │   (showing pack) │
                                  └────────┬────────┘
                                           │ timer starts
┌─────────────┐    pickCard()    ┌─────────┴────────┐
│  COMPLETED  │ <──makePick()────│   AWAITING_PICK  │
│  (deck ready│                  └────────┬─────────┘
└──────┬──────┘                          │ timeout
       │                                 │ skipPick()
       │                                 ▼
       │                        ┌─────────────────┐
       └─────saveDeck()─────────│   PACK_PASSED   │
                                │  (next pack     │
                                │   incoming)     │
                                └────────┬────────┘
                                         │
                                         │ hasMorePacks?
                                         ▼
                                  ┌───────────────┐
                                  │ PACK_COMPLETE │
                                  │ (show deck)   │
                                  └───────────────┘
```

### State Transitions

```typescript
// lib/limited/draft-engine.ts
type DraftState = 
  | 'idle'
  | 'pack_opening'
  | 'awaiting_pick'
  | 'pack_passed'
  | 'pack_complete'
  | 'completed';

interface DraftEngine {
  state: DraftState;
  session: DraftSession;
  
  startDraft(format: LimitedFormat, setCodes: string[]): DraftSession;
  
  // State transitions
  openPack(): void;
  pickCard(cardId: string): void;
  skipPick(): void;
  undoLastPick(): boolean;
  passPack(direction: 'left' | 'right'): void;
  receivePack(pack: DraftPack): void;
  completeDraft(): LimitedSession;
  
  // Queries
  getCurrentPack(): DraftPack | null;
  getPool(): LimitedCard[];
  getTimeRemaining(): number;
}
```

### AI Neighbor Simulation (2-Player Draft)

For 2-player draft without network:

```typescript
interface AINeighborState {
  position: 'left' | 'right';
  currentPack: LimitedCard[];
  picks: string[];  // Card IDs picked
}

// Simple AI: picks best card by heuristic score
function simulateNeighborPick(
  pack: LimitedCard[],
  neighborState: AINeighborState
): LimitedCard {
  // Remove picked cards from pack
  const available = pack.filter(c => !neighborState.picks.includes(c.cardId));
  
  // Pick highest-scoring card
  return available.sort((a, b) => 
    getCardScore(b) - getCardScore(a)
  )[0];
}
```

## Sealed Pool Management

### Architecture

```
SealedEngine
    │
    ├── openPool(setCode) → generates 6 packs
    │
    ├── analyzePool() → color breakdown, curve, bombs
    │
    ├── buildDeck(pool, colors) → selected 40 cards
    │
    ├── validateDeck(deck, pool) → legality check
    │
    └── exportDeck(deck) → SavedDeck for game play
```

### Integration with Existing Deck Builder

The key insight: **limited decks come from pools, not collections**.

```typescript
// Reuse existing deck-builder with filter
interface LimitedDeckBuilderProps {
  pool: LimitedCard[];
  maxDeckSize: number;    // 40 for sealed, 45 for draft
  minDeckSize: number;    // 40
  maxCopies: number;      // 4 for most formats
  
  // Filter which pool cards are visible
  colorFilter?: string[];
  cardFilter?: 'maindeck' | 'sideboard' | 'all';
}
```

## Timer System

### Extend Existing `use-turn-timer.ts`

```typescript
// hooks/use-draft-timer.ts
interface UseDraftTimerOptions {
  totalPicks: number;
  timePerPick: number;
  onPickTimeout: (skipped: boolean) => void;
  onPickMade: () => void;  // Pause timer
}

interface UseDraftTimerReturn {
  timeRemaining: number;
  isRunning: boolean;
  pickStartTime: number;
  
  startPick(): void;
  pausePick(): void;
  stopPick(): void;
  resetTimer(): void;
  
  // Computed
  formattedTime: string;
  isWarning: boolean;
  isExpired: boolean;
}

// Default draft timer: 40 seconds per pick
const DEFAULT_DRAFT_TIME = 40;
```

### Timer Display Component

```typescript
// components/limited/draft-timer.tsx
interface DraftTimerProps {
  timeRemaining: number;
  isRunning: boolean;
  pickNumber: number;
  totalPicks: number;
  
  onPause?: () => void;
  onResume?: () => void;
}

// Visual states:
// - Normal (>15s): green, steady
// - Warning (6-15s): yellow, pulsing
// - Critical (1-5s): red, fast pulse  
// - Expired (0s): red, "Time's Up!" overlay
```

## State Persistence

### IndexedDB Schema Extension

```typescript
// Extend indexeddb-storage.ts or create limited-storage.ts
const LIMITED_DB_CONFIG = {
  dbName: 'PlanarNexusLimited',
  version: 1,
  stores: ['drafts', 'sealed', 'pack-history'],
};

// Store: drafts
interface DraftStoreSchema {
  id: string;                    // Primary key
  format: string;
  setCodes: string[];
  status: 'in_progress' | 'completed' | 'abandoned';
  currentPack: number;
  currentPick: number;
  pool: LimitedCard[];
  picks: DraftPick[];
  timeRemaining: number;         // For resume
  createdAt: string;
  updatedAt: string;
}

// Store: sealed
interface SealedStoreSchema {
  id: string;
  format: string;
  setCodes: string[];
  status: 'in_progress' | 'completed' | 'abandoned';
  pool: LimitedCard[];
  deck: LimitedCard[];
  sideboard: LimitedCard[];
  createdAt: string;
  updatedAt: string;
}

// Store: pack-history (for statistics)
interface PackHistorySchema {
  id: string;
  setCode: string;
  openedAt: string;
  contents: string[];  // Card names
  rarityDistribution: Record<string, number>;
}
```

### Auto-Save Strategy

```typescript
// Auto-save triggers:
// 1. After each pick
// 2. Every 30 seconds during draft
// 3. Before page unload (beforeunload event)
// 4. On timer expiration

class LimitedSessionPersistence {
  async saveSession(session: LimitedSession): Promise<void>;
  async loadSession(id: string): Promise<LimitedSession | null>;
  async listInProgressSessions(): Promise<LimitedSession[]>;
  async deleteSession(id: string): Promise<void>;
  
  // Resume support
  async getResumeState(id: string): Promise<ResumeState>;
}
```

## React Context Architecture

```typescript
// contexts/limited-session-context.tsx
interface LimitedSessionContextValue {
  // Session state
  session: LimitedSession | null;
  isLoading: boolean;
  error: string | null;
  
  // Draft-specific
  currentPack: DraftPack | null;
  timeRemaining: number;
  isTimerRunning: boolean;
  
  // Actions
  startDraft: (format: LimitedFormat, sets: string[]) => Promise<void>;
  pickCard: (cardId: string) => Promise<void>;
  undoPick: () => Promise<void>;
  passPack: () => void;
  
  // Sealed-specific
  openSealedPool: (setCode: string) => Promise<void>;
  addToDeck: (cardId: string) => void;
  removeFromDeck: (cardId: string) => void;
  
  // General
  saveDeck: () => Promise<SavedDeck>;
  abandonSession: () => Promise<void>;
}

const LimitedSessionProvider: React.FC<{ children: React.ReactNode }> = ({
  children
}) => {
  // State management, persistence, auto-save
  // ...
};

export const useLimitedSession = () => useContext(LimitedSessionContext);
```

## Integration Points

### External Services

| Service | Integration | Notes |
|---------|-------------|-------|
| Scryfall API | Already used in `src/lib/server-card-operations.ts` | Extend for bulk card fetch by set |
| Card Database | Already exists in `src/lib/card-database.ts` | Add set-based queries |
| Deck Storage | Already exists in `src/lib/deck-storage.ts` | Add limited deck variant |
| AI Draft Assistant | Already exists in `src/ai/flows/ai-draft-assistant.ts` | Integrate with DraftEngine |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Deck Builder ↔ Limited | Props + Context | Filter deck builder by pool |
| Game Board ↔ Limited Deck | Server Action | Convert limited cards to game cards |
| Draft Assistant ↔ Draft Engine | Function calls | AI picks integration |

## Build Order

### Phase 1: Foundation
1. **`lib/limited/types.ts`** — Type definitions
2. **`lib/limited/pack-generator.ts`** — Pack creation
3. **`lib/limited/limited-storage.ts`** — IndexedDB persistence
4. **Basic sealed UI** — Pool viewer, deck builder with pool filter

**Deliverable:** Can open sealed pool, build deck, save to regular decks.

### Phase 2: Draft Core
1. **`lib/limited/draft-engine.ts`** — State machine
2. **`hooks/use-draft-timer.ts`** — Timer logic
3. **`contexts/limited-session-context.tsx`** — State provider
4. **Draft picker UI** — Pack display, card selection

**Deliverable:** Complete a draft against "stub" (no real passing).

### Phase 3: Passing Simulation
1. **AI neighbor simulation** — Simple heuristic AI
2. **Passing animation** — Visual feedback for passed cards
3. **2-player bridge UI** — Start/join draft session

**Deliverable:** Realistic 2-player draft with AI.

### Phase 4: Polish
1. **Draft timer with warnings** — Audio, visual cues
2. **Undo functionality** — Within time limit
3. **Deck export to game** — Seamless play experience
4. **Statistics tracking** — Pack history, win rates

## Anti-Patterns

### Anti-Pattern 1: Pack Generation in UI

**What people do:** Generate packs in React components, re-fetching each render.

**Why it's wrong:** Pack contents could change between renders. No reproducibility.

**Do this instead:** Generate packs in engine layer, store in session state.

### Anti-Pattern 2: Duplicate Card State

**What people do:** Store cards separately in pool, deck, and sideboard arrays.

**Why it's wrong:** Card instances become inconsistent. Hard to track changes.

**Do this instead:** Single source of truth (`pool: LimitedCard[]`) with derived views (`deck`, `sideboard`).

### Anti-Pattern 3: No Timer Persistence

**What people do:** Timers run locally, don't sync. User can cheat by refreshing.

**Why it's wrong:** Breaks competitive integrity. Timer should persist server-side.

**Do this instead:** Store `pickStartTime` as timestamp, not `timeRemaining`.

### Anti-Pattern 4: Mixing Limited and Collection

**What people do:** Add drafted cards to regular collection.

**Why it's wrong:** Defeats limited format (you don't own drafted cards). Legal issues.

**Do this instead:** Keep limited cards isolated. Only save as `SavedLimitedDeck`.

## Scalability Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0-100 users | Client-side only, IndexedDB persistence |
| 100-1K users | Add server-side session storage for resume |
| 1K-10K users | Add pack generation seeding for consistency |
| 10K+ users | Add draft lobby, real-time passing via WebSocket |

### First Bottleneck: Pack Generation Performance

Generating 6 sealed packs requires fetching ~1000 cards. Optimization:

1. Pre-index cards by set/rarity in IndexedDB
2. Use `getAll()` with cursor, not individual queries
3. Cache set metadata for quick access

### Second Bottleneck: Large Pool Rendering

Sealed pools can have 100+ cards. Optimization:

1. Virtual scrolling for pool view
2. Lazy-load card images
3. Memoize filtered views

## Sources

- MTG comprehensive rules for Draft/Sealed mechanics (LOW confidence - not verified)
- Existing `src/lib/game-rules.ts` format definitions (HIGH - codebase)
- Existing `src/lib/card-database.ts` card access patterns (HIGH - codebase)
- Existing `src/hooks/use-turn-timer.ts` timer implementation (HIGH - codebase)
- Existing `src/ai/flows/ai-draft-assistant.ts` heuristic logic (HIGH - codebase)
- IndexedDB patterns from `src/lib/indexeddb-storage.ts` (HIGH - codebase)

---

*Architecture research for: Draft/Sealed Limited Modes*
*Researched: 2026-03-18*
