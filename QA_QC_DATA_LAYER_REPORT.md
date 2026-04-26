# QA/QC Report: Data Layer & Type Safety

**Scope:** `/home/alex/Projects/planar-nexus/src/`
**Date:** 2026-04-24
**Branch:** feature/single-player-ux-improvements
**Files Analyzed:** 200+ source files

---

## 1. DATABASE / STORAGE

### CRITICAL

| # | File | Line | Issue | Description | Recommended Fix |
|---|------|------|-------|-------------|-----------------|
| 1.1 | `lib/indexeddb-storage.ts` | 352-378 | **Partial write in `setAll`** | `setAll` does not abort the IndexedDB transaction when an individual `put` fails. It sets a local `error` flag and continues processing remaining puts. The Promise only rejects after all requests complete, meaning some records may be committed while others fail. | Call `transaction.abort()` inside the `onerror` handler to ensure atomicity, or switch to tracking errors and rolling back manually. |
| 1.2 | `lib/indexeddb-storage.ts` | 640-680 | **Non-atomic backup import** | `importBackup` clears each store (`clear()`) then repopulates it (`setAll`) in separate, non-atomic steps. If an error occurs mid-import (e.g., after clearing decks but before writing saved-games), data is permanently lost. | Wrap the entire import in a single multi-store transaction, or write to a temporary store and swap atomically. |
| 1.3 | `lib/indexeddb-storage.ts` | 803-906 | **Unvalidated migration data** | `migrateFromLocalStorage` parses localStorage JSON and writes directly to IndexedDB without schema validation. Corrupt localStorage data can poison the IndexedDB. | Add a validation/zod step before writing migrated data. Catch and log malformed entries individually instead of failing the entire batch. |

### HIGH

| # | File | Line | Issue | Description | Recommended Fix |
|---|------|------|-------|-------------|-----------------|
| 1.4 | `lib/card-database.ts` | 91-95 | **Module-level mutable singleton state** | `db`, `isInitialized`, `initPromise` are module-level mutable variables. `initPromise` is not reset on failure, meaning subsequent calls return the rejected promise forever without retry. | Reset `initPromise = null` in the catch block so initialization can be retried. Consider wrapping in a class for better lifecycle management. |
| 1.5 | `lib/deck-storage.ts` | 97-108 | **Race condition in initialization** | `DeckStorageManager` uses a simple `initialized` boolean flag without promise deduplication. Concurrent calls to `getAllDecks()`/`saveDeck()` can trigger multiple `indexedDBStorage.initialize()` calls. | Use an `initPromise` pattern (like `card-database.ts`) to deduplicate concurrent initialization attempts. |
| 1.6 | `lib/saved-games.ts` | 65-73 | **Same race condition** | `SavedGamesManager` has identical `initialized` boolean pattern without promise deduplication. | Same fix: use `initPromise` for atomic initialization. |
| 1.7 | `lib/local-game-storage.ts` | 16-18 | **Module-level mutable DB reference** | `db`, `isInitialized`, `initPromise` are module-level. `initPromise` not reset on failure. | Reset `initPromise` on error; encapsulate in class. |

### MEDIUM

| # | File | Line | Issue | Description | Recommended Fix |
|---|------|------|-------|-------------|-----------------|
| 1.8 | `lib/indexeddb-storage.ts` | 281-296 | **Missing transaction error handler** | Individual `get`/`set` operations only attach `request.onerror`, not `transaction.onerror` or `transaction.onabort`. If the transaction itself aborts (e.g., quota exceeded), the error may not propagate correctly. | Add `transaction.onerror` and `transaction.onabort` handlers that reject the Promise. |
| 1.9 | `lib/indexeddb-storage.ts` | 542-568 | **Incremental backup inconsistency** | `exportIncrementalBackup` queries decks and saved-games in separate transactions. A deck could be modified between the two reads, producing an inconsistent backup snapshot. | Perform both reads in a single readonly transaction. |
| 1.10 | `lib/card-database.ts` | 183-199 | **No batch size limit in `populateDatabase`** | Bulk card imports can exceed IndexedDB transaction duration limits or memory quotas, causing silent failures. | Chunk inserts into batches of 500-1000 cards with progress callbacks. |

