# Phase 14: Foundation - Research

**Researched:** 2026-03-18
**Domain:** MTG Draft/Sealed Limited Modes - Set Selection, Pool Generation, Deck Building
**Confidence:** MEDIUM-HIGH

## Summary

Phase 14 establishes the foundation for Draft/Sealed limited modes. This involves building a set selection browser, sealed pool generation system, and a limited deck builder with pool isolation. The Scryfall API provides set metadata via `/sets` endpoint, while MTGJSON's `mtg-sealed-content` repository contains official sealed product configurations for authentic pack generation. The existing codebase has strong patterns for IndexedDB storage, card database management, and Shadcn/ui components that should be extended rather than duplicated.

**Primary recommendation:** Build set selection as a new page with Scryfall API integration, create sealed pool generation using official MTGJSON sealed content data, extend existing deck builder with "Limited" mode filter, and implement session-based storage for pool isolation.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SET-01 | Browse MTG sets by name, release date, popularity | Scryfall `/sets` endpoint provides all metadata |
| SET-02 | Select a set for Draft or Sealed | UI flow: browse → select → confirm → start |
| SET-03 | Show card count and set details before confirming | Scryfall set objects include `card_count` |
| SEAL-01 | Start new Sealed session with selected set | Session creation with UUID, 6-pack generation |
| SEAL-02 | Open 6 packs immediately, all cards revealed | MTGJSON sealed content config, random pack generation |
| SEAL-03 | Browse/filter sealed pool by color, type, CMC | Extend existing filter infrastructure |
| SEAL-04 | Sealed pool persists across page refresh | Session storage with IndexedDB |
| SEAL-05 | Sealed pool can be saved and resumed | Session persistence with named saves |
| LBld-01 | Build deck from draft/sealed pool only | Pool-scoped deck builder mode |
| LBld-02 | "Limited" filter restricting to current pool | Mode toggle in deck builder |
| LBld-03 | 40-card minimum validation | Existing format validation (extend) |
| LBld-04 | 4-copy limit validation | Existing validation patterns |
| LBld-05 | No sideboard (40-card main deck only) | Limited format rules in game-rules.ts |
| LBld-06 | Save/load limited deck for session | Session-scoped deck storage |
| ISOL-01 | Pool cards don't appear in collection | Separate pool storage, not in deck-storage |
| ISOL-02 | Pool scoped to specific session | Session ID isolation |
| ISOL-03 | Pool has session ID, cannot be merged | UUID-based pool identity |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js App Router | 15.5.12 | Page routing, layouts | Project standard |
| Shadcn/ui + Radix | latest | UI components | Project standard |
| Dexie.js | 4.3.0 | IndexedDB wrapper | Project standard (see deck-storage.ts) |
| date-fns | 3.6.0 | Date formatting for release dates | Lightweight, tree-shakeable |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @tanstack/react-virtual | 3.13.23 | Virtual scrolling for large sets | Set browser with many results |
| Lucide React | latest | Icons | Project standard |

### No New Dependencies Required
- **Card Database**: Uses existing `card-database.ts` with IndexedDB
- **Deck Storage**: Uses existing `deck-storage.ts` patterns
- **Filter Infrastructure**: Extends existing `filter-cards.ts`, `filter-types.ts`
- **Game Rules**: Uses existing `game-rules.ts` with `limited` preset

**Installation:** No new packages required for Phase 14 core functionality.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── app/(app)/
│   ├── set-browser/              # NEW: Set selection page
│   │   └── page.tsx
│   ├── sealed/                   # NEW: Sealed session page
│   │   ├── page.tsx
│   │   └── _components/
│   │       ├── sealed-pool-view.tsx
│   │       └── pack-opener.tsx
│   └── limited-deck-builder/     # NEW: Limited deck building
│       ├── page.tsx
│       └── _components/
├── lib/
│   ├── limited/                  # NEW: Limited mode core
│   │   ├── set-service.ts        # Scryfall set API integration
│   │   ├── sealed-generator.ts   # Pack/card pool generation
│   │   ├── pool-storage.ts       # IndexedDB pool persistence
│   │   └── limited-validator.ts  # 40-card, 4-copy validation
│   ├── search/                   # Existing - extend for pool filtering
│   └── deck-storage.ts           # Existing patterns to follow
└── hooks/
    └── use-limited-session.ts    # NEW: Session state management
```

### Pattern 1: Session-Based Storage
**What:** Pools and sessions stored with UUID-based keys, isolated from regular deck collection.
**When to use:** For SEAL-04, SEAL-05, ISOL-02, ISOL-03 requirements.
**Example:**
```typescript
// From existing indexeddb-storage.ts patterns
interface LimitedSession {
  id: string;                    // UUID - ISOL-03
  setCode: string;
  mode: 'sealed' | 'draft';
  pool: PoolCard[];
  deck: DeckCard[];
  createdAt: string;
  updatedAt: string;
}

