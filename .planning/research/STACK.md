# Stack Research: Draft/Sealed Limited Modes

**Domain:** Magic: The Gathering Digital Draft/Sealed Simulator
**Researched:** 2026-03-18
**Confidence:** HIGH

## Executive Summary

Planar Nexus v1.4 introduces Draft/Sealed Limited modes. This research identifies minimal stack additions required, leveraging existing infrastructure (Next.js 15, React 19, TypeScript, Dexie.js, Scryfall API, Zustand-ready patterns). The core insight: **Draft/Sealed is primarily a state management problem with moderate complexity additions for pack generation, timers, and AI neighbor simulation**.

Key decisions:
- **State Management:** Zustand (lightweight, game-state optimized, already considered)
- **Timers:** Custom React hook (no new dependency)
- **Pack Generation:** Server-side logic using existing Scryfall integration
- **AI Neighbors:** Extend existing heuristic draft assistant
- **Persistence:** Extend existing Dexie.js storage

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Zustand** | `^5.0.0` | Draft state management | Lightweight alternative to Redux; modular slices pattern perfect for game state (draft picks, pool management, timer state); built-in persistence middleware; React 19 compatible |

### New Dependencies Required

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Zustand** | `^5.0.0` | Game state management | Single new dependency; handles draft session state, pick history, timer state, pool composition; integrates with existing persistence layer |

### Existing Technologies (No Changes Needed)

| Technology | Purpose in Draft/Sealed |
|------------|------------------------|
| **Next.js 15** | App Router handles draft/sealed page routes |
| **React 19** | Concurrent features for smooth timer updates |
| **TypeScript** | DraftSession, DraftPick, SealedPool types |
| **Dexie.js** | Persist draft sessions, saved pools |
| **Scryfall API** | Fetch set cards for pack generation |
| **Shadcn/ui** | Set selection UI, timer display |
| **@tanstack/react-virtual** | Virtualize large card pools in UI |

---

## Detailed Analysis by Feature

### 1. Pack Simulation

**What it does:** Generates randomized packs (typically 14-15 cards) from a selected set.

**Stack approach:** Server-side logic + client-side randomization seed

| Component | Implementation | Why |
|-----------|---------------|-----|
| **Card Data** | Fetch from existing `/api/sets` endpoint | Already integrated |
| **Pack Generator** | New utility function `generatePack(cards, rarityWeights)` | Deterministic with seed for reproducibility |
| **Rarity Distribution** | MTG standard: 1 rare/mythic, 3 uncommons, 10 commons, 1 land (draft) | Configurable per format |

**Rarity weights from Scryfall:**
```typescript
// Scryfall provides rarity in card object
interface ScryfallCard {
  rarity: 'common' | 'uncommon' | 'rare' | 'mythic';
}
```

**Why NOT a new library:** Pack generation is simple math (shuffle + slice by rarity). No specialized library needed.

### 2. Timer System

**What it does:** Countdown timer for draft picks (typically 40-50 seconds per pick).

**Stack approach:** Custom React hook (no external dependency)

```typescript
// src/hooks/useDraftTimer.ts
export function useDraftTimer(
  initialSeconds: number,
  onExpire: () => void
) {
  const [secondsLeft, setSecondsLeft] = useState(initialSeconds);
  const [isRunning, setIsRunning] = useState(false);
  const intervalRef = useRef<number | null>(null);

  // ... implementation
}
```

**Why NOT a library:** 
- Draft timers are simple (countdown, pause/resume, callbacks)
- Custom hook is <30 lines
- Avoids bundle bloat for a single use case
- Full control over behavior (overtime handling, network sync)

**Timer states needed:**
- `idle` - Not started
- `running` - Counting down
- `paused` - Timer suspended (e.g., user reviewing cards)
- `expired` - Time's up (auto-pick or skip)

### 3. AI "Neighbor" Logic (Draft Table Simulation)

**What it does:** Simulates other drafters picking cards, affecting which cards appear in future packs.

**Stack approach:** Extend existing `ai-draft-assistant.ts` heuristics

| Component | Implementation | Why |
|-----------|---------------|-----|
| **Bot Pool** | Track each bot's picks, colors, archetypes | Already have card data structures |
| **Bot Pick Logic** | Heuristic algorithm (color preference, archetype alignment) | Existing `getDraftPickRecommendation` provides foundation |
| **Pack Passing** | Rotate packs based on draft position and round | Simple array rotation |