---

## 2. TYPE SAFETY GAPS

### HIGH

| # | File | Line | Issue | Description | Recommended Fix |
|---|------|------|-------|-------------|-----------------|
| 2.1 | `lib/client-card-operations.ts` | 34, 50, 116 | **Unsafe `as` on potentially undefined** | `return results as ScryfallCard[]` and `return card as ScryfallCard \|\| null` — if `card` is `undefined`, the `as` cast happens before the `\|\|` check, masking runtime errors. | Validate the shape of results before casting, or use a type predicate/guard function. |
| 2.2 | `lib/deck-storage.ts` | 154, 168 | **Unsafe casts in deck deserialization** | `storedCard.card as unknown as DeckCard` and `(storedCard.card as any).legalities`. No runtime validation that the stored data matches expected schema. | Add a runtime schema validation function (e.g., Zod) for StoredDeck → Deck conversion. |
| 2.3 | `lib/ai-proxy-client.ts` | 213-227 | **Deep unchecked `as` chains on API responses** | Casts `data.choices[0] as Record<string, unknown>`, then `choice.message as Record<string, unknown>`. If the API changes shape, these crash at runtime with no meaningful error. | Validate response shape with a parser (Zod/io-ts) before accessing nested properties. |
| 2.4 | `hooks/use-p2p-connection.ts` | 217, 281 | **Empty object cast to satisfy type** | `return signalingState.localOffer \|\| ({} as RTCSessionDescriptionInit)`. Returns an empty object that satisfies the type but will fail at runtime when passed to WebRTC APIs. | Return `null` and handle it at all call sites; do not cast empty objects to satisfy TypeScript. |
| 2.5 | `lib/game-state/deterministic-sync.ts` | 750 | **Unsafe deserialization cast** | `const message = JSON.parse(data) as GameSyncMessage`. Malformed peer data can crash the sync engine. | Add a `isGameSyncMessage` type guard that validates required fields before casting. |
| 2.6 | `lib/p2p-direct-connection.ts` | 205, 223 | **JSON parse + cast without validation** | `return parsed as ConnectionData` and `return parsed as ICECandidateData` after `JSON.parse`. | Validate required fields (e.g., `typeof parsed.sessionId === 'string'`) before casting. |
| 2.7 | `lib/p2p-signaling-client.ts` | 419, 445 | **Same pattern** | `JSON.parse(data) as ConnectionInfo` / `as SignalingData` without validation. | Add runtime validation guards. |

### MEDIUM

| # | File | Line | Issue | Description | Recommended Fix |
|---|------|------|-------|-------------|-----------------|
| 2.8 | `lib/replay-sharing.ts` | 452 | **Cast from minified data** | `(minified.t?.cp \|\| Phase.UNTAP) as Phase` — if minified data is corrupt, invalid phase strings are cast. | Validate against known Phase enum values before casting. |
| 2.9 | `lib/db/local-intelligence-db.ts` | 12, 20, 27, 28 | **`any` in DB schema** | `data: any; decision: any; context: any;` — defeats type safety for persisted intelligence records. | Replace with specific discriminated union types. |
| 2.10 | `app/api/ai-proxy/route.ts` | 171 | **`as any[]` on messages** | `(providerBody.messages as any[])` — no validation that messages conform to Vercel AI SDK expected shape. | Validate message structure (role/content objects) before passing to `streamText`. |
| 2.11 | `app/api/deck-import/route.ts` | 37, 45, 113, 183, 187 | **`any` in external data parsing** | `([name, quantity]: [string, any])`, `cardData: any`, `entry as any`. External HTML/JSON is parsed into `any` types with no validation. | Define strict interfaces for external deck formats and validate extracted data. |
| 2.12 | `lib/webrtc-p2p.ts` | 550-574 | **Message type casting without validation** | `message as GameStateSyncMessage`, `as PlayerActionMessage`, etc. Rely on a `type` string field for dispatch but do not validate payload shape. | Add payload validators per message type before casting. |

