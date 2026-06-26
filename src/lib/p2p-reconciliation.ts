/**
 * Authoritative-state reconciliation after an ICE-restart reconnect.
 *
 * Issue #1086: #943/#915 restored the TRANSPORT after a transient ICE
 * disconnect (bounded ICE-restart retries in `webrtc-p2p.ts`:
 * `attemptReconnection` → `performIceRestart` → `waitForRecovery`) but
 * explicitly did NOT reconcile game state. Any action taken during the
 * disconnect window (up to ~45s) was lost to the recovering peer, desyncing
 * life totals, the stack and the board. This module owns the reconcile
 * POLICY that runs once the transport recovers.
 *
 * ## Authoritative-host model — the host is the single source of truth
 *   - On reconnect, if the local node is the authoritative host AND it holds
 *     the authoritative state, it PUSHES a full `game-state-sync` snapshot
 *     (`isFullSync: true`). That snapshot carries `lastSeq` (issue #1091) so
 *     the receiver re-bases its per-sender anti-replay high-water mark and
 *     any queued / re-delivered action with `seq <= lastSeq` is rejected as a
 *     replay. (The send + receive + lastSeq re-base path already exists in
 *     `P2PGameConnection` / `MeshGameConnection`; this module only decides
 *     WHEN to drive it.)
 *   - On reconnect, if the local node is a non-host peer, it ADOPTS the
 *     host's incoming authoritative state and DROPS any pending local
 *     actions it took during the disconnect window (see policy below).
 *
 * ## Pending-action policy (documented)
 *   When the local node is NOT the host and the transport dropped, the player
 *   may have queued actions that never reached the host. On reconnect the
 *   peer ADOPTS the host's authoritative state and DROPS those pending
 *   actions. Rationale:
 *     1. Those actions never reached the host, so the host's state cannot
 *        reflect them.
 *     2. The host's state already incorporates every legal action that DID
 *        reach it (and was validated by the rules engine, #1089), so it is
 *        strictly more correct than the peer's diverged local snapshot.
 *     3. Re-submitting the dropped actions against the now-adopted state
 *        could double-apply or conflict (e.g. tapping an already-tapped
 *        permanent, spending mana already spent). The authoritative-host
 *        model forbids that.
 *   The host re-validates any FUTURE action via #1089's rules-engine
 *   validator, so nothing illegal can sneak back in. Dropped actions are
 *   surfaced for user notice (e.g. a toast) so the player is never silently
 *   undone — see {@link ReconciliationCoordinator.onActionsDropped}.
 *
 * ## Composition with existing trust machinery
 *   - anti-replay (#1091): the snapshot's `lastSeq` re-bases the per-sender
 *     tracker so reconnect re-delivery / queued replays are rejected.
 *   - host-side rules-engine validation (#1089): the host's authoritative
 *     state is the product of validated actions, and all future peer actions
 *     are re-validated against it.
 *   - host migration (#946): if the host itself was the one that dropped and
 *     a successor was promoted, the successor's post-migration full sync is
 *     what the peer adopts here — authority is re-established.
 *
 * The coordinator is pure in-memory state — no transport, no clocks, no I/O
 * — so it is trivially unit-testable and composes under any connection layer
 * (`P2PGameConnection` or `MeshGameConnection`).
 */

/**
 * A local game-action that could not be delivered because the transport was
 * down. Recorded by the connection layer while disconnected and reconciled on
 * reconnect.
 */
export interface PendingAction {
  action: string;
  data: unknown;
  /** When the action was recorded (`Date.now()`). For diagnostics / notice. */
  queuedAt: number;
}

/**
 * What the connection layer must do when the transport recovers.
 *
 * `send-authoritative-state` — local host pushes a full `game-state-sync`
 *   snapshot (`isFullSync: true`, carrying `lastSeq`) to the recovering peer.
 * `adopt-host-state` — non-host peer waits for and adopts the host's
 *   authoritative full sync, dropping its pending actions.
 * `none` — nothing to reconcile (e.g. the host has no state yet, lobby
 *   phase, or single-player).
 */
export type ReconcileAction =
  | "send-authoritative-state"
  | "adopt-host-state"
  | "none";

/**
 * Verdict returned to the connection layer on a reconnect event. The caller
 * executes {@link action} and, when adopting, surfaces
 * {@link droppedPendingActions} for user notice.
 */
export interface ReconcileDecision {
  action: ReconcileAction;
  /**
   * Pending local actions dropped because the host never received them.
   * Non-empty only when {@link action} is `adopt-host-state`.
   */
  droppedPendingActions: PendingAction[];
}

/**
 * Inputs to the pure reconcile decision.
 */
