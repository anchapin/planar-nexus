# Result — Architecture (issue #1722)

**Status: COMPLETE** — decision recorded, docs synced, verified, pushed.

## Charter check (retrospectively logged)

```
CHARTER_CHECK:
- Clarification level: LOW (issue + orchestrator brief fully specified scope: docs-first, no migrations)
- Task domain: architecture (decision record, not implementation)
- Must NOT do: data-format migrations; code rewrites; PR creation (orchestrator owns it)
- Success criteria: one documented architecture; shared migration/versioning convention; quota+backup single owners; AGENTS/CLAUDE claims match reality; facts verifiable
- Assumptions: "10 databases" counted from non-test open sites; dexie-react-hooks unused (verified 0 imports)
```

## Decision recorded

**Tiered multi-database architecture with two sanctioned stacks + staged consolidation of the accidental long tail.** Single-Dexie-DB unification explicitly REJECTED: `indexeddb-storage.ts` (raw wrapper, 1,602 lines) is the *most* hardened persistence code in the repo (incremental `oldVersion` migrations + per-hop tests, lazy re-run-safe v2→v3 migration, #1709 multi-tab handling, backup, quota guard); rewriting it risks user data for zero functional gain. Dedicated DBs blessed only where a carve-out exists (bulk re-derivable / independent wipe / isolation mandate / derived analytics). The 3 single-store search DBs + `PlanarNexusGameDB` are NOT blessed — staged into `PlanarNexusStorage` via roadmap (follow-up issues, honoring the scope guard).

Also corrected the issue's premise: per-origin quota is NOT fragmented by split DBs — quota *handling* was, and `storage-quota.ts` already centralizes it (documented as the single owner).

## Database inventory (10 databases, verified)

| DB | Ver | Owner | Stack |
|---|---|---|---|
| PlanarNexusStorage | 3 | indexeddb-storage.ts | raw wrapper (8 stores, backup source) |
| PlanarNexusCardDB | 2 | card-database.ts | raw (#1709+#1726 hardened) |
| PlanarNexusCoach | 1 | coach-conversation-storage.ts | raw wrapper reuse |
| PlanarNexusGameDB | 1 | local-game-storage.ts | raw (no #1709 — gap) |
| PlanarNexusReconnectTokens | 1 | p2p-reconnect-store.ts (+2nd open in use-reconnect-tokens.ts) | raw (warn-only #1709 — gap) |
| PlanarNexusSearchDB / PresetsDB / RecentSearchesDB | 1 each | src/lib/search/* | raw (no #1709 — consolidation queue) |
| LocalIntelligenceDB | 3 | src/lib/db/local-intelligence-db.ts | Dexie |
| PlanarNexusLimited | 1 | src/lib/limited/pool-storage.ts | Dexie (ISOL-01) |

Key extra findings: `dexie-react-hooks` declared but **never imported** (dead dep, removal = follow-up); `deck-storage.ts` is a facade over the wrapper, not a DB.

## Files changed

- `docs/PERSISTENCE_ARCHITECTURE.md` — NEW: full decision record (inventory, tier model, rejected alternative, conventions §5, roadmap §6, gaps §7, verification appendix §8)
- `AGENTS.md` — persistence bullet rewritten to match reality (10 DBs, 2 stacks, owners, doc pointer)
- `CLAUDE.md` — "IndexedDB via Dexie" deck-persistence claim fixed (deck-storage = facade over raw wrapper)
- Doc-headers only (comment-only edits): `storage-quota.ts` (quota OWNER), `indexeddb-storage.ts` (Tier-1 + backup OWNER), `backup-compression.ts` + `use-storage-backup.ts` (backup chain OWNER + scope), `use-storage-quota.ts` (sole quota UI surface), `local-intelligence-db.ts` (Tier-3 owner, append-only version-chain rule)

## Verification

- `npm run typecheck` — clean
- `eslint` on 6 touched .ts files — 0 errors (7 pre-existing warnings, non-gating per repo policy)
- `rg "via Dexie" AGENTS.md CLAUDE.md` — no matches (stale claim gone)
- Inventory re-verified: `rg "indexedDB\.open\(|new Dexie|super\("` → exactly 10 databases; `useLiveQuery` → 0 matches

## Risks / notes for orchestrator

- Roadmap stages 1–4 are documented follow-ups (deliberately not implemented: scope guard). Stage 1 (#1709 gap-closing) is the natural next issue.
- No PR created (per instructions). Branch pushed with --force-with-lease.