// Pool-scoped storage - not in regular deck-storage
const limitedStorage = new Dexie.Table<LimitedSession, string>('limited-sessions');
```

### Pattern 2: Pool-Filtered Card Search
**What:** Extend existing filter hooks with pool-scoped filtering.
**When to use:** For LBld-02, SEAL-03 requirements.
**Example:**
```typescript
// Extend existing useCardFilters hook
interface LimitedDeckBuilderProps {
  sessionId: string;
  poolFilter: boolean;  // LBld-02: "Limited" filter
}

// Pool cards loaded from session storage, not full database
const poolCards = await poolStorage.getPoolCards(sessionId);
const filteredPool = filterCards(poolCards, filters);
```

### Pattern 3: Pack Generation Algorithm
**What:** Weighted random card selection based on official rarity distribution.
**When to use:** For SEAL-02 requirement.
**Reference:** MTGJSON `mtg-sealed-content` repository provides official configurations.

### Pattern 4: Set Browser with Scryfall API
**What:** Fetch and cache set metadata with sorting/filtering.
**When to use:** For SET-01, SET-02, SET-03 requirements.
**Example:**
```typescript
// Scryfall API - GET https://api.scryfall.com/sets
interface ScryfallSet {
  id: string;
  code: string;
  name: string;
  set_type: string;
  card_count: number;
  released_at: string;
  // ... other fields
}

// Cache in IndexedDB for offline set browsing
const setCache = new Dexie.Table<CachedSet, string>('set-cache');
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Set list data | Manual MTG set database | Scryfall `/sets` API | Official, always current, includes metadata |
| Pack content | Arbitrary card selection | MTGJSON `mtg-sealed-content` configs | Authentic rarity/print-run distribution |
| Rarity distribution | Guessed probabilities | Official MTGJSON data | Match real pack experience |
| Session persistence | localStorage | IndexedDB via Dexie | Structured queries, larger storage |

**Key insight:** MTG sealed products have complex print-run algorithms (e.g., 1 rare per pack guaranteed, slot-based distribution). Using official MTGJSON configurations ensures authentic experience without reverse-engineering Wizards' algorithms.

## Common Pitfalls

### Pitfall 1: Scryfall Rate Limiting
**What goes wrong:** Set browser fails with 429 errors during bulk fetch.
**Why it happens:** Scryfall limits to 10 requests/second; `/sets` returns ~300+ sets.
**How to avoid:** 
- Fetch all sets once, cache in IndexedDB
- Use `ETag`/`Last-Modified` headers for conditional requests
- Show cached data while refreshing in background
**Warning signs:** Console errors with `429 Too Many Requests`

### Pitfall 2: Pool Isolation Breach
**What goes wrong:** Limited pool cards appear in regular deck builder search.
**Why it happens:** Shared search functions return pool cards mixed with collection.
**How to avoid:**
- Clear separation: pool search vs. collection search
- Pool-scoped queries that don't touch regular card database
- UI clearly shows "Limited Mode" with isolated card source
**Warning signs:** User reports being able to add cards they didn't open

### Pitfall 3: Session State Loss
**What goes wrong:** Sealed pool disappears on refresh or navigation.
**Why it happens:** Session state stored in React state, not persisted storage.
**How to avoid:**
- Persist immediately on any pool change
- Load from IndexedDB on page mount
- Use URL params for session ID (sharable links)
**Warning signs:** Console warnings about hydration mismatches

### Pitfall 4: Pack Generator Authenticity
**What goes wrong:** Generated packs don't feel like real Magic packs.
**Why it happens:** Simple random distribution doesn't match official print runs.
**How to avoid:**
- Use MTGJSON sealed content for rarity slots
- Respect mythic/rare distribution (e.g., ~1:8 mythic rate)
- Include basic land/common slot rules per set
**Warning signs:** Too many mythics, unusual rarity distribution

### Pitfall 5: Filter Performance on Large Pools
**What goes wrong:** Filtering 200+ pool cards is slow.
**Why it happens:** Re-rendering entire card grid on each filter change.
**How to avoid:**
- Virtual scrolling (already in deck-builder via @tanstack/react-virtual)
- Debounce filter changes
- Memoize filtered results
**Warning signs:** UI freezing when applying filters

## Code Examples

### Scryfall Set Fetch (SET-01, SET-02, SET-03)
```typescript
// Source: https://scryfall.com/docs/api/sets/all
interface ScryfallSet {
  id: string;
  code: string;
  name: string;
  set_type: string;
  card_count: number;
  released_at: string;
  icon_svg_uri: string;
}

async function fetchAllSets(): Promise<ScryfallSet[]> {
  const response = await fetch('https://api.scryfall.com/sets');
  const data = await response.json();
  return data.data; // Array of set objects
}

// Sort by release date (newest first) or name
const sortedSets = sets.sort((a, b) => {
  return new Date(b.released_at).getTime() - new Date(a.released_at).getTime();
});
```

