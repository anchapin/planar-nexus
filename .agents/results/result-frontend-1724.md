# Result — frontend: issue #1724 (engine outbound deps)

**Status: COMPLETE** — branch `fix/issue-1724-engine-outbound-deps`, all gates green.

## Summary

Made `src/lib/game-state/` fully self-contained by moving every engine-consumed
definition INSIDE the engine boundary and turning the old root-level owners into
re-export facades (dependency direction reversed, zero consumer churn), plus an
eslint-enforced import boundary (`no-restricted-imports` siblings to the #1710
barrel rule) with a guard test that pins the enforcement itself.

## Engine-outbound imports found → resolution

| # | Import | Consumers in engine | Resolution |
|---|--------|---------------------|-----------|
| 1 | `getGameMode` from `@/lib/game-rules` (VALUE import) | `validation-service.ts:8` | **move+reexport**: `DeckConstructionRules`, `GameModeConfig`, `DEFAULT_RULES`, `gameModes`, `Format` + accessors (`getGameMode`, `getAllGameModes`, `createGameMode`, `registerGameMode`, `findGameModeByName`) moved verbatim to **`src/lib/game-state/format-rules.ts`** as versioned input data (`FORMAT_RULES_VERSION = "1.0.0"`). `src/lib/game-rules.ts` is now a facade that re-exports them (1,548 → 1,183 lines); all 24 outside consumers unchanged. |
| 2 | `import type { ScryfallCard }` from `@/lib/card-database` | 12 source files + 55 test files | **move+reexport**: `MinimalCard` + `ScryfallCard` moved verbatim to **`src/lib/game-state/types/card-data.ts`**; `card-database.ts` re-exports both (issue #1593 "single canonical import site" contract preserved); `DeckCard`/`SavedDeck` stay in card-database. Engine files now import from `./types` / `./card-data` / `../types`. |
| 3 | `../../cards/dungeons` (relative escape, found BY the new lint rule — missed in the original issue) | `keyword-actions/dungeon.ts`, `keyword-actions/shared.ts`, `trigger-system.ts` | **move**: dungeon definitions + accessors moved verbatim to **`src/lib/game-state/dungeon-data.ts`** (`git mv`); old file deleted (had zero non-engine consumers). |
| 4 | `../compression/native-gzip` (relative escape, also found by the rule) | `game-state-compression.ts` | **move+reexport**: gzip helpers moved verbatim to **`src/lib/game-state/native-gzip.ts`**; `src/lib/compression/native-gzip.ts` is now a 2-line facade re-exporting from the engine barrel (keeps `backup-compression.ts` + its test suite working unchanged). |

No injected-interface fallback was needed — every outbound dependency was pure
data or self-contained helpers, so the reversal pattern (engine owns; root module
re-exports) covered all four with zero behavior change. `registerGameMode`'s
runtime mutation semantics are preserved: engine and facade share the same module
instance.

## Enforcement wiring

- **Rule**: `no-restricted-imports` (error) in `eslint.config.mjs`, sibling to
  the #1710 barrel block. A helper `engineOutboundBoundaryBlock(filesGlob,
  escapeRegex)` generates three depth-partitioned blocks
  (`src/lib/game-state/*.{ts,tsx}`, `*/*.{ts,tsx}`, `*/*/*.{ts,tsx}`) that ban:
  - any `@/*` alias import except `@/lib/game-state` (regex with negative
    lookahead: `^@(?!/lib/game-state(?:$|/))/` — the `ignore`-package group
    matcher could not express this: gitignore parent-cascade defeats negations)
  - depth-exact relative escapes (`^\.\./`, `^\.\./\.\./`, `^\.\./\.\./\.\./`)
  - pointed `paths` messages for `@/lib/game-rules` and `@/lib/card-database`
  - type-only imports ARE flagged (no `allowTypeImports`)
- **Tests**: the #1710 rule had no test file to mirror, so a new guard suite was
  created: **`tests/engine-import-boundary.test.ts`** (10 cases) lints virtual
  fixtures via `eslint --stdin --stdin-filename`, pinning violations AND
  allowances (own barrel, intra-engine relative, vendored, depth-2 `families`
  pattern) plus the intact #1710 outside-the-engine semantics.
- **Barrel**: `format-rules`, `dungeon-data`, `native-gzip` star-exported from
  `src/lib/game-state/index.ts` (name-collision checked; `types/card-data` flows
  via the `types` shim).

## Verification (all green)

| Gate | Result |
|------|--------|
| `npm run typecheck` | ✅ clean |
| `npm run lint` (includes new boundary rule) | ✅ **0 errors** (610 warnings, cap 1000) |
| `npm test -- --testPathPatterns=game-state` | ✅ 138 suites / 3,224 tests |
| `game-rules\|compression\|validation-service\|p2p-game\|card-database` suites | ✅ 12 suites / 459 tests (validation-service tests green UNCHANGED — no test file was semantically edited) |
| `npm run test:coverage` (full CI-equivalent) | ✅ 502 suites / 10,439 tests, coverage thresholds pass (statements 60.91%) |
| `tests/engine-import-boundary.test.ts` | ✅ 10/10 |
| engine size budget (`check-engine-size-budget.mjs`) | ✅ 89 modules within 2,000 lines (max 1,934) |
| AC proof: alias scan `from "@/lib/…"` (non-game-state) under engine | ✅ zero hits (only a prose comment in `index.ts`) |
| AC proof: depth-aware relative-escape scan | ✅ zero hits |

## Files changed (81)

New: `src/lib/game-state/format-rules.ts`, `src/lib/game-state/types/card-data.ts`,
`src/lib/game-state/dungeon-data.ts` (git-mv), `src/lib/game-state/native-gzip.ts`
(git-mv), `src/lib/compression/native-gzip.ts` (facade),
`tests/engine-import-boundary.test.ts`.
Modified: `eslint.config.mjs`, `src/lib/game-rules.ts` (facade),
`src/lib/card-database.ts` (re-export), engine barrel + `types.ts` shim,
12 engine source files, 55 engine test files (import specifier only:
`@/lib/card-database` → `../types`), `AGENTS.md`, `CLAUDE.md`,
`src/lib/game-state/README.md`.

## Notes for other agents / follow-ups

- `src/lib/p2p-game-connection.ts:37` deep-imports `./game-state/validation-service`
  via a RELATIVE path, which the #1710 alias-pattern rule cannot see (and
  `ValidationService` isn't on the barrel). Pre-existing; out of #1724 scope —
  worth a follow-up issue.
- Video-derived-tests workflow will trigger (changes under
  `src/lib/game-state/**`); the full engine suite passed locally.
- `FORMAT_RULES_VERSION` bump policy documented in `format-rules.ts` header.