---

## 3. INPUT VALIDATION

### HIGH

| # | File | Line | Issue | Description | Recommended Fix |
|---|------|------|-------|-------------|-----------------|
| 3.1 | `app/api/chat/route.ts` | 18-28 | **No provider or message validation** | Accepts `provider` as any string; `messages` only checked with `Array.isArray`. Malformed messages array can crash `streamText`. | Validate `provider` against allowed enum; validate each message has `{role, content}` strings. |
| 3.2 | `app/api/signaling/route.ts` | 172-205 | **Payload cast without validation** | `payload as { hostId: string; hostName: string; ... }` — no runtime check that fields exist or are correct types. | Validate payload shape with a type guard before casting. |
| 3.3 | `lib/custom-card-storage.ts` | 92 | **Unvalidated JSON import** | `const imported = JSON.parse(json) as CustomCardDefinition[]` — importing malicious or malformed JSON can crash the app or cause data corruption. | Add Zod/schema validation for imported custom cards; sanitize card fields (name, oracle text). |
| 3.4 | `lib/saved-games.ts` | 393 | **Unvalidated game import** | `const game = JSON.parse(text) as SavedGame` — no validation of imported game structure. | Validate against SavedGame schema before use. |
| 3.5 | `lib/deck-storage.ts` | 413 | **Unvalidated deck import** | `const deck = JSON.parse(text) as Deck` — same issue for deck imports. | Validate against Deck schema; check card counts are positive integers. |
| 3.6 | `lib/card-database.ts` | 648 | **Unvalidated card DB import** | `const cards = JSON.parse(text) as MinimalCard[]` — importing a malformed card DB corrupts offline search. | Validate each card has required fields (`id`, `name`, `cmc`, `type_line`) before storing. |

### MEDIUM

| # | File | Line | Issue | Description | Recommended Fix |
|---|------|------|-------|-------------|-----------------|
| 3.7 | `app/api/deck-import/route.ts` | 297 | **SSRF via CORS proxy** | `fetch(proxyUrl, ...)` where `proxyUrl` includes user-provided `url`. While allorigins is used, there is no URL allowlist. | Restrict imported URLs to supported domains; validate the parsed hostname strictly. |
| 3.8 | `lib/api-key-storage.ts` | 136-164 | **No integrity check on encrypted keys** | `JSON.parse(stored)` for encrypted API keys without verifying structure before decrypting. | Validate `EncryptedKeyData` shape before passing to decryption. |
| 3.9 | `lib/game-history.ts` | 95, 122, 130 | **Unvalidated game history parse** | Multiple `JSON.parse(stored) as GameRecord[]` without validation. | Validate array items against GameRecord schema. |
| 3.10 | `lib/local-user.ts` | 42-44 | **Unvalidated user parse** | `const user = JSON.parse(stored) as LocalUser` — no validation. | Validate user object has required fields. |

---

## 4. CONCURRENCY & SHARED STATE

### HIGH