### Pack Generation (SEAL-02)
```typescript
// Source: MTGJSON mtg-sealed-content (https://github.com/mtgjson/mtg-sealed-content)
// Simplified standard draft booster: 14 cards per pack
interface PackConfig {
  slots: {
    [rarity: string]: {
      cards: Array<{ uuid: string; weight: number }>;
      count: number;
    };
  };
}

// Standard pack: 10 commons, 3 uncommons, 1 rare/mythic
function generatePack(setCode: string, config: PackConfig): string[] {
  const cards: string[] = [];
  
  // 10 commons
  for (let i = 0; i < 10; i++) {
    cards.push(pickWeightedRandom(config.slots.common));
  }
  
  // 3 uncommons
  for (let i = 0; i < 3; i++) {
    cards.push(pickWeightedRandom(config.slots.uncommon));
  }
  
  // 1 rare or mythic (typically 1:8 mythic ratio)
  const rareOrMythic = Math.random() < 0.125 
    ? config.slots.mythic 
    : config.slots.rare;
  cards.push(pickWeightedRandom(rareOrMythic));
  
  return cards; // 14 cards total
}
```

### Limited Deck Validation (LBld-03, LBld-04)
```typescript
// Extend existing game-rules.ts patterns
import { DEFAULT_RULES } from '@/lib/game-rules';

const LIMITED_RULES = {
  ...DEFAULT_RULES.limited,
  // LBld-05: No sideboard
  usesSideboard: false,
  sideboardSize: 0,
};

function validateLimitedDeck(cards: DeckCard[]): ValidationResult {
  const errors: string[] = [];
  const totalCards = cards.reduce((sum, c) => sum + c.count, 0);
  
  // LBld-03: 40-card minimum
  if (totalCards < 40) {
    errors.push(`Deck must have at least 40 cards (has ${totalCards})`);
  }
  
  // LBld-04: 4-copy limit
  const cardCounts = new Map<string, number>();
  for (const card of cards) {
    const current = cardCounts.get(card.name) || 0;
    const newCount = current + card.count;
    if (newCount > 4) {
      errors.push(`Maximum 4 copies of "${card.name}" allowed`);
    }
    cardCounts.set(card.name, newCount);
  }
  
  return { isValid: errors.length === 0, errors };
}
```

