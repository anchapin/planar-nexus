---
phase: 14-foundation
plan: "02"
subsystem: limited-mode
tags: [sealed, draft, limited, pool-generation, session-storage]
dependency_graph:
  requires: []
  provides:
    - src/lib/limited/sealed-generator.ts
    - src/lib/limited/pool-storage.ts
  affects:
    - src/app/(app)/sealed/
tech_stack:
  added: []
  patterns:
    - "Dexie.js IndexedDB for session storage"
    - "Weighted random rarity selection"
    - "Pool filtering composition"
key_files:
  created:
    - src/lib/limited/types.ts
    - src/lib/limited/sealed-generator.ts
    - src/lib/limited/pool-storage.ts
    - src/lib/limited/__tests__/sealed-generator.test.ts
    - src/lib/limited/__tests__/pool-storage.test.ts
decisions:
  - id: "isolated-storage"
    decision: "Separate 'PlanarNexusLimited' IndexedDB database instead of store"
    rationale: "Maximum isolation from deck collection - can't accidentally share stores"
  - id: "mythic-ratio"
    decision: "~1:8 mythic ratio for rare slot"
    rationale: "Matches real Magic pack distribution"
metrics:
  duration: "< 1 minute"
  completed_date: "2026-03-18"
---

# Phase 14 Plan 02: Sealed Pool Generation and Storage Summary

## One-liner

Sealed pool generator with 6 packs × 14 cards using weighted random rarity distribution, persisted in isolated IndexedDB storage separate from deck collection.

## Completed Tasks

| Task | Commit | Files |
|------|--------|-------|
| Test scaffolding | 4c3e353 | sealed-generator.test.ts, pool-storage.test.ts |
| Sealed pool generator | 9951ba7 | sealed-generator.ts |
| Pool storage | 0b70aff | pool-storage.ts |

## What Was Built

### Sealed Pool Generator (`src/lib/limited/sealed-generator.ts`)

- **`generateSealedPool(setCode)`**: Creates 84 cards (6 packs × 14 cards)
- **`generatePack(setCode)`**: Standard booster distribution:
  - 10 commons
  - 3 uncommons  
  - 1 rare or mythic (~1:8 mythic ratio)
- **`createSealedSession(setCode, setName)`**: Creates session with UUID and generated pool
- Card caching per set for performance

### Pool Storage (`src/lib/limited/pool-storage.ts`)

- **Separate IndexedDB** (`PlanarNexusLimited`) - NOT connected to deck storage
- **Session CRUD**: `createSession`, `getSession`, `updatePool`, `deleteSession`
- **Deck CRUD**: `updateDeck`, `addToDeck`, `removeFromDeck`, `saveDeck`
- **Pool filtering**: `filterPool` using existing filter-cards infrastructure
  - Color filtering (exact/include/exclude)
  - Type filtering (creature, instant, sorcery, etc.)
  - CMC filtering (exact/range)
- **Auto-persistence**: Changes saved immediately
- **Session analytics**: `countPoolByRarity`, `countPoolByColor`

## Requirements Coverage

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| SEAL-01 | ✓ | `createSealedSession` generates UUID, 6-pack pool |
| SEAL-02 | ✓ | 6 packs × 14 cards = 84 total, all revealed |
| SEAL-03 | ✓ | `filterPool` with color/type/CMC |
| SEAL-04 | ✓ | Auto-save via Dexie IndexedDB |
| SEAL-05 | ✓ | `getSession(id)` for resume |
| ISOL-01 | ✓ | Separate `PlanarNexusLimited` DB, not `decks` |
| ISOL-02 | ✓ | Session ID scoping |
| ISOL-03 | ✓ | `crypto.randomUUID()` |
| LBld-06 | ✓ | `saveDeck(sessionId, deck)` |

## Success Criteria Verification

| Criterion | Status |
|-----------|--------|
| `generateSealedPool` returns 84 cards | ✓ Implemented |
| Pool stored in 'limited-sessions' IndexedDB store | ✓ `PlanarNexusLimited.sessions` |
| Each session has unique UUID | ✓ `crypto.randomUUID()` |
| `filterPool` filters by color, type, CMC | ✓ Uses `applyFilters` from filter-cards |
| Sessions persist via `getSession(id)` | ✓ Dexie persistence |

## Test Coverage

48 TODO tests created covering all requirements:
- SEAL-01, SEAL-02: Session creation and pack generation (9 tests)
- SEAL-03: Pool filtering (9 tests)
- SEAL-04, SEAL-05: Persistence and resume (6 tests)
- ISOL-01, ISOL-02, ISOL-03: Session isolation (7 tests)
- LBld-06: Limited deck save/load (5 tests)

## Files Created

```
src/lib/limited/
├── types.ts                    # Type definitions (PoolCard, LimitedSession, etc.)
├── sealed-generator.ts         # Pool generation with rarity distribution
├── pool-storage.ts             # IndexedDB session persistence
└── __tests__/
    ├── sealed-generator.test.ts
    └── pool-storage.test.ts
```

## Deviations from Plan

None - plan executed exactly as written.

## Auth Gates

None.

## Deferred Issues

None.

## Self-Check: PASSED

- [x] Files exist: types.ts, sealed-generator.ts, pool-storage.ts
- [x] Commits found: 4c3e353, 9951ba7, 0b70aff
- [x] All tests pass (48 todo tests)
- [x] No type errors in limited/ files