**Bot difficulty levels:**
| Level | Behavior | Implementation |
|-------|----------|----------------|
| **Easy** | Random picks | `Math.random()` selection |
| **Medium** | Color-focused heuristics | Existing logic in `ai-draft-assistant.ts` |
| **Hard** | Archetype optimization | Extended heuristics + synergy detection |

**Why NOT neural networks:**
- Overkill for single-player practice
- Heuristics are explainable and predictable
- Faster execution, no model loading
- Can always add ML later if desired

### 4. State Management for Draft Picks / Sealed Pool

**Stack approach:** Zustand with modular slices

```typescript
// src/stores/draftStore.ts
interface DraftSlice {
  // Session state
  draftId: string;
  setCode: string;
  draftType: 'booster' | 'sealed';
  currentPack: number;
  currentPick: number;
  
  // Player state
  pool: DraftCard[];
  picks: DraftPick[];
  
  // Actions
  addToPool: (card: ScryfallCard) => void;
  makePick: (cardId: string) => void;
  nextPack: () => void;
}
```

**Why Zustand over alternatives:**

| Consideration | Zustand | Redux Toolkit | React Context |
|---------------|---------|---------------|---------------|
| Bundle size | ~1KB | ~12KB | 0KB (built-in) |
| Boilerplate | Minimal | Moderate | Minimal |
| DevTools | Excellent | Excellent | Limited |
| Persistence | Middleware | Middleware | Manual |
| TypeScript | First-class | First-class | Manual |
| Performance | Fine-grained selectors | Fine-grained selectors | Re-render issues |

**Existing patterns to follow:**
The codebase already uses `useLocalStorage` hook. Zustand persistence middleware can extend this pattern.

### 5. Set Selection UI

**What it does:** Allow user to select which MTG set(s) to draft or seal.

**Stack approach:** Extend existing Scryfall integration

| Component | Implementation | Why |
|-----------|---------------|-----|
| **Set List** | Fetch from `GET /sets` endpoint | Scryfall API already available |
| **Set Metadata** | Store: name, code, release date, card count | Cache in Dexie for offline |
| **UI Component** | Shadcn Select/Combobox | Already in use |
| **Set Filtering** | Filter by: Standard legal, Modern legal, recent | Client-side filter |

**Set data from Scryfall:**
```typescript
interface ScryfallSet {
  id: string;
  code: string;
  name: string;
  released_at: string;
  card_count: number;
  digital: boolean;
  block_code: string;
}
```

### 6. "Limited" Pool Filter in Deck Builder

**What it does:** When building from a limited pool, filter available cards to only those in the pool.

**Stack approach:** Extend existing deck builder state

| Component | Implementation | Why |
|-----------|---------------|-----|
| **Pool Mode** | New deck builder mode: `pool` | Segregate from constructed decks |
| **Card Filter** | Filter by pool cards | Already have search/filter infrastructure |
| **Deck Validation** | Apply `limited` format rules | `game-rules.ts` already has `limited` format |

**Format rules from `game-rules.ts`:**
```typescript
limited: {
  maxCopies: 4,
  minCards: 40,
  maxCards: Infinity,
  startingLife: 20,
  commanderDamage: null,
  usesSideboard: false,
  sideboardSize: 0,
}
```

---

## Installation