| # | File | Line | Issue | Description | Recommended Fix |
|---|------|------|-------|-------------|-----------------|
| 4.1 | `lib/game-state/state-based-actions.ts` | 273, 414, 425 | **Mutating nested Maps in shallow-copied state** | `updatedState.cards.set(card.id, updatedCard)` and `updatedState.players.set(...)` mutate the inner `Map` objects that were only shallow-copied via `...state`. This causes hidden mutations to prior state references. | Always create new Maps: `cards: new Map(updatedState.cards).set(card.id, updatedCard)`. |
| 4.2 | `lib/game-state/replacement-effects.ts` | 125-201 | **Global singleton mutable state** | `replacementEffectManager` is a global singleton holding mutable `Map`s (`preventionShields`, `effects`, `asThoughEffects`). Multiple game instances or concurrent tests can corrupt each other's state. | Remove global singleton; instantiate per-game `ReplacementEffectManager` and pass it through game state. |
| 4.3 | `lib/game-state/game-state.ts` | 97 | **Global singleton reset** | `replacementEffectManager.reset()` called in `createInitialGameState` — side effect on global state is unpredictable if multiple games exist. | Same as above: per-game instance. |
| 4.4 | `lib/deterministic-sync.ts` | 203, 262 | **Unbounded history growth + race** | `this.actionHistory.push(deterministicAction)` — while `maxActionHistory` is checked, there is no lock around the check-then-push, allowing race conditions in concurrent environments (Workers). | Use atomic operations or a single event loop for state mutations; trim arrays before pushing. |
| 4.5 | `lib/lobby-manager.ts` | 367 | **Non-atomic localStorage write** | `localStorage.setItem('planar_nexus_current_lobby', JSON.stringify(this.currentLobby))` — read-modify-write without compare-and-swap. Multiple tabs can overwrite each other. | Use `StorageEvent` listeners for cross-tab synchronization, or include a timestamp/version for conflict detection. |

### MEDIUM

| # | File | Line | Issue | Description | Recommended Fix |
|---|------|------|-------|-------------|-----------------|
| 4.6 | `lib/deck-storage.ts` | 241-248 | **Non-atomic localStorage fallback** | Read-modify-write on localStorage decks array without locking. | Same as 4.5; use versioning or avoid localStorage for concurrent writes. |
| 4.7 | `lib/trading.ts` | 409-460 | **Non-atomic localStorage trading state** | Trading history and offers stored in localStorage with read-modify-write pattern. | Add optimistic locking with version numbers. |
| 4.8 | `lib/indexeddb-storage.ts` | 213 | **Single shared DB connection** | `db: IDBDatabase | null` is a single connection. If it closes unexpectedly (e.g., browser decides to terminate), all subsequent operations fail until manual re-init. | Add connection health check in `ensureInitialized`; auto-reconnect on `InvalidStateError`. |
| 4.9 | `lib/search/orama-manager.ts` | 143, 288 | **`any` search options mutating shared state** | `const searchOptions: any = { ... }` — `any` defeats type safety and could mutate shared config objects. | Replace `any` with strict `SearchParams` type; use immutable defaults. |

---

## 5. SUMMARY BY SEVERITY

| Severity | Count | Categories |
|----------|-------|------------|
| CRITICAL | 3 | Database atomicity failures, migration corruption risk |
| HIGH | 16 | Type safety bypasses, unvalidated inputs, shared state mutation, race conditions |
| MEDIUM | 11 | Missing transaction handlers, non-atomic localStorage, unbounded growth, connection resilience |

## 6. TOP PRIORITY FIXES

1. **Fix `setAll` transaction abort** (`indexeddb-storage.ts:352`) — prevents partial writes.
2. **Make `importBackup` atomic** (`indexeddb-storage.ts:640`) — prevents data loss on failed restore.
3. **Add runtime validation to all `JSON.parse` imports** (`deck-storage.ts`, `saved-games.ts`, `custom-card-storage.ts`, `card-database.ts`) — prevents corrupt data from crashing the app.
4. **Fix shallow-copy Map mutations** (`state-based-actions.ts:273`) — prevents hidden state corruption.
5. **Remove global `replacementEffectManager` singleton** (`replacement-effects.ts`) — prevents cross-game state leakage.
6. **Add `initPromise` deduplication** (`deck-storage.ts`, `saved-games.ts`) — prevents race conditions in storage initialization.
7. **Validate API route inputs** (`chat/route.ts`, `signaling/route.ts`, `ai-proxy/route.ts`) — prevents server crashes from malformed requests.

