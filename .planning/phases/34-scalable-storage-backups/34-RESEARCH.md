# Phase 34: Scalable Storage & Backups — Research

**Researched:** 2026-04-07
**Domain:** IndexedDB, browser compression APIs, incremental backup patterns
**Confidence:** HIGH

---

## Summary

Phase 34 extends the existing `IndexedDBStorage` class in `src/lib/indexeddb-storage.ts` with three capabilities: incremental backup/restore (STOR-01), client-side gzip compression (STOR-02), and an IndexedDB schema/query audit (STOR-03).

The codebase already has a working full-backup implementation (`exportBackup` / `importBackup`) with SHA-256 checksum verification via the Web Crypto API. The incremental layer adds timestamp-based delta tracking on top of this foundation. Compression uses the native `CompressionStream` / `DecompressionStream` browser APIs — no new dependencies required.

There are two separate IndexedDB databases in the project: `PlanarNexusCardDB` (card-database.ts, raw IDB) and `PlanarNexusStorage` (indexeddb-storage.ts, raw IDB). Dexie is used only in `local-intelligence-db.ts` and `pool-storage.ts`. All Phase 34 work targets `PlanarNexusStorage` and `PlanarNexusCardDB`.

**Primary recommendation:** Use native `CompressionStream` (gzip) for zero-dependency compression; implement incremental backup via ISO timestamp filtering on `updatedAt` fields; add compound indexes to `PlanarNexusStorage` for CMC/color/rarity range queries.

---

<phase_requirements>

## Phase Requirements

| ID      | Description                                          | Research Support                                                  |
| ------- | ---------------------------------------------------- | ----------------------------------------------------------------- |
| STOR-01 | Incremental backup/restore logic implemented         | Timestamp-based delta export; merge-on-import strategy            |
| STOR-02 | Client-side compression for large data exports       | Native CompressionStream API (gzip); no new deps                  |
| STOR-03 | IndexedDB queries and schema audited for performance | Compound indexes for CMC/color/rarity; cursor-based range queries |

</phase_requirements>

---

## Standard Stack

### Core

| Library                    | Version          | Purpose                         | Why Standard                                      |
| -------------------------- | ---------------- | ------------------------------- | ------------------------------------------------- |
| CompressionStream (native) | Browser built-in | Gzip compression/decompression  | Zero deps, Chrome 80+, Firefox 113+, Safari 16.4+ |
| Web Crypto API (native)    | Browser built-in | SHA-256 checksum (already used) | Already in codebase                               |
| IDBKeyRange (native)       | Browser built-in | Range queries on indexes        | Standard IndexedDB API                            |

### Supporting

| Library        | Version                    | Purpose             | When to Use         |
| -------------- | -------------------------- | ------------------- | ------------------- |
| fake-indexeddb | ^6.2.5 (already installed) | IDB mocking in Jest | All IndexedDB tests |

### Alternatives Considered

| Instead of          | Could Use        | Tradeoff                                                            |
| ------------------- | ---------------- | ------------------------------------------------------------------- |
| CompressionStream   | fflate           | fflate supports Zstandard but adds ~50KB; native gzip is sufficient |
| CompressionStream   | zstd-codec       | Better compression ratio but WASM bundle, complex setup             |
| Timestamp filtering | Hash-based delta | Simpler to implement; timestamps already exist on all records       |

**Installation:** No new packages needed.

---

## Architecture Patterns

### Recommended Project Structure

```
src/lib/
├── indexeddb-storage.ts          # Extend with incremental + compression methods
├── indexeddb-compression.ts      # NEW: compressData / decompressData utilities
├── __tests__/
│   ├── indexeddb-storage.test.ts # Extend existing tests
│   ├── indexeddb-compression.test.ts  # NEW: compression tests
│   └── indexeddb-incremental.test.ts  # NEW: incremental backup tests
```

### Pattern 1: Incremental Backup via Timestamp Filtering

**What:** Export only records modified after `since` timestamp. Store `lastBackupAt` in the preferences store.

**When to use:** User has already done a full backup; only wants to export changes.

**Example:**

```typescript
// Source: IndexedDB IDBKeyRange docs
async exportIncrementalBackup(since: Date): Promise<IncrementalBackupData> {
  const sinceISO = since.toISOString();
  const transaction = this.db!.transaction(['decks', 'saved-games'], 'readonly');

  // Use index range query — only records updated after `since`
  const range = IDBKeyRange.lowerBound(sinceISO, true); // exclusive lower bound
  const decksIndex = transaction.objectStore('decks').index('updatedAt');
  const changedDecks = await this.getAllFromIndex(decksIndex, range);

  return {
    type: 'incremental',
    since: sinceISO,
    exportedAt: new Date().toISOString(),
    decks: changedDecks,
    savedGames: changedGames,
    checksum: await this.calculateChecksum({ decks: changedDecks, savedGames: changedGames }),
  };
}
```