```bash
# Only new dependency needed
npm install zustand@^5.0.0

# No changes to existing dependencies
# All other features use existing infrastructure:
# - Scryfall API (existing server actions)
# - Dexie.js (existing indexeddb-storage.ts)
# - Shadcn/ui (existing components)
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| **Zustand** | Redux Toolkit | Team already deeply invested in Redux; needs extensive middleware |
| **Zustand** | Jotai | Prefer atomic state; simpler selector model |
| **Custom Timer Hook** | react-countdown | Need pre-built UI components; multiple timer types |
| **Heuristic Bots** | TensorFlow.js / ML | Production ML infrastructure exists; need adaptive opponents |
| **Server-side Pack Gen** | Client-side generation | Offline play is priority (Tauri); can cache sets locally |

### Why NOT Redux Toolkit
- 10x bundle size (12KB vs ~1KB)
- Redux requires more boilerplate (actions, reducers, slices)
- Draft state is simple (no complex async middleware needed)
- Zustand has equivalent DevTools support

### Why NOT React Context
- Context causes unnecessary re-renders in large card lists
- No built-in DevTools for debugging
- Manual persistence required
- Zustand's `useStore` selectors are more performant

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **Redux Toolkit** | Excessive boilerplate and bundle size for draft state | Zustand |
| **react-timer-hook** | Adds bundle size for simple countdown | Custom hook |
| **TensorFlow.js** | Overkill for single-player heuristics; slow initialization | Heuristic algorithms |
| **Server-side pack generation library** | No MTG-specific library exists | Custom generator using Scryfall data |
| **Firebase/Realtime DB** | Over-engineering for single-player | Dexie.js + optional sync later |

---

## Stack Patterns by Variant

**If Draft (Booster Draft):**
- Use Zustand `draftStore` for session state
- Implement pack passing logic (array rotation)
- 8 bots with heuristic picks (easy/medium/hard)
- Timer per pick with configurable duration

**If Sealed (Sealed Deck):**
- Use Zustand `sealedStore` for pool state  
- Generate all 6 packs at once
- No timer (player works at own pace)
- Direct deck building from pool

**If Hybrid (Draft → Sealed → Deck):**
- Single Zustand store with mode flag
- Phases: `drafting` → `sealed-viewing` → `deck-building`
- Persist full draft session in Dexie

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|----------------|-------|
| **zustand@^5.0.0** | React 19, Next.js 15 | Requires React 18.2+ |
| **zustand** | Dexie.js | Both work with IndexedDB |
| **zustand** | existing hooks | Can coexist with `useLocalStorage` |

---

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Draft Session                             │
├─────────────────────────────────────────────────────────────────┤
│  User Actions          │  State (Zustand)      │  Persistence  │
│  ─────────────         │  ────────────────     │  ────────────  │
│  • selectSet()         │  draftSession: {      │  Dexie.js:    │
│  • makePick()          │    setCode,           │  • draftSessions│
│  • skipPick()          │    playerPool,        │  • sealedPools │
│  • startTimer()        │    botPools[],        │  • draftHistory │
│  • expireTimer()        │    currentPack,      │                │
│                        │    timerSeconds,      │                │
│                        │    timerState         │                │
│                        │  }                    │                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Pack Generation                              │
│  ────────────────────                                            │
│  1. Fetch set cards from Scryfall (cached in Dexie)             │
│  2. Apply rarity weights (1 rare, 3 uncommon, 10 common)        │
│  3. Shuffle with seed for reproducibility                      │
│  4. Distribute to 9 draft positions (rotating)                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     AI Neighbor Bots                             │
│  ────────────────────                                            │
│  1. Each bot tracks: picked colors, archetypes, power level      │
│  2. On each pick: heuristic selection from available cards      │
│  3. Simple: pick highest-rated card in preferred colors         │
│  4. Advanced: synergy scoring with existing pool                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Sources

- [Zustand v5 Documentation](https://zustand.docs.pmnd.rs) — Game state patterns, persistence (HIGH)
- [Scryfall API - Sets Endpoint](https://scryfall.com/docs/api/sets) — Set metadata, card counts (HIGH)
- [MTG Draft Format Rules](https://mtg.fandom.com/wiki/Booster_Draft) — Rarity distribution, pack structure (MEDIUM)
- [Draftsim Bot Architecture](https://draftsim.com/ryan-saxe-bot-model/) — AI neighbor logic patterns (MEDIUM)
- [Zustand Game Patterns Skill](https://playbooks.com/skills/ccalebcarter/purria-skills/zustand-game-patterns) — Modular store slices (HIGH)

---

## Conclusion

**Single new dependency:** Zustand `^5.0.0`

Draft/Sealed modes are achievable by extending existing infrastructure:
- **Scryfall** → Pack generation
- **Dexie.js** → Persistence
- **Shadcn/ui** → UI components
- **Existing heuristics** → AI neighbor logic
- **NEW: Zustand** → State management

This approach minimizes new dependencies while providing robust, maintainable architecture for limited formats.

---
*Stack research for: Draft/Sealed Limited Modes (v1.4)*
*Researched: 2026-03-18*
