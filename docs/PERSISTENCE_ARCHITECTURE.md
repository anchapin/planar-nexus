# Persistence Architecture Decision Record

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-08 |
| **Issue** | [#1722](https://github.com/anchapin/planar-nexus/issues/1722) — Unify IndexedDB persistence: raw wrapper vs Dexie split needs one documented architecture |
| **Related** | #1709 (open-lifecycle primitives), #1726 (card-DB init retry), #1572 (saved-games v3 split), #1085 (quota awareness), #1074 (coach conversations), #1570 (match records), #1592 (ai-client/actions rename) |
| **Scope** | Architecture and documentation only. **No data-format migrations and no code rewrites were performed for this issue** (scope guard in #1722). The only code changes are doc-header ownership annotations. |

---

## TL;DR

Planar Nexus keeps a **tiered multi-database architecture with two sanctioned
access stacks**, and consolidates its accidental long tail on a staged roadmap.

1. **`PlanarNexusStorage` (raw `IndexedDBStorage` wrapper) stays the single
   Tier-1 user-data database of record.** It is *not* rewritten to Dexie —
   the wrapper already exceeds every Dexie module's operational hygiene
   (incremental migrations, multi-tab safety, backup, quota guard).
2. **Dexie remains sanctioned, but only for Tier-2/Tier-3 dedicated
   databases** that already carry a written justification
   (`LocalIntelligenceDB`, `PlanarNexusLimited`).
3. **The split is blessed only where justified.** Four single-store
   databases with no isolation rationale (the three search DBs and
   `PlanarNexusGameDB`) are *not* blessed; they move into
   `PlanarNexusStorage` via the staged roadmap in §6 — in follow-up issues,
   not in this one.
4. **One convention governs all databases** (§5): naming, version-bump
   procedure, mandatory #1709 open-lifecycle handling, and single owners for
   quota (`src/lib/storage-quota.ts`) and backup
   (`src/lib/indexeddb-storage.ts` → `src/lib/backup-compression.ts` →
   `src/hooks/use-storage-backup.ts`).

---

## 1. Database inventory (verified against code)

Every IndexedDB database opened by the app. Reproduce with:
`rg -n "indexedDB\.open|new Dexie|super\(\"|super\('" src/` — each row below
names its owner module where the constant lives.

| # | Database | Ver | Owner module | Stack | Object stores | #1709 open-lifecycle | In backup? |
|---|----------|-----|--------------|-------|---------------|----------------------|------------|
| 1 | `PlanarNexusStorage` | 3 | `src/lib/indexeddb-storage.ts` (`DEFAULT_STORAGE_CONFIG`, singleton `indexedDBStorage`) | raw wrapper class | `decks`, `saved-games` (legacy, retained for downgrade safety), `saved-games-meta`, `saved-games-payloads`, `preferences`, `usage-tracking`, `achievements`, `game-history` | ✅ `onblocked` → `IndexedDBBlockedError`; `onversionchange` → close + broadcast | ✅ source of `exportBackup` / `exportIncrementalBackup` |
| 2 | `PlanarNexusCardDB` | 2 | `src/lib/card-database.ts` | raw standalone open | `cards` (indexes `name`, `name_lower`, compound `format_legality`), `card_images` (v2) | ✅ + #1726 init retry | ❌ — re-importable from Scryfall by design |
| 3 | `PlanarNexusCoach` | 1 | `src/lib/coach-conversation-storage.ts` (own `IndexedDBStorage` instance) | raw wrapper class (reused) | `coach-conversations` | ✅ (inherited from wrapper class) | ❌ — documented gap, see §7 |
| 4 | `PlanarNexusGameDB` | 1 | `src/lib/local-game-storage.ts` | raw standalone open | `games` (keyPath `gameId`; indexes `gameCode` unique, `status`, `updatedAt`), `gameCodes` | ❌ none | ❌ — sessions semi-ephemeral |
| 5 | `PlanarNexusReconnectTokens` | 1 | `src/lib/p2p-reconnect-store.ts` (`ReconnectTokenStore`) — **plus a second read-only open** in `src/hooks/use-reconnect-tokens.ts` (`openReconnectDb`) | raw standalone open | `tokens` (keyPath `id`, TTL-bounded rows) | ⚠️ warn-only `onblocked` in the store; none in the hook's open | ❌ — ephemeral by design |
| 6 | `PlanarNexusSearchDB` | 1 | `src/lib/search/search-preferences.ts` | raw standalone open | `preferences` | ❌ none | ❌ |
| 7 | `PlanarNexusPresetsDB` | 1 | `src/lib/search/search-presets.ts` | raw standalone open | `search-presets` | ❌ none | ❌ — user-created content; consolidation candidate (§6) |
| 8 | `PlanarNexusRecentSearchesDB` | 1 | `src/lib/search/recent-searches.ts` | raw standalone open | `recent-searches` | ❌ none | ❌ — trivial |
| 9 | `LocalIntelligenceDB` | 3 | `src/lib/db/local-intelligence-db.ts` (Dexie singleton; consumed by `src/hooks/use-p2p-connection.ts` for `match_records`) | **Dexie** | `embeddings`, `orama_snapshots`, `game_history`, `player_decisions`, `game_embeddings` (v2), `match_records` (v3) | ⚠️ Dexie defaults | ❌ — derived/recomputable analytics |
| 10 | `PlanarNexusLimited` | 1 | `src/lib/limited/pool-storage.ts` | **Dexie** | `sessions` | ⚠️ Dexie defaults | ❌ — documented gap, see §7 |

**Facades, not databases** (verified — they hold no `indexedDB.open` of their own):

- `src/lib/deck-storage.ts` — deck CRUD manager **over the shared
  `indexedDBStorage` singleton** (store `decks`), plus legacy
  `localStorage` migration from key `planar_nexus_decks`.
- `src/hooks/use-storage-backup.ts` — backup UI orchestration over
  `indexedDBStorage.exportBackup` / `exportIncrementalBackup`.
- `src/hooks/use-reconnect-tokens.ts` — hook layer over
  `ReconnectTokenStore`; its internal `openReconnectDb` re-opens DB #5
  read-only (documented in-code as intentional handle reuse, but it
  duplicates schema knowledge and lacks blocked handling — §7).

**Beyond IndexedDB (context, not governed DBs):** `localStorage` remains in
use for small synchronous state (`use-local-storage` hook, `sideboard-plans`
(#1565), legacy `usage-tracking`, `trading`, and the `use-social` /
`use-p2p-connection` match-history duality noted in §6 stage 3). The quota
convention (§5.5) applies to these too — `sideboard-plans.ts` already routes
through `withQuotaGuard`.

**Dependency status:** `dexie@^4.4.5` — used, by exactly the two modules
above. `dexie-react-hooks@^4.4.0` — **declared but never imported anywhere in
`src/`** (`rg -rn "useLiveQuery|dexie-react-hooks" src/` → no matches).
Removal is a recommended follow-up chore (§7), deliberately not done in this
docs-only issue.

---

## 2. Decision D1 — Tier model: which data lives in which database

New features MUST place data according to this tier model:

| Tier | Database(s) | Content | Rule |
|------|-------------|---------|------|
| **1 — User data of record** | `PlanarNexusStorage` | Anything whose loss the user would feel: decks, saved games, preferences, usage, achievements, history. | **Default destination.** Add a store + bump the version (§5.3). Backed up (§5.6). |
| **2 — Justified dedicated databases** | `PlanarNexusCardDB`, `PlanarNexusReconnectTokens`, `PlanarNexusCoach`, `PlanarNexusLimited`, `PlanarNexusGameDB`† | Data with a written carve-out: bulk re-derivable content (card catalog + image cache), independent-wipe requirements (reconnect tokens: "sign out" flushes them without touching decks), isolation mandates (`PlanarNexusLimited` ISOL-01: pool sessions must never mix with the deck collection), or independent schema cadence (coach store avoids version-conflicting the main DB). | Requires one of the carve-out criteria, stated in the module's doc-header. †`PlanarNexusGameDB` is provisional — see §6 stage 3. |
| **3 — Derived / analytics** | `LocalIntelligenceDB` | Recomputable or low-stakes derived data (embeddings, snapshots, match analytics). | Same carve-out discipline; never the only copy of user data of record. |
| **— Consolidation queue** | `PlanarNexusSearchDB`, `PlanarNexusPresetsDB`, `PlanarNexusRecentSearchesDB` | Tiny UX preferences with **no** carve-out justification. | Not blessed. Scheduled into Tier 1 (§6 stage 2). |

**Quota note (correcting the issue premise):** `navigator.storage.estimate()`
reports per-*origin* usage across all databases, so split databases do **not**
fragment the actual quota. What was fragmented is quota *handling* — and
`src/lib/storage-quota.ts` already centralizes that (8 consumer modules).
The real costs of the split this record addresses are convention drift,
inconsistent multi-tab behavior, and decision friction for new features.

---

## 3. Decision D2 — Two sanctioned access stacks, chosen by tier (not by whim)

| Stack | Where sanctioned | Why it is the right tool there |
|-------|------------------|--------------------------------|
| **A. `IndexedDBStorage` wrapper class** (`src/lib/indexeddb-storage.ts`) | Tier 1 and any Tier-2 raw DB. New raw databases MUST instantiate this class (as `coach-conversation-storage.ts` does) rather than hand-rolling an open. | Inherits for free: versioned config, incremental `oldVersion` migrations, #1709 `onblocked`/`onversionchange` handling, quota classification on writes, and a documented bump recipe. |
| **B. Dexie** (`dexie@^4.x`) | Existing Tier-3 analytics (`LocalIntelligenceDB`) and the isolated limited-play store (`PlanarNexusLimited`). New Dexie databases require a Tier-2/3 carve-out. | Typed `EntityTable` schemas and append-only `version().stores()` replay are a good fit for green-field derived-data stores. Dexie's reactive hooks are **not** used anywhere (`dexie-react-hooks` has zero imports — §7). |

The two existing standalone raw opens that predate this rule
(`card-database.ts`, `local-game-storage.ts`, the search trio, the reconnect
pair) are grandfathered; the standalone opens without #1709 handling are
listed as gaps in §7 and must adopt the primitives before their first-ever
version bump (§5.4 rule 3).

---

## 4. Decision D3 — Rejected alternative: unify everything into one Dexie database

The issue names "a single Dexie DB with versioned stores" as the other
acceptable outcome. **Rejected**, on cost/risk, because the premise it rests
on (raw wrapper = debt to retire) is inverted in this codebase:

1. **The wrapper is the most hardened persistence code in the app.** v1→v2→v3
   incremental `oldVersion` branches with a per-hop test convention
   (`indexeddb-migration.test.ts`, `indexeddb-migration-v3-split.test.ts`), a
   re-run-safe lazy v2→v3 data migration gated on a marker store, #1709
   multi-tab `blocked`/`versionchange` handling, embedded backup/export
   machinery, and quota-guarded writes. Neither Dexie module has multi-tab
   hardening beyond library defaults.
2. **Migration cost is maximal exactly where risk must be minimal.** A Dexie
   rewrite of `PlanarNexusStorage` means a dual-read data migration for every
   user's decks/saved-games/achievements in an offline-first app — where the
   only safety net (backup, §5.6) covers precisely this database.
3. **Zero user-visible benefit.** The wrapper's public surface
   (`get/set/getAll/delete/clear/exportBackup`) already does what the app
   needs; rewrites would be aesthetic churn.
4. **The justifications for dedicated databases are load-bearing and written
   down in the code itself** (`p2p-reconnect-store.ts` header: independent
   wipe + decoupled migrations + test isolation; `pool-storage.ts` ISOL-01;
   `coach-conversation-storage.ts`: no version-conflict with main stores).
   A single DB deletes those properties.

Cost comparison of the two options considered:

| | Single Dexie DB (rejected) | Blessed tiered split + roadmap (chosen) |
|---|---|---|
| Implementation cost | Rewrite ~1,600-line hardened wrapper + 8 modules + 10 data migrations | ~0 now; staged low-risk consolidations later |
| Data-loss risk | High (single cut-over on user data of record) | Minimal (per-DB, read-old→write-new→clear-old) |
| Operational cost | One DB to reason about | Convention + inventory table (this doc) replaces the single DB's benefit |
| Future change cost | Dexie lock-in for Tier-1 | New features follow the tier model; stacks chosen by rule |

---

## 5. Shared conventions (binding for ALL databases)

### 5.1 Naming

- Raw databases: `PlanarNexus<Domain>` in PascalCase (`PlanarNexusStorage`,
  `PlanarNexusCardDB`, …).
- **Accepted deviation:** `LocalIntelligenceDB` predates the convention;
  renaming it costs a data migration for zero functional gain, so the
  deviation is documented here rather than fixed.
- Object stores: kebab-case plurals describing content (`saved-games-meta`,
  `coach-conversations`, `recent-searches`).

### 5.2 Adding data — decision tree

1. Is it user data of record? → **new store in `PlanarNexusStorage`** +
   version bump (§5.3). This is the default; deviation needs a §2 carve-out.
2. Bulk re-derivable content, independent-wipe, isolation mandate, or derived
   analytics? → dedicated DB, stack per §3, justification in the module
   doc-header, inventory table above updated in the same PR.
3. Small synchronous UI state? → `localStorage` via `use-local-storage` (with
   quota guard if writes can be large).

### 5.3 Version & migration — raw stack

The canonical procedure already lives in `indexeddb-storage.ts` (see the
`open()` doc comment, "how to add a migration"); it is binding for every raw
database:

1. Bump the version integer (`DEFAULT_STORAGE_CONFIG.version` or the module's
   `DB_VERSION`).
2. Add an incremental `else if (oldVersion < N)` branch — **never edit or
   delete historical branches** (a downgrade must remain best-effort
   no-data-loss; see the v3 decision to retain the legacy `saved-games`
   store).
3. Schema work only inside `onupgradeneeded`; **row-level data moves happen
   as lazy migrations in a normal `readwrite` transaction after open**, gated
   on a marker/meta store so they are safe to re-run after a mid-migration
   crash (the #1572 pattern).
4. Add a `v(N-1)→vN` test to the module's migration test file.
5. Update the inventory table in this doc.

### 5.4 Version & migration — Dexie stack

Binding rule (already documented in `local-intelligence-db.ts`):
`version(N).stores({...})` declarations are an **append-only replay chain**.
Never remove or reorder historical versions — Dexie replays them in order
when opening an older database, and deleting one is a silent data-loss bug.
Add the new version, leave prior versions intact, and update this doc's
inventory table.

### 5.5 Open lifecycle — #1709 rules for every `indexedDB.open`

`src/lib/indexeddb-open-events.ts` (merged #1709) defines the primitives:
`IndexedDBBlockedError`, `registerVersionChangeClose(db, onClose)`, and the
`planar-nexus:db-versionchange` broadcast. Its own header already points at
this issue for the unification story. The rules:

1. Every open MUST handle `onblocked` — reject with `IndexedDBBlockedError`
   (or the wrapper class's built-in behavior). An unhandled `blocked` event
   leaves the open pending forever and bricks storage init for the session.
2. Every open MUST register `onversionchange` via
   `registerVersionChangeClose` so other tabs' upgrades are never blocked.
3. **No database may ship its first version bump until rules 1–2 are in
   place** — this is the safety valve that makes the current gaps in §7
   tolerable (all non-compliant opens are v1 databases that have never
   bumped).

Current adoption (grep-verifiable):
`rg -ln "indexeddb-open-events|onblocked" src/ --glob '!__tests__'` →
compliant: `indexeddb-storage.ts` (class-level, inherited by
`PlanarNexusCoach`), `card-database.ts`; partial: `p2p-reconnect-store.ts`
(warn-only); non-compliant: `local-game-storage.ts`, the search trio, and
the `use-reconnect-tokens.ts` second open.

### 5.6 Single owners: quota and backup

**Quota — owned by `src/lib/storage-quota.ts`.** It is the only module
allowed to talk to `navigator.storage.*` or classify `QuotaExceededError`.
Estimation, persist requests, warn/critical thresholds, `withQuotaGuard`,
and `predictQuotaHeadroom` all live there; `src/hooks/use-storage-quota.ts`
is its only UI surface. Existing consumers (keep this list true when adding
code): `indexeddb-storage.ts`, `card-database.ts`,
`coach-conversation-storage.ts`, `sideboard-plans.ts` (localStorage — quota
conventions apply to localStorage too), `src/ai/weight-learning.ts`,
`use-deck-coach-chat.ts`, `use-storage-quota.ts`, `use-storage-backup.ts`.
New persistence code MUST route capacity checks through this module instead
of hand-rolling quota logic.

**Backup — owned by the chain `src/lib/indexeddb-storage.ts` (export/import
machinery) → `src/lib/backup-compression.ts` (`pn1` gzip + SHA-256 codec) →
`src/hooks/use-storage-backup.ts` (UI orchestration).** Backup scope is a
decision, not an oversight:

| Database | In backup? | Rationale |
|----------|-----------|-----------|
| `PlanarNexusStorage` | ✅ | User data of record — the whole point of backup |
| `PlanarNexusPresetsDB` | ❌ today | Only user-*authored* content outside Tier 1; folding into the Tier 1 export is the stage-2 stretch goal (§6) |
| `PlanarNexusCardDB` | ❌ | Re-importable from Scryfall; also potentially huge (would balloon export size) |
| `PlanarNexusCoach` | ❌ | Accepted gap (§7 follow-up): conversations are user-authored; candidates for inclusion once stage-2 reopens the export format |
| `LocalIntelligenceDB`, `PlanarNexusLimited` | ❌ | Derived / re-derivable; limited sessions could be promoted later if users report loss pain |
| `PlanarNexusGameDB`, `PlanarNexusReconnectTokens`, search trio | ❌ | Ephemeral or trivial UX state |

Any change to backup scope must update this table and
`use-storage-backup.ts`'s `ImportOptions` in the same PR.

---

## 6. Staged consolidation roadmap (follow-up issues; none executed here)

| Stage | Work | Trigger / notes |
|-------|------|-----------------|
| **1. Close the #1709 gaps** | Add `onblocked`/`onversionchange` handling (or migrate onto the wrapper class) in: `local-game-storage.ts`, `search-preferences.ts`, `search-presets.ts`, `recent-searches.ts`, the `use-reconnect-tokens.ts` second open; upgrade `p2p-reconnect-store.ts` from warn-only to reject. | Small, no data migration. Cheap insurance; prerequisite for any of these DBs ever reaching v2 (§5.5 rule 3). |
| **2. Fold the search trio into Tier 1** | `PlanarNexusStorage` v4 adds `search-preferences`, `search-presets`, `recent-searches` stores; the three modules swap internals to the `indexedDBStorage` singleton; migration = read-old → write-new → clear-old → `indexedDB.deleteDatabase` the three DBs; extend backup `ImportOptions` to cover presets. | Deletes three databases and three bespoke opens. The only "unification" this record commits to. |
| **3. Decide `PlanarNexusGameDB`'s fate** | Either absorb into `PlanarNexusStorage` ( alongside `saved-games*`) or retain with an explicit ephemerality rationale in §2. Also resolve the match-history duality already flagged in `use-p2p-connection.ts` (`useLocalStorage` mirror vs `match_records` as "durable source of truth"). | Decide when stage 2 reopens the main DB anyway. |
| **4. Dependency hygiene** | `npm uninstall dexie-react-hooks` (zero imports, verified) and update AGENTS.md/CLAUDE.md if wording mentions it. | Trivial; kept out of this issue only to honor the docs-only scope guard. |

**Explicit non-goals (do not open issues for these):** rewriting
`PlanarNexusStorage` on Dexie (rejected in §4); renaming
`LocalIntelligenceDB`; merging `PlanarNexusCardDB` or `PlanarNexusLimited`
into the main DB (their isolation is load-bearing).

---

## 7. Known gaps register

| Gap | Risk today | Disposition |
|-----|-----------|-------------|
| 6 of 10 opens lack full #1709 handling | Latent — all are v1 databases that have never version-bumped, so `blocked` cannot occur today | §6 stage 1; blocked-by-rule from bumping (§5.5 rule 3) |
| `dexie-react-hooks` declared, never imported | Dependency bloat, misleading docs (the original #1722 symptom) | §6 stage 4 |
| Coach conversations + limited sessions outside backup scope | User-authored content loss on export/import cycle | Documented decision (§5.6); revisit at stage 2 |
| Duplicate reconnect open in `use-reconnect-tokens.ts` | Duplicated schema knowledge; no blocked handling | Fold into `ReconnectTokenStore` (expose a read-only `list()`) in stage 1 |
| `p2p-reconnect-store.ts` warn-only `onblocked` | Open promise can pend forever under a future v2 | Stage 1 |

---

## 8. Verification appendix

Every claim above is reproducible from the worktree:

```bash
# Inventory of opens (10 databases, 2 stacks)
rg -n "indexedDB\.open|new Dexie" src/ --glob '!__tests__'

# dexie-react-hooks is dead weight
rg -rn "useLiveQuery|dexie-react-hooks" src/          # → no matches
rg -n '"dexie' package.json                           # → dexie + dexie-react-hooks both declared

# #1709 adoption
rg -ln "indexeddb-open-events|onblocked" src/ --glob '!__tests__'

# Quota single-owner consumers
rg -ln "storage-quota|withQuotaGuard|predictQuotaHeadroom" src/ --glob '!__tests__'

# Backup scope (only PlanarNexusStorage machinery is wrapped)
rg -n "exportBackup|exportIncrementalBackup" src/hooks/use-storage-backup.ts
```

*Maintained as the canonical persistence reference. If you add, remove, or
version-bump a database, updating this document is part of your PR.*