### Pool Isolation Storage (ISOL-01, ISOL-02, ISOL-03)
```typescript
// Source: Based on existing indexeddb-storage.ts patterns
import Dexie from 'dexie';

interface LimitedSession {
  id: string;          // ISOL-03: UUID - unique identity
  setCode: string;
  mode: 'sealed' | 'draft';
  pool: PoolCard[];   // ISOL-01: isolated from collection
  deck: DeckCard[];    // LBld-06: session-scoped
  createdAt: string;
  updatedAt: string;
}

class LimitedDatabase extends Dexie {
  sessions!: Dexie.Table<LimitedSession, string>;
  
  constructor() {
    super('PlanarNexusLimited');
    this.version(1).stores({
      sessions: 'id, setCode, mode, createdAt'  // ISOL-02: session-scoped
    });
  }
}

export const limitedDb = new LimitedDatabase();
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| MTGJSON AllSets download | Scryfall API for sets, IndexedDB cache | 2026 | Real-time updates, less local storage |
| Fixed pack distribution | MTGJSON mtg-sealed-content configs | 2024+ | Authentic print-run simulation |
| localStorage for decks | IndexedDB via Dexie | Phase 16 | Structured queries, better performance |
| Single deck storage | Session-scoped limited storage | Phase 14 | Clean isolation, no merge conflicts |

**Deprecated/outdated:**
- MTGJSON bulk downloads for set browsing (Scryfall API is live)
- Hardcoded pack configs per set (use MTGJSON mtg-sealed-content)
- localStorage for session data (use IndexedDB)

## Open Questions

1. **Set-specific pack configs**
   - What we know: MTGJSON `mtg-sealed-content` has configs, but requires setup
   - What's unclear: Should we pre-fetch configs or build dynamically?
   - Recommendation: Pre-fetch and cache common sets' configs; fetch others on demand

2. **Foil handling in sealed pools**
   - What we know: Modern sets have foil variants with different distribution
   - What's unclear: Should we include foil variants? What probability?
   - Recommendation: Defer foil handling to Phase 17+ (out of scope for v1.4)

3. **Set filtering in sealed pool view**
   - What we know: Draft boosters can include cards from multiple sets (e.g., jumpstart)
   - What's unclear: Should pool view filter by set or show all?
   - Recommendation: Show all cards, allow filtering by set if multi-set

4. **Bot draft sets (Phase 16)**
   - What we know: AI neighbors need their own pack generation
   - What's unclear: Share pack generation code between player and bot?
   - Recommendation: Centralize in `sealed-generator.ts`, pass session ID

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 29.7 + @testing-library/react 16.3 |
| Config file | jest.config.js |
| Quick run command | `npm test -- --testPathPattern="limited|sealed|set-browser"` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SET-01 | Browse sets sorted by date/name | unit | `npm test -- --testPathPattern="set-service"` | ❌ Wave 0 |
| SET-02 | Set selection flow | unit | `npm test -- --testPathPattern="limited"` | ❌ Wave 0 |
| SET-03 | Card count display | unit | `npm test -- --testPathPattern="set-browser"` | ❌ Wave 0 |
| SEAL-01 | Sealed session creation | unit | `npm test -- --testPathPattern="sealed-generator"` | ❌ Wave 0 |
| SEAL-02 | 6-pack, 14-card pack generation | unit | `npm test -- --testPathPattern="sealed-generator"` | ❌ Wave 0 |
| SEAL-03 | Pool filtering (color, type, CMC) | unit | `npm test -- --testPathPattern="pool-storage"` | ❌ Wave 0 |
| SEAL-04 | Pool persistence | integration | `npm test -- --testPathPattern="pool-storage" --testNamePattern="persist"` | ❌ Wave 0 |
| SEAL-05 | Save/resume session | integration | `npm test -- --testPathPattern="pool-storage" --testNamePattern="save"` | ❌ Wave 0 |
| LBld-01 | Pool-only deck building | unit | `npm test -- --testPathPattern="limited-validator"` | ❌ Wave 0 |
| LBld-02 | Limited filter mode | unit | `npm test -- --testPathPattern="limited"` | ❌ Wave 0 |
| LBld-03 | 40-card minimum | unit | `npm test -- --testPathPattern="limited-validator" --testNamePattern="40-card"` | ❌ Wave 0 |
| LBld-04 | 4-copy limit | unit | `npm test -- --testPathPattern="limited-validator" --testNamePattern="4-copy"` | ❌ Wave 0 |
| LBld-05 | No sideboard | unit | `npm test -- --testPathPattern="limited-validator"` | ❌ Wave 0 |
| LBld-06 | Save/load limited deck | integration | `npm test -- --testPathPattern="pool-storage" --testNamePattern="deck"` | ❌ Wave 0 |
| ISOL-01 | Pool cards not in collection | unit | `npm test -- --testPathPattern="pool-storage" --testNamePattern="isolation"` | ❌ Wave 0 |
| ISOL-02 | Session-scoped pool | unit | `npm test -- --testPathPattern="pool-storage" --testNamePattern="session"` | ❌ Wave 0 |
| ISOL-03 | Unique session ID | unit | `npm test -- --testPathPattern="pool-storage" --testNamePattern="UUID"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- --testPathPattern="limited|sealed|set-browser" --passWithNoTests`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/lib/limited/__tests__/set-service.test.ts` — covers SET-01, SET-02, SET-03
- [ ] `src/lib/limited/__tests__/sealed-generator.test.ts` — covers SEAL-01, SEAL-02
- [ ] `src/lib/limited/__tests__/pool-storage.test.ts` — covers SEAL-03, SEAL-04, SEAL-05, ISOL-01, ISOL-02, ISOL-03
- [ ] `src/lib/limited/__tests__/limited-validator.test.ts` — covers LBld-01, LBld-02, LBld-03, LBld-04, LBld-05, LBld-06
- [ ] `src/lib/limited/__tests__/setup.ts` — Jest setup with fake-indexeddb
- [ ] Framework install: N/A — Jest already configured in project

## Sources

### Primary (HIGH confidence)
- [Scryfall API - Sets Endpoint](https://scryfall.com/docs/api/sets) - Set data structure, API usage
- [Scryfall API - All Sets](https://scryfall.com/docs/api/sets/all) - Bulk set fetch
- [MTGJSON mtg-sealed-content](https://github.com/mtgjson/mtg-sealed-content) - Official sealed product configs
- [MTGJSON Booster Config](https://mtgjson.com/data-models/booster/booster-config/) - Pack structure data model

### Secondary (MEDIUM confidence)
- [Project codebase patterns](file:///home/alex/Projects/planar-nexus/src) - Existing IndexedDB, deck storage, filter infrastructure

### Tertiary (LOW confidence)
- Community pack generation algorithms (need verification against official MTGJSON data)

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH - Using existing project patterns and official APIs
- Architecture: HIGH - Building on established codebase patterns
- Pitfalls: MEDIUM - Identified from codebase review, some scenarios need real-world testing

**Research date:** 2026-03-18
**Valid until:** 2026-04-18 (30 days - stable domain, official APIs)
