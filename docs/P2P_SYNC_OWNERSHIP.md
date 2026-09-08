# P2P Game-Sync Ownership Contract

**Issue #1716 — [TechDebt] Establish single ownership for the P2P game-sync state machine.**

This document is the normative answer to _"who owns game-state truth during a
P2P match?"_ and names the single authoritative module for each sync concern.
When a change touches P2P synchronization, the module named here is the ONLY
place its concern may be implemented. If a discrepancy is found between this
contract and the code, either fix the code or update this contract in the same
PR — never let them drift.

## Who owns game-state truth during a P2P match?

**The host's game state is authoritative.** Exactly one peer — identified by
`currentHostId` (initially the lobby host, movable via host migration, see
`src/lib/p2p-host-migration.ts`) — holds the authoritative `GameState`. Every
other peer's state is a projection that must converge to the host's snapshot:

- Followers adopt the host's full `game-state-sync` snapshot (issue #1086
  reconciliation) whenever one arrives after a reconnect.
- Divergence is _detected_ by hash/checksum comparison
  (`computeStateHash` in the engine barrel, `calculateStateChecksum` /
  `verifyChecksum` in `p2p-handshake.ts`) but is _resolved_ by adopting the
  host's snapshot — never by a follower-side merge.
- On host migration the promoted peer seeds its authority from the latest
  cached host snapshot (`p2p-host-migration.ts` owns that promotion).

## Concern → authoritative module

