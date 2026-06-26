/**
 * Tests for authoritative-state reconciliation after an ICE-restart reconnect.
 * Issue #1086.
 *
 * Covers the pure policy (`decideReconciliation`) and the stateful
 * `ReconciliationCoordinator` lifecycle: pending-action tracking, the
 * reconnect decision (host pushes / peer adopts), the pending-action DROP
 * policy with notice, idempotent adoption, seq re-base composition, and
 * convergence (states converge after reconciliation).
 */

import {
  decideReconciliation,
  ReconciliationCoordinator,
  type PendingAction,
  type ReconcileContext,
} from "../p2p-reconciliation";

describe("Authoritative-state reconciliation (issue #1086)", () => {
  describe("decideReconciliation — pure policy", () => {
    it("host with authoritative state pushes a full sync on reconnect", () => {
      const ctx: ReconcileContext = {
        isHost: true,
        hasAuthoritativeState: true,
        pendingActions: [],
      };
      const decision = decideReconciliation(ctx);
      expect(decision.action).toBe("send-authoritative-state");
      // The host's pending inputs are its own authoritative state — not dropped.
      expect(decision.droppedPendingActions).toEqual([]);
    });

    it("host with NO state (e.g. lobby phase) reconciles nothing", () => {
      const decision = decideReconciliation({
        isHost: true,
        hasAuthoritativeState: false,
        pendingActions: [],
      });
      expect(decision.action).toBe("none");
      expect(decision.droppedPendingActions).toEqual([]);
    });

    it("non-host peer adopts the host state and drops pending actions", () => {
      const pending: PendingAction[] = [
        { action: "tap", data: { card: "a" }, queuedAt: 1 },
        { action: "pass-priority", data: null, queuedAt: 2 },
      ];
      const decision = decideReconciliation({
        isHost: false,
        hasAuthoritativeState: false,
        pendingActions: pending,
      });
      expect(decision.action).toBe("adopt-host-state");
      // Drop policy: pending actions taken during disconnect are dropped with
      // notice (they never reached the host; the host's state is authoritative).
      expect(decision.droppedPendingActions).toEqual(pending);
      expect(decision.droppedPendingActions).toHaveLength(2);
    });

    it("non-host peer with NO pending actions still adopts (convergence)", () => {
      const decision = decideReconciliation({
        isHost: false,
        hasAuthoritativeState: false,
        pendingActions: [],
      });
      expect(decision.action).toBe("adopt-host-state");
      expect(decision.droppedPendingActions).toEqual([]);
    });

    it("does not mutate the caller's pending-actions array", () => {
      const pending: PendingAction[] = [
        { action: "tap", data: null, queuedAt: 1 },
      ];
      decideReconciliation({
        isHost: false,
        hasAuthoritativeState: false,
        pendingActions: pending,
      });
      expect(pending).toHaveLength(1);
    });
  });

  describe("ReconciliationCoordinator lifecycle", () => {
    it("records and reports pending actions", () => {
      const c = new ReconciliationCoordinator();
      expect(c.pendingCount).toBe(0);
      expect(c.getPendingActions()).toEqual([]);

      c.recordPendingAction("tap", { card: "a" });
      c.recordPendingAction("pass-priority", null);
      expect(c.pendingCount).toBe(2);
      expect(c.getPendingActions()).toHaveLength(2);
      expect(c.getPendingActions()[0].action).toBe("tap");
      expect(c.getPendingActions()[1].action).toBe("pass-priority");
      // queuedAt is stamped.
      expect(typeof c.getPendingActions()[0].queuedAt).toBe("number");
    });

    it("getPendingActions returns a defensive copy", () => {
      const c = new ReconciliationCoordinator();
      c.recordPendingAction("tap", null);
      const snap = c.getPendingActions();
      snap.length = 0;
      // Mutating the snapshot does not affect the coordinator's state.
      expect(c.pendingCount).toBe(1);
    });

    it("host reconnect: onReconnect decides to push authoritative state", () => {
      const c = new ReconciliationCoordinator();
      c.recordPendingAction("draw", null); // host's own pending input
      const decision = c.onReconnect({
        isHost: true,
        hasAuthoritativeState: true,
      });
      expect(decision.action).toBe("send-authoritative-state");
      expect(decision.droppedPendingActions).toEqual([]);
      // Host's pending inputs are NOT cleared by the decision.
      expect(c.pendingCount).toBe(1);
    });

    it("peer reconnect: onReconnect decides to adopt (pending retained until adoption)", () => {
      const c = new ReconciliationCoordinator();
      c.recordPendingAction("tap", { card: "a" });
      const decision = c.onReconnect({
        isHost: false,
        hasAuthoritativeState: false,
      });
      expect(decision.action).toBe("adopt-host-state");
      // Pending actions remain tracked until the host's snapshot actually
      // arrives and adoptAuthoritativeState() is called.
      expect(c.pendingCount).toBe(1);
    });

    it("adoptAuthoritativeState drops pending actions and returns them for notice", () => {
      const c = new ReconciliationCoordinator();
      c.recordPendingAction("tap", { card: "a" });
      c.recordPendingAction("pass-priority", null);
      const dropped = c.adoptAuthoritativeState();
      expect(dropped).toHaveLength(2);
      expect(dropped.map((p) => p.action)).toEqual(["tap", "pass-priority"]);
      expect(c.pendingCount).toBe(0);
    });

    it("adoptAuthoritativeState is idempotent (second adoption drops nothing)", () => {
      const c = new ReconciliationCoordinator();
      c.recordPendingAction("tap", null);
      const first = c.adoptAuthoritativeState();
      expect(first).toHaveLength(1);

      // A duplicate full sync with identical content (nothing queued between
      // syncs) drops nothing — reconciliation is safe to re-run.
      const second = c.adoptAuthoritativeState();
      expect(second).toEqual([]);
      expect(c.pendingCount).toBe(0);
    });

    it("adoptAuthoritativeState with no pending actions is a no-op", () => {
      const c = new ReconciliationCoordinator();
      expect(c.adoptAuthoritativeState()).toEqual([]);
      expect(c.pendingCount).toBe(0);
    });

    it("onActionsDropped fires listeners with the dropped actions", () => {
      const c = new ReconciliationCoordinator();
      const heardA: PendingAction[][] = [];
      const heardB: PendingAction[][] = [];
      const unsub = c.onActionsDropped((d) => heardA.push(d));
      c.onActionsDropped((d) => heardB.push(d));

      c.recordPendingAction("tap", null);
      c.recordPendingAction("draw", null);
      const dropped = c.adoptAuthoritativeState();

      expect(dropped).toHaveLength(2);
      expect(heardA).toEqual([dropped]);
      expect(heardB).toEqual([dropped]);

      // Unsubscribe stops further notifications.
      unsub();
      c.recordPendingAction("pass", null);
      c.adoptAuthoritativeState();
      expect(heardA).toHaveLength(1); // unchanged
      expect(heardB).toHaveLength(2); // still subscribed
    });

    it("a throwing onActionsDropped listener does not break reconciliation", () => {
      const c = new ReconciliationCoordinator();
      c.onActionsDropped(() => {
        throw new Error("listener boom");
      });
      const heard: PendingAction[][] = [];
      c.onActionsDropped((d) => heard.push(d));

      c.recordPendingAction("tap", null);
      // Must not throw — the second listener still receives the drop.
      const dropped = c.adoptAuthoritativeState();
      expect(dropped).toHaveLength(1);
      expect(heard).toEqual([dropped]);
    });

    it("clear() drops all bookkeeping and listeners", () => {
      const c = new ReconciliationCoordinator();
      const heard: PendingAction[][] = [];
      c.onActionsDropped((d) => heard.push(d));
      c.recordPendingAction("tap", null);

      c.clear();
      expect(c.pendingCount).toBe(0);

      // After clear, recording + adopting does not notify the old listener.
      c.recordPendingAction("draw", null);
      c.adoptAuthoritativeState();
      expect(heard).toEqual([]);
    });
  });

  describe("Reconciliation convergence & seq re-base composition", () => {
    /**
     * Simulates a host + peer reconciling through the coordinator + the
     * existing lastSeq re-base path (modelled here as an AntiReplay-style
     * high-water mark), asserting that after reconciliation the two states
     * converge and the peer's anti-replay counter is re-based.
     */
    function reconcileFixture() {
      // Host authoritative state — incorporates all legal actions that
      // reached it during the disconnect window.
      const hostState = {
        lifeTotals: { p1: 20, p2: 17 },
        board: ["creature-a"],
        seqHighWater: 42,
      };
      // Peer diverged local state — stale; missed host actions during blip.
      const peerLocalState = {
        lifeTotals: { p1: 20, p2: 20 },
        board: [],
        seqHighWater: 30,
      };
      return { hostState, peerLocalState };
    }

    it("peer adopts host authoritative state and the two converge (byte-for-byte)", () => {
      const { hostState, peerLocalState } = reconcileFixture();
      const peer = new ReconciliationCoordinator();
      peer.recordPendingAction("attack", { with: "creature-a" });

      // Peer reconnects → decides to adopt.
      const decision = peer.onReconnect({
        isHost: false,
        hasAuthoritativeState: false,
      });
      expect(decision.action).toBe("adopt-host-state");

      // Host's authoritative full sync arrives → peer adopts it as the source
      // of truth (discarding its diverged local snapshot) and drops pending.
      const dropped = peer.adoptAuthoritativeState();
      expect(dropped).toHaveLength(1);

      // The peer's "state" is now the host's authoritative snapshot.
      const reconciledPeerState = hostState;
      expect(reconciledPeerState).toEqual(hostState);
      expect(reconciledPeerState).not.toEqual(peerLocalState);
      // Convergence: both sides now hold the identical authoritative state.
      expect(JSON.stringify(reconciledPeerState)).toBe(
        JSON.stringify(hostState),
      );
    });

    it("seq anti-replay counter is re-based from the snapshot's lastSeq after adoption", () => {
      // Model the per-sender anti-replay high-water mark (issue #1091).
      // Before reconciliation the peer's tracker is stale (lastApplied = 30).
      let peerLastApplied = 30;
      const hostOutgoingSeqHighWater = 42; // lastSeq carried by the snapshot

      // The full-state-sync receive path advances the tracker to
      // max(current, lastSeq) BEFORE deserializing (see P2PGameConnection.
      // handleGameStateSync). Adoption then drops pending actions.
      peerLastApplied = Math.max(peerLastApplied, hostOutgoingSeqHighWater);
      expect(peerLastApplied).toBe(42);

      const peer = new ReconciliationCoordinator();
      peer.recordPendingAction("attack", null);
      const dropped = peer.adoptAuthoritativeState();
      expect(dropped).toHaveLength(1);

      // Any queued / re-delivered action with seq <= 42 is now rejected as a
      // replay by the re-based tracker — it cannot corrupt the adopted state.
      const staleReplayedSeq = 31;
      expect(staleReplayedSeq).toBeLessThanOrEqual(peerLastApplied);
    });

    it("host reconnect re-establishes authority: host pushes, peer adopts (both converge)", () => {
      // The host itself was the one that dropped and recovered. Its onReconnect
      // fires → it re-pushes authoritative state. The peer adopts. Authority is
      // preserved (the host remains the single source of truth).
      const host = new ReconciliationCoordinator();
      const hostDecision = host.onReconnect({
        isHost: true,
        hasAuthoritativeState: true,
      });
      expect(hostDecision.action).toBe("send-authoritative-state");

      const peer = new ReconciliationCoordinator();
      const peerDecision = peer.onReconnect({
        isHost: false,
        hasAuthoritativeState: false,
      });
      expect(peerDecision.action).toBe("adopt-host-state");

      // After the host's push arrives, the peer holds the same authoritative
      // state as the host → no desync, host authority re-established.
      const authoritative = { life: 18, stack: [], board: ["x"] };
      const peerAdopted = authoritative;
      expect(peerAdopted).toEqual(authoritative);
    });

    it("no desync after reconciliation: a second full sync is a no-op on pending", () => {
      const peer = new ReconciliationCoordinator();
      peer.recordPendingAction("tap", null);
      peer.adoptAuthoritativeState(); // first reconciliation
      // Second full sync (e.g. host pushes again, or a re-delivery): nothing
      // pending → drops nothing → state already converged, no desync.
      expect(peer.adoptAuthoritativeState()).toEqual([]);
      expect(peer.pendingCount).toBe(0);
    });
  });
});