### Pattern 2: Merge-on-Import (Incremental Restore)

**What:** Instead of clearing and replacing all data, upsert only the records in the incremental backup.

**When to use:** Restoring from an incremental backup (not a full backup).

**Example:**

```typescript
async importIncrementalBackup(data: IncrementalBackupData): Promise<void> {
  // Verify checksum
  // For each store: use put() (upsert) instead of clear() + setAll()
  for (const deck of data.decks) {
    await this.set('decks', deck); // put() semantics = upsert
  }
}
```

### Pattern 3: CompressionStream Gzip

**What:** Pipe JSON string through CompressionStream to produce a compressed Blob.

**When to use:** Any export operation producing >100KB of JSON.

**Example:**

```typescript
// Source: MDN CompressionStream docs
async function compressData(data: string): Promise<Blob> {
  const stream = new CompressionStream("gzip");
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();
  writer.write(encoder.encode(data));
  writer.close();
  return new Response(stream.readable).blob();
}

async function decompressData(blob: Blob): Promise<string> {
  const stream = new DecompressionStream("gzip");
  const writer = stream.writable.getWriter();
  writer.write(await blob.arrayBuffer());
  writer.close();
  const result = await new Response(stream.readable).arrayBuffer();
  return new TextDecoder().decode(result);
}
```

### Pattern 4: Compound Index for Range Queries

**What:** Add compound indexes to `PlanarNexusStorage` for CMC/color/rarity filtering without loading all records.

**When to use:** Filtering decks by card properties, querying game history by date range.

**Example:**

```typescript
// In onupgradeneeded (version bump required)
if (storeName === "game-history") {
  // Existing: date, result, mode
  // Add compound for date+result queries
  store.createIndex("date_result", ["date", "result"], { unique: false });
}
```

### Anti-Patterns to Avoid

- **getAll() then filter in JS:** For large stores, use index range queries instead
- **Synchronous compression:** CompressionStream is async; never block the main thread
- **Forgetting DB version bump:** Adding indexes requires incrementing `version` in `DEFAULT_STORAGE_CONFIG`

---

## Don't Hand-Roll

| Problem           | Don't Build       | Use Instead               | Why                           |
| ----------------- | ----------------- | ------------------------- | ----------------------------- |
| Gzip compression  | Custom deflate    | CompressionStream         | Browser-native, battle-tested |
| SHA-256 checksum  | Custom hash       | Web Crypto (already used) | Already in codebase           |
| IDB range queries | Load all + filter | IDBKeyRange + index       | O(log n) vs O(n)              |
| Merge upsert      | Custom diff       | IDB `put()` semantics     | put() is already upsert       |

---

## Common Pitfalls

### Pitfall 1: CompressionStream Not Available in Jest/Node.js

**What goes wrong:** `CompressionStream is not defined` in test environment.
**Why it happens:** CompressionStream is a browser API; Jest runs in Node.js (jsdom).
**How to avoid:** Mock `CompressionStream` in Jest setup, or use a conditional polyfill. The `fake-indexeddb` package is already installed for IDB mocking.
**Warning signs:** Tests fail with "CompressionStream is not defined".

### Pitfall 2: IDB Transaction Scope Across Async Boundaries

**What goes wrong:** Transaction closes before async operations complete.
**Why it happens:** IDB transactions auto-commit when no pending requests remain. Awaiting a Promise between requests can close the transaction.
**How to avoid:** Open all requests within a single transaction synchronously; collect results in `onsuccess` callbacks.
**Warning signs:** "Transaction has finished" DOMException.

### Pitfall 3: DB Version Bump Without Migration

**What goes wrong:** Existing users get a schema mismatch error.
**Why it happens:** `onupgradeneeded` only fires when version increases; existing stores must be preserved.
**How to avoid:** In `onupgradeneeded`, check `event.oldVersion` and only add new indexes/stores; never recreate existing stores.
**Warning signs:** "The database connection is closing" errors on upgrade.

### Pitfall 4: Incremental Backup Missing Deleted Records

**What goes wrong:** Records deleted between backups are not captured in the incremental export.
**Why it happens:** Deleted records have no `updatedAt` to filter on.
**How to avoid:** Add a `deletedRecords` array to `IncrementalBackupData` tracking IDs of deleted items. On import, call `delete()` for each.

---

## Code Examples

### Compression Utility (browser-only)

```typescript
// Source: MDN CompressionStream API
export async function compressToGzip(data: string): Promise<Blob> {
  const stream = new CompressionStream("gzip");
  const writer = stream.writable.getWriter();
  writer.write(new TextEncoder().encode(data));
  writer.close();
  return new Response(stream.readable).blob();
}

export async function decompressFromGzip(compressed: Blob): Promise<string> {
  const stream = new DecompressionStream("gzip");
  const writer = stream.writable.getWriter();
  writer.write(await compressed.arrayBuffer());
  writer.close();
  const buf = await new Response(stream.readable).arrayBuffer();
  return new TextDecoder().decode(buf);
}
```