| Concern                                                                                        | Authoritative module                                                                    | Notes                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remote-action application (deterministic path: ordering, prev-hash validation, action history) | `src/lib/sync/deterministic-sync.ts` (`DeterministicGameStateEngine.applyRemoteAction`) | Validates `previousStateHash` against the local hash before accepting an action into history.                                                                  |
| Conflict resolution for simultaneous actions in a LIVE match (queue/process/winner/tie-break)  | `src/lib/p2p-conflict-resolution.ts`                                                    | `ConflictResolutionManager.processAction` + `decideOutboundAction` (send-path policy) + `pickWinnerByTimestamp` (deterministic tie-break, issue #1096).        |
| Outbound queue/process/send policy                                                             | `src/lib/p2p-conflict-resolution.ts` (`decideOutboundAction`)                           | Extracted from `use-p2p-connection.ts` in #1716; the hook maps verdicts to transport calls and owns no policy.                                                 |
| Resync — reconnect decision (push authoritative snapshot vs. adopt host state)                 | `src/lib/p2p-reconciliation.ts`                                                         | `decideReconciliation` (pure) driven by `ReconciliationCoordinator`; adoption finalizes via `adoptAuthoritativeState()`.                                       |
| Resync — engine-level snapshots / sync request-response messages                               | `src/lib/sync/deterministic-sync.ts`                                                    | `StateSnapshot` rollback, `SyncRequestMessage` / `SyncResponseMessage`, `requestStateSync` on the transport.                                                   |
| Delta / full-sync encoding (bandwidth)                                                         | `src/lib/sync/delta-sync.ts`                                                            | `computeStateDelta`, `applyDelta`, `shouldUseFullSync`.                                                                                                        |
| Sync message wire types + (de)serialization                                                    | `src/lib/sync/deterministic-sync.ts`                                                    | `GameSyncMessage` union, `serializeSyncMessage` / `deserializeSyncMessage`. Versioned via `SYNC_API_VERSION` in `src/lib/sync/index.ts`.                       |
| Checksum verification of state syncs                                                           | `src/lib/p2p-handshake.ts`                                                              | `verifyChecksum` (structured algorithms) and `verifySimpleStateChecksum` (legacy djb2 — kept byte-compatible, #1716).                                          |
| Desync event logging/diagnostics                                                               | `src/lib/desync-logger.ts`                                                              | Observability only — never decides outcomes.                                                                                                                   |
| Transport (WebRTC data channels, send queue, ICE)                                              | `src/lib/webrtc-p2p.ts`, `src/lib/p2p-direct-connection.ts`                             | Moves bytes; applies no conflict policy.                                                                                                                       |
| Connection / message framing, roles, anti-replay                                               | `src/lib/p2p-game-connection.ts`                                                        | Trust boundary; role gating via `src/lib/peer-role.ts`.                                                                                                        |
| Handshake (identity + state-hash agreement)                                                    | `src/lib/p2p-handshake.ts`                                                              |                                                                                                                                                                |
| Lobby / roster lifecycle                                                                       | `src/lib/lobby-manager.ts`                                                              |                                                                                                                                                                |
| Host migration (authority transfer)                                                            | `src/lib/p2p-host-migration.ts`                                                         |                                                                                                                                                                |
| Orchestration (React: wiring the above to UI state)                                            | `src/hooks/use-p2p-connection.ts`                                                       | Transport-agnostic. **Contains no inline conflict, checksum, or resync policy** — it imports the canonical modules and maps their verdicts to transport calls. |
| Desync detection loop (hash verification cadence)                                              | `src/hooks/use-state-sync.ts`                                                           | Consumes the versioned sync API (`@/lib/sync`) and engine hashing (`@/lib/game-state`).                                                                        |

## The versioned sync API (`src/lib/sync/`)

Before #1716, `deterministic-sync.ts` and `delta-sync.ts` lived inside the
rules engine (`src/lib/game-state/`) — mixing networking concerns into the
correctness-critical, mutation-tested engine surface — and `delta-sync.ts`
was not even reachable through the engine barrel (only via a deep import from
`webrtc-p2p.ts`). They are now re-homed under `src/lib/sync/` with a single
versioned entry point:

```ts
import {
  SYNC_API_VERSION,
  DeterministicGameStateEngine,
  computeStateDelta,
} from "@/lib/sync";
```

Rules:

1. **No engine dependencies outbound.** `src/lib/sync/**` imports the engine
   only through the barrel `@/lib/game-state`. Nothing under
   `src/lib/game-state/**` imports `src/lib/sync/**` (that would invert the
   dependency and recreate issue #1724's complaint).
2. **Versioning.** `SYNC_API_VERSION` (currently `1`) bumps on any
   rename/removal/behavior change to the sync surface; additive changes are
   minor. Migration notes go in this file.
3. **One name collision resolved.** Both sync modules declare a
   `PeerSyncState`. Through `@/lib/sync`, deterministic-sync's
   (handshake/ack-tracking) keeps the bare name; delta-sync's is exported as
   `DeltaPeerSyncState`.

## Known deliberate mirrors (do not "fix" casually)

- `p2p-conflict-resolution.ts#pickWinnerByTimestamp` and
  `deterministic-sync.ts#DeterministicGameStateEngine.resolveSimultaneousConflict`
  implement the SAME deterministic ordering rule (lower timestamp wins; ties
  broken by lexicographic peer id). The former governs LIVE matches; the
  latter is a private strategy inside the deterministic engine's
  conflict/rollback path. They are intentionally separate code paths — the
  live path must stay transport-latency-tolerant — but the tie-break RULE
  must remain identical in both. If one changes, change the other in the same
  PR and update both test suites
  (`src/lib/__tests__/p2p-conflict-resolution.test.ts`,
  `src/lib/sync/__tests__/deterministic-sync-edge-cases.test.ts`).

## Scope guards

- **Wire format is frozen** relative to #1716: no `GameMessage` /
  `GameSyncMessage` / `GameStateDelta` field changes. Type re-homing
  (`@/lib/game-state` → `@/lib/sync`) and the `DeltaPeerSyncState` alias are
  source-level only.
- The engine barrel `src/lib/game-state/index.ts` no longer exports any sync
  symbols; `HashComparisonResult` / `HashDiscrepancy` remain available from
  the engine barrel via `state-hash` (and from `@/lib/sync`).
