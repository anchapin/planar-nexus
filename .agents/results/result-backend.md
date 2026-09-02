# Result: issue #1593 — Consolidate card interfaces into one canonical source

## Status

✅ COMPLETE — committed & pushed

## Summary

Consolidated the triple-defined `ScryfallCard` / `DeckCard` / `MinimalCard`
interfaces into a single canonical module, per issue #1593. Pure type-level
refactor; zero runtime behavior change.

## Canonical module

`src/lib/card-database.ts` (issue's primary preference; the MinimalCard
superset already lived there):

- `MinimalCard` (unchanged, line 20 — the superset "offline card" shape)
- `ScryfallCard extends MinimalCard` (new — adds `faces?: number`;
  `power`/`toughness`/`keywords` were already optional members of MinimalCard,
  so the old re-declarations were redundant no-ops)
- `DeckCard extends ScryfallCard` (new — adds `count: number`)

## Files changed (6)

1. `src/lib/card-database.ts` — added canonical `ScryfallCard` + `DeckCard`
2. `src/app/actions.ts` — removed 2 local interfaces; now `import type` +
   `export type { ScryfallCard, DeckCard } from "@/lib/card-database"`
   (re-export keeps ~130 consumer import sites stable)
3. `src/ai/flows/context-builder.ts` — removed 3 local interfaces
   (MinimalCard/ScryfallCard were dead exports; only DeckCard was used);
   now imports DeckCard from the canonical module
4. `src/hooks/use-deck-coach-chat.ts` — repointed DeckCard import
   `context-builder` → `@/lib/card-database`
5. `src/lib/coach-conversation-storage.ts` — repointed DeckCard import
   `context-builder` → `@/lib/card-database`
6. `src/lib/indexeddb-storage.ts` — RENAMED its structurally-different
   `DeckCard` (`{card, count}` wrapper, IndexedDB serialization format) to
   `StoredDeckCard`, preserving its exact shape. NOTE: the issue suggested
   replacing it with the canonical flat `DeckCard`, but that would have
   changed the persisted `StoredDeck` contract (real DB rows are
   `{card, count}`; see `deck-storage.ts` `toStoredDeck`/`fromStoredDeck`).
   Renaming eliminates the misleading name collision with zero contract
   change, matching the private mirror type already in deck-storage.ts.

## Acceptance criteria (from issue)

- [x] `rg -n 'export (interface|type) (ScryfallCard|DeckCard|MinimalCard)' src/`
      → exactly 3 declarations, all in `src/lib/card-database.ts`
- [x] `context-builder.ts` imports from the canonical module (local
      declarations removed)
- [x] `indexeddb-storage.ts` no longer declares a `DeckCard` (renamed to
      `StoredDeckCard` to preserve the serialization contract — deviation
      documented above)
- [x] `npm run typecheck` passes with zero errors

## Verification

- `npm run typecheck` — clean
- `npm run lint` — 0 errors (615 pre-existing warnings, untouched files)
- `npx jest` (full suite) — 447/448 suites, 9267 passed / 1 failed / 11
  skipped / 48 todo. The single failure is
  `coach-conversation-storage.test.ts` ("auto-resumes the most recent
  conversation") — verified PRE-EXISTING on the clean tree via stash/test/pop
  (tolerated failure tracked as #1634).

## Import sites

~180 files import these types; all continue to work via the `@/app/actions`
re-export and the unchanged `@/lib/card-database` MinimalCard path. Only 3
import sites needed editing (context-builder + its 2 DeckCard consumers).

## Out of scope / notes

- `SavedDeck` remains in `src/app/actions.ts` (not part of the issue's trio).
- `deck-storage.ts`'s private `StoredDeckCard` left as-is (already aligned in
  name and concept; consolidating it was not requested).
- `src/lib/game-state/types.ts` and `src/lib/limited/types.ts` re-export
  chains unaffected (they point at `@/app/actions` / `@/lib/card-database`).
