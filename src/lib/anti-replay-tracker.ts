/**
 * Per-sender anti-replay high-water-mark tracker.
 *
 * Extracted as a reusable primitive (issue #1087) so the multi-peer mesh
 * ({@link MeshGameConnection}) and the legacy 1:1 connection
 * (`P2PGameConnection`) can share one identical replay-protection policy
 * without duplicating the logic. `GameMessage`s carry a monotonic per-sender
 * `seq` (issue #1091); the receiver tracks the highest `seq` it has applied
 * per `senderId` and rejects any message whose `seq` is `<=` that high-water
 * mark. This drops duplicates (reconnect re-delivery, #943) and replays
 * (host-migration rebroadcast, #946) before they can corrupt game state.
 *
 * The tracker is pure in-memory state — no transport, no clocks, no
 * allocation beyond the per-sender map entries — so it composes trivially
 * under any number of concurrent senders.
 */
export class AntiReplayTracker {
  /**
   * Highest sequence number applied per sender id. `undefined` (absent key)
   * means "no message observed from this sender yet".
   */
  private readonly highWaterMarks: Map<string, number> = new Map();

  /**
   * Returns `true` when `seq` has already been applied (or is older than the
   * last applied) for `senderId`, i.e. the message is a duplicate/replay that
   * must be dropped. A sender unseen until now is always accepted.
   *
   * Precondition: `seq` is a non-negative integer (callers validate shape
   * before reaching here).
   */
  isReplay(senderId: string, seq: number): boolean {
    const last = this.highWaterMarks.get(senderId);
    if (last === undefined) {
      return false;
    }
    return seq <= last;
  }

  /**
   * Record the high-water mark for `senderId` as `max(current, seq)`. Called
   * on every accepted message so the stream stays monotonic.
   */
  markApplied(senderId: string, seq: number): void {
    const last = this.highWaterMarks.get(senderId) ?? -1;
    if (seq > last) {
      this.highWaterMarks.set(senderId, seq);
    }
  }

  /**
   * Advance the high-water mark for `senderId` to at least `seq` WITHOUT
   * accepting a message. Used when a full `game-state-sync` reconciliation
   * snapshot (e.g. post host-migration #946) carries `lastSeq`: the receiver
   * jumps its tracker forward so any queued / re-emitted action with
   * `seq <= lastSeq` is rejected as a replay. `max` is used so a duplicate
   * delivery of the snapshot itself is still rejected by {@link isReplay}.
   */
  advanceTo(senderId: string, seq: number): void {
    if (!Number.isFinite(seq) || seq < 0) {
      return;
    }
    const last = this.highWaterMarks.get(senderId) ?? -1;
    if (seq > last) {
      this.highWaterMarks.set(senderId, seq);
    }
  }

  /**
   * Highest seq applied from `senderId`, or `null` if no message has been seen
   * from that sender. Exposed for diagnostics and tests.
   */
  getLastApplied(senderId: string): number | null {
    const v = this.highWaterMarks.get(senderId);
    return v === undefined ? null : v;
  }

  /**
   * Reset the high-water mark for a sender (e.g. when starting a fresh session
   * or recovering from a known-clean state). Idempotent.
   */
  resetSender(senderId: string): void {
    this.highWaterMarks.delete(senderId);
  }

  /** Number of senders currently tracked. */
  get trackedSenderCount(): number {
    return this.highWaterMarks.size;
  }

  /** Drop all per-sender tracking (e.g. on session teardown). */
  clear(): void {
    this.highWaterMarks.clear();
  }
}