### Incremental Export Types

```typescript
export interface IncrementalBackupData {
  type: "incremental";
  version: string;
  since: string; // ISO timestamp — records modified after this
  exportedAt: string;
  decks: StoredDeck[];
  savedGames: StoredGame[];
  deletedRecords: { store: string; id: string }[];
  checksum: string;
}

export interface BackupManifest {
  lastFullBackupAt: string | null;
  lastIncrementalBackupAt: string | null;
  backupHistory: Array<{ type: "full" | "incremental"; exportedAt: string }>;
}
```

### IDB Range Query via Index

```typescript
// Get all decks updated after a given ISO timestamp
async getDecksUpdatedAfter(since: string): Promise<StoredDeck[]> {
  return this.queryByIndex<StoredDeck>(
    'decks',
    'updatedAt',
    IDBKeyRange.lowerBound(since, true) // exclusive: strictly after `since`
  );
}
```

---

## State of the Art

| Old Approach     | Current Approach         | When Changed | Impact                |
| ---------------- | ------------------------ | ------------ | --------------------- |
| localStorage     | IndexedDB                | Phase 16     | Handles 50MB+         |
| Full JSON export | Full JSON + checksum     | Phase 16     | Integrity verified    |
| No compression   | CompressionStream (gzip) | Phase 34     | 60-80% size reduction |
| Full restore     | Incremental merge        | Phase 34     | Fast delta sync       |

---

## Validation Architecture

### Test Framework

| Property           | Value                                  |
| ------------------ | -------------------------------------- |
| Framework          | Jest 29 + jest-environment-jsdom       |
| Config file        | jest.config.ts                         |
| Quick run command  | `npx jest --testPathPattern=indexeddb` |
| Full suite command | `npm test`                             |

### Phase Requirements → Test Map

| Req ID  | Behavior                                             | Test Type | Automated Command                                  | File Exists? |
| ------- | ---------------------------------------------------- | --------- | -------------------------------------------------- | ------------ |
| STOR-01 | Incremental export only returns changed records      | unit      | `npx jest --testPathPattern=indexeddb-incremental` | ❌ Wave 0    |
| STOR-01 | Incremental import merges (upserts) without clearing | unit      | `npx jest --testPathPattern=indexeddb-incremental` | ❌ Wave 0    |
| STOR-01 | Deleted records tracked and applied on import        | unit      | `npx jest --testPathPattern=indexeddb-incremental` | ❌ Wave 0    |
| STOR-02 | compressToGzip produces smaller output than input    | unit      | `npx jest --testPathPattern=indexeddb-compression` | ❌ Wave 0    |
| STOR-02 | decompressFromGzip round-trips losslessly            | unit      | `npx jest --testPathPattern=indexeddb-compression` | ❌ Wave 0    |
| STOR-03 | queryByIndex with IDBKeyRange returns correct subset | unit      | `npx jest --testPathPattern=indexeddb-storage`     | ✅ (extend)  |

### Sampling Rate

- **Per task commit:** `npx jest --testPathPattern=indexeddb`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/lib/__tests__/indexeddb-incremental.test.ts` — covers STOR-01
- [ ] `src/lib/__tests__/indexeddb-compression.test.ts` — covers STOR-02
- [ ] Jest mock for `CompressionStream` in `jest.setup.ts` or test file

---

## Open Questions

1. **CompressionStream in Jest**
   - What we know: Jest uses jsdom which doesn't implement CompressionStream
   - What's unclear: Whether the existing jest.setup.ts already polyfills it
   - Recommendation: Add a minimal mock in the compression test file; skip compression tests in CI if needed

2. **DB Version for Schema Changes**
   - What we know: `DEFAULT_STORAGE_CONFIG.version` is currently `2`
   - What's unclear: Whether any other code depends on the version number
   - Recommendation: Bump to version `3` in `indexeddb-storage.ts`; add `oldVersion` guard in `onupgradeneeded`

---

## Sources

### Primary (HIGH confidence)

- MDN CompressionStream API — browser support, usage patterns
- MDN IDBKeyRange — range query API
- Existing codebase: `src/lib/indexeddb-storage.ts` — current schema and backup implementation

### Secondary (MEDIUM confidence)

- MDN IndexedDB performance guide — index design recommendations

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — native APIs, no library choices needed
- Architecture: HIGH — extends existing patterns in codebase
- Pitfalls: HIGH — well-known IDB and CompressionStream gotchas

**Research date:** 2026-04-07
**Valid until:** 2026-07-07 (stable APIs)
