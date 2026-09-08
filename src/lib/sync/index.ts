/**
 * P2P game-state synchronization — versioned public API (issue #1716).
 *
 * OWNERSHIP (full contract: docs/P2P_SYNC_OWNERSHIP.md)
 * ------------------------------------------------------
 * This barrel is the single public entry point for the deterministic and
 * delta game-sync machinery that used to live inside the rules engine at
 * `src/lib/game-state/`. Nothing under `src/lib/game-state/` imports these
 * modules; they are pure networking consumers OF the engine (via the engine
 * barrel `@/lib/game-state`) and never the other way around.
 *
 * Concern ownership:
 * - Remote-action application (deterministic path): `deterministic-sync.ts`
 *   (`DeterministicGameStateEngine.applyRemoteAction`)
 * - Resync (engine-level snapshots / sync request-response):
 *   `deterministic-sync.ts`
 * - Delta / full-sync encoding: `delta-sync.ts`
 * - Live-match conflict resolution: `src/lib/p2p-conflict-resolution.ts`
 * - Post-reconnect resync decisions: `src/lib/p2p-reconciliation.ts`
 *
 * VERSIONING
 * ----------
 * This surface is versioned: bump {@link SYNC_API_VERSION} whenever an
 * export is renamed, removed, or its behavior changes in a way consumers
 * must react to. Additive changes bump the MINOR documented in the
 * changelog comment below; removals/renames bump the major and require a
 * migration note in docs/P2P_SYNC_OWNERSHIP.md.
 *
 * v1 (issue #1716): initial extraction from the engine barrel. The export
 *   set is identical to what `export * from "./deterministic-sync"` used to
 *   surface through `@/lib/game-state`, plus the delta-sync surface that
 *   `webrtc-p2p.ts` deep-imported. The only rename: delta-sync's
 *   `PeerSyncState` is exported as `DeltaPeerSyncState` because
 *   deterministic-sync already owns the bare name (both modules declare a
 *   type with that name; a star-export would silently drop it).
 */

/** Major version of this sync API surface. See module doc for the policy. */
export const SYNC_API_VERSION = 1 as const;

//
// Deterministic sync — action ordering, hash verification, resync snapshots.
//
export * from "./deterministic-sync";

//
// Delta sync — incremental game-state diffs for bandwidth-efficient sync.
//
export {
  computeStateDelta,
  applyDelta,
  shouldUseFullSync,
  isDeltaSmallEnough,
  estimateDeltaSize,
} from "./delta-sync";
export type {
  ObjectDiff,
  GameStateDelta,
  GameStateFullSync,
} from "./delta-sync";
/**
 * Delta-sync's per-peer tracking state. Aliased because
 * `deterministic-sync` also declares a `PeerSyncState` (the handshake /
 * acknowledgement one, which keeps the bare name above).
 */
export type { PeerSyncState as DeltaPeerSyncState } from "./delta-sync";
