# P2P Host-Migration WIP Triage (issue #1703)

**Decision: RETIRED — the preserved WIP is superseded by work already on `main`. Nothing is landed from it; the branch `wip/p2p-host-migration-20260907` is deleted.**

- Triage date: 2026-09-15
- Preserved branch: `wip/p2p-host-migration-20260907` @ `396ec760` (single `--no-verify` commit on base `9d126d6e`)
- Issue: [#1703](https://github.com/anchapin/planar-nexus/issues/1703)

## What the preserved WIP contained

The uncommitted hardening (~714 lines) was a parallel implementation of
**issue #1567 — replace the peer-self-reported `joinedAt` with a host-attested
`joinSeq`** for host-successor selection, across:

- `src/lib/p2p-host-migration.ts` — `PeerRosterEntry.joinSeq`, `assignNextJoinSeq`, `recordHostJoinSeq`, `seedHostJoinSeq`, `peekNextJoinSeq`; `selectHostSuccessor`/`peersList` sort by `(joinSeq asc, playerId asc)`.
- `src/hooks/use-p2p-connection.ts` — host seeds itself with `joinSeq: 0`, mints sequences on admit, broadcasts `roster-assignment` game-actions; followers record host-attested sequences with a `MAX_SAFE_INTEGER` sentinel until the assignment arrives.
- `src/lib/__tests__/p2p-host-migration.test.ts` — lying-peer / tie-break / monotonicity coverage.

Plus non-mergeable wave-session scratch artifacts: `.agents/results/*` session
logs, `scripts/create-issues.js`, `scripts/validate-wave.js` (both fail the
repo ESLint CJS config, per the preservation commit's own message), and a
stale `package-lock.json` delta.

## Why it is superseded

`e742816e` (_fix: resolve #1567 — replace peer-self-reported joinedat with
host-attested join sequence_, landed 2026-09-06) landed the same design on
`main` one day **before** this WIP was preserved (2026-09-07). Verified by
normalized token-level diff of the WIP tree vs current `main`
(comments stripped, quotes/whitespace normalized):

| File                                           | Result                                                                                                                                                                                                                     |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/p2p-host-migration.ts`                | identical (0.9997 similarity; only a Prettier union-type reformat)                                                                                                                                                         |
| `src/lib/__tests__/p2p-host-migration.test.ts` | identical (0.9999; only a trailing comma) — every WIP test name exists on `main`                                                                                                                                           |
| `src/hooks/use-p2p-connection.ts`              | 0.9441 — **all** differences are `main`'s later work (#1570 game-ended, #1569 heartbeat, #1710 barrel, #1716 sync ownership, #1708/#1707 envelope-key + HMAC hardening); every #1567 hunk from the WIP is present verbatim |

The WIP predates the #1708 per-sender pairwise envelope keys and the #1707
RFC 2104 HMAC, so its transport-trust comments are stale relative to current
`main`; the security properties of #1707/#1708 are untouched by this triage
(no code landed).

## Disposition

| Artifact                                                                                    | Action    | Rationale                                                                                                          |
| ------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/lib/p2p-host-migration.ts` changes                                                     | discarded | byte-equivalent (modulo formatting) to `main` since `e742816e`                                                     |
| `src/hooks/use-p2p-connection.ts` changes                                                   | discarded | equivalent logic already on `main`; WIP base predates #1570/#1569/#1708/#1716/#1710 and would conflict             |
| `src/lib/__tests__/p2p-host-migration.test.ts` changes                                      | discarded | identical suite already on `main`                                                                                  |
| `.agents/results/*`, `scripts/create-issues.js`, `scripts/validate-wave.js`, lockfile delta | discarded | wave-session scratch; commit message itself says "preserved verbatim, not for merge as-is"; scripts fail repo lint |
| Branch `wip/p2p-host-migration-20260907`                                                    | deleted   | acceptance criterion of #1703; content is recoverable from `396ec760` via reflog if ever needed                    |

## Verification on this branch

- `npm test -- --testPathPatterns="(host-migration|mesh|p2p)"` — 507 suites / 10543 tests passed (includes the full #1567 joinSeq suite: lying-peer, tie-break, monotonic counter, roster-assignment ordering).
- `npm run typecheck` — clean.

Closes #1703 as superseded.