export interface ReconcileContext {
  /** True when the local node currently holds host authority. */
  isHost: boolean;
  /** True when the local host has authoritative state available to push. */
  hasAuthoritativeState: boolean;
  /** Pending actions the local node took during the disconnect window. */
  pendingActions: readonly PendingAction[];
}

/**
 * Pure reconcile decision for a reconnect event. Extracted from the stateful
 * {@link ReconciliationCoordinator} so the policy is independently testable
 * and identical across the 1:1 and mesh connection layers. Issue #1086.
 */
export function decideReconciliation(ctx: ReconcileContext): ReconcileDecision {
  if (ctx.isHost) {
    if (ctx.hasAuthoritativeState) {
      // The host pushes its authoritative snapshot; the peer adopts it. The
      // host's own pending inputs are its authoritative state and remain
      // valid (they are not "dropped").
      return { action: "send-authoritative-state", droppedPendingActions: [] };
    }
    // Host with no state yet (e.g. lobby) — nothing to reconcile.
    return { action: "none", droppedPendingActions: [] };
  }

  // Non-host peer: adopt the host's incoming authoritative state and drop
  // any pending actions that never reached the host (see policy above).
  return {
    action: "adopt-host-state",
    droppedPendingActions: [...ctx.pendingActions],
  };
}

/**
 * Listener fired when pending actions are dropped on adoption of the host's
 * authoritative state. The connection layer wires this to surface a user
 * notice (toast / log) so the player is not silently undone.
 */
export type DroppedActionsListener = (dropped: PendingAction[]) => void;

/**
 * Stateful coordinator a connection layer drives through the reconnect
 * lifecycle. Tracks pending actions recorded while the transport is down and
 * produces the reconcile decision on reconnect / adoption. Issue #1086.
 *
 * The coordinator owns ONLY the pending-action bookkeeping and the decision;
 * it never touches the wire or game state directly — the caller does the
 * send/adopt using the existing full-state-sync path. This keeps the policy
 * pure, transport-agnostic and deterministic under test.
 */
export class ReconciliationCoordinator {
  private readonly pending: PendingAction[] = [];
  private droppedListeners: DroppedActionsListener[] = [];

  /**
   * Record an action that could not be delivered because the transport was
   * down. Called by the connection layer's send path while disconnected.
   */
  recordPendingAction(action: string, data: unknown): void {
    this.pending.push({ action, data, queuedAt: Date.now() });
  }

  /** Number of pending (unsent) actions currently tracked. */
  get pendingCount(): number {
    return this.pending.length;
  }

  /** Defensive snapshot of the pending actions. */
  getPendingActions(): PendingAction[] {
    return [...this.pending];
  }

  /**
   * Called when the transport recovered via an ICE-restart reconnect.
   * Returns the reconcile decision the caller must execute. Does NOT mutate
   * pending state for a host push (the host's pending inputs are its own
   * authoritative state and remain valid); for an adopt decision the caller
   * finalises the drop via {@link adoptAuthoritativeState} once the host's
   * snapshot actually arrives.
   */
  onReconnect(
    ctx: Omit<ReconcileContext, "pendingActions">,
  ): ReconcileDecision {
    return decideReconciliation({ ...ctx, pendingActions: this.pending });
  }

  /**
   * Called when an authoritative full `game-state-sync` was ADOPTED from the
   * host. Drops every pending action (the host never received them) and
   * notifies listeners so the UI can surface the loss. Returns the dropped
   * actions.
   *
   * Idempotent: a duplicate full sync with identical content (no pending
   * actions queued between syncs) drops nothing and returns `[]`, so
   * reconciliation is safe to re-run. Issue #1086 acceptance criterion.
   */
  adoptAuthoritativeState(): PendingAction[] {
    if (this.pending.length === 0) return [];
    const dropped = [...this.pending];
    this.pending.length = 0;
    for (const listener of this.droppedListeners) {
      try {
        listener(dropped);
      } catch {
        // A listener error must never break reconciliation.
      }
    }
    return dropped;
  }

  /**
   * Register a listener fired when pending actions are dropped on adoption.
   * Returns an unsubscribe function. Listeners are best-effort: a throwing
   * listener is swallowed (see {@link adoptAuthoritativeState}).
   */
  onActionsDropped(listener: DroppedActionsListener): () => void {
    this.droppedListeners.push(listener);
    return () => {
      this.droppedListeners = this.droppedListeners.filter(
        (l) => l !== listener,
      );
    };
  }

  /** Drop all bookkeeping (e.g. on session teardown / close). */
  clear(): void {
    this.pending.length = 0;
    this.droppedListeners = [];
  }
}
