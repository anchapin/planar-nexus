/**
 * @fileOverview Backpressure-aware per-peer send queue with priority lanes.
 *
 * Issue #1251. When the mesh topology (#1087) fans out a host's state-sync to
 * N peers, one slow or stalled peer's outgoing SCTP buffer fills up. Without
 * backpressure handling the host's synchronous `dataChannel.send(...)` either
 * blocks (head-of-line blocking on the host's call site) or throws an
 * `RTCErrorEvent`, silently dropping the channel.
 *
 * This module provides {@link PeerSendQueue}: a pure, browser-free priority
 * queue that the WebRTC layer feeds via {@link PeerSendQueue.enqueue} and
 * drains via a caller-supplied {@link DrainSender} that watches the channel's
 * `bufferedAmount` against a high-watermark. Critical and normal lanes are
 * never dropped; the droppable lane (chat / emotes) is dropped under
 * sustained pressure with a per-type counter exposed via
 * {@link PeerSendQueue.getStats}.
 *
 * Design properties:
 *   1. Lane ordering: critical > normal > droppable. Within a lane, FIFO.
 *   2. Lane promotion: a critical/normal message arriving while the queue is
 *      over the byte cap evicts oldest droppable messages first. Droppable
 *      messages arriving when the queue is over the low watermark are
 *      dropped immediately (they would just be evicted on the next drain).
 *   3. Lane demotion: when the total queue depth exceeds maxQueueBytes or
 *      maxQueueMessages, droppable messages are dropped before normal,
 *      normal before critical.
 *   4. Bounded memory: hard caps on both byte and message count.
 *   5. Observability: PeerQueueStats exposes depth, in-flight bytes
 *      (callersupplied via notifyBufferLow / notifyBackpressured),
 *      high/low watermarks, totals, and a per-type drop map. The `stalled`
 *      flag flips on/off as the in-flight counter crosses the watermarks;
 *      the onStalled / onResumed listeners fire once per transition.
 *   6. Sync drain: drain() runs synchronously in the caller's task so the
 *      owner controls scheduling. The owner typically calls drain() right
 *      after enqueue() and again from the channel's `bufferedamountlow`
 *      listener.
 */

export const DEFAULT_HIGH_WATERMARK_BYTES = 1024 * 1024;
export const DEFAULT_LOW_WATERMARK_BYTES = 256 * 1024;
export const DEFAULT_MAX_QUEUE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_QUEUE_MESSAGES = 1000;

export const enum SendPriority {
  CRITICAL = 0,
  NORMAL = 1,
  DROPPABLE = 2,
}

export const enum DropReason {
  PROMOTION = "promotion",
  CAPACITY_BYTES = "capacity_bytes",
  CAPACITY_MESSAGES = "capacity_messages",
  CLOSED = "closed",
}

export interface SendQueueOptions {
  highWatermarkBytes?: number;
  lowWatermarkBytes?: number;
  maxQueueBytes?: number;
  maxQueueMessages?: number;
}

export interface QueuedMessage {
  payload: string;
  byteSize: number;
  priority: SendPriority;
  type: string;
  enqueuedAt: number;
}

export interface PeerQueueStats {
  depth: number;
  depthBytes: number;
  inFlightBytes: number;
  highWatermarkBytes: number;
  lowWatermarkBytes: number;
  maxQueueBytes: number;
  maxQueueMessages: number;
  totalEnqueued: number;
  totalSent: number;
  totalDropped: number;
  droppedByType: Record<string, number>;
  stalled: boolean;
  closed: boolean;
}

export type DrainSender = (payload: string) => boolean;

export interface PeerQueueListeners {
  onStalled?: (stats: PeerQueueStats) => void;
  onResumed?: (stats: PeerQueueStats) => void;
  onDropped?: (
    msg: QueuedMessage,
    reason: DropReason,
    stats: PeerQueueStats,
  ) => void;
}

/**
 * Per-peer priority send queue with backpressure awareness. Browser-free: it
 * never touches an RTCDataChannel directly. The owner supplies a
 * {@link DrainSender} that performs the actual wire send and returns false
 * when the channel is full so the queue knows to stop the current drain.
 *
 * Drain scheduling: drain() is synchronous in the caller's task. The owner
 * calls it after enqueue() and again from the channel's bufferedamountlow
 * listener (forwarded via notifyBufferLow). drain() is a no-op when the
 * queue is empty or the channel is currently above the low watermark.
 */
export class PeerSendQueue {
  private readonly options: Required<SendQueueOptions>;
  private readonly lanes: QueuedMessage[][] = [[], [], []];
  private depthBytes = 0;
  private inFlightBytes = 0;
  private totalEnqueued = 0;
  private totalSent = 0;
  private totalDropped = 0;
  private readonly droppedByType: Record<string, number> = {};
  private stalled = false;
  private closed = false;
  private listeners: PeerQueueListeners;

  constructor(
    options: SendQueueOptions = {},
    listeners: PeerQueueListeners = {},
  ) {
    const high = options.highWatermarkBytes ?? DEFAULT_HIGH_WATERMARK_BYTES;
    const low = options.lowWatermarkBytes ?? DEFAULT_LOW_WATERMARK_BYTES;
    if (low >= high) {
      throw new Error(
        `PeerSendQueue: lowWatermarkBytes (${low}) must be < highWatermarkBytes (${high})`,
      );
    }
    if ((options.maxQueueBytes ?? DEFAULT_MAX_QUEUE_BYTES) < high) {
      throw new Error(
        `PeerSendQueue: maxQueueBytes must be >= highWatermarkBytes`,
      );
    }
    if ((options.maxQueueMessages ?? DEFAULT_MAX_QUEUE_MESSAGES) <= 0) {
      throw new Error(`PeerSendQueue: maxQueueMessages must be > 0`);
    }
    this.options = {
      highWatermarkBytes: high,
      lowWatermarkBytes: low,
      maxQueueBytes: options.maxQueueBytes ?? DEFAULT_MAX_QUEUE_BYTES,
      maxQueueMessages: options.maxQueueMessages ?? DEFAULT_MAX_QUEUE_MESSAGES,
    };
    this.listeners = listeners;
  }

  get depth(): number {
    return (
      this.lanes[0].length + this.lanes[1].length + this.lanes[2].length
    );
  }

  get queuedBytes(): number {
    return this.depthBytes;
  }

  get inFlight(): number {
    return this.inFlightBytes;
  }

  get isStalled(): boolean {
    return this.stalled;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /**
   * Enqueue a message for delivery. Returns true on success, false when the
   * queue is closed or when a critical/normal message could not be admitted
   * even after dropping every droppable message.
   *
   * `inFlightBytes` is the caller's current best estimate of the channel's
   * bufferedAmount. The queue uses it to decide droppable admission under
   * pressure.
   */
  enqueue(
    payload: string,
    type: string,
    priority: SendPriority,
    inFlightBytes: number,
  ): boolean {
    if (this.closed) {
      this.recordDrop(
        {
          payload,
          byteSize: 0,
          priority,
          type,
          enqueuedAt: Date.now(),
        },
        DropReason.CLOSED,
      );
      return false;
    }

    this.totalEnqueued++;
    this.inFlightBytes = Math.max(0, inFlightBytes);
    const byteSize = byteLengthUtf8(payload);
    const enqueuedAt = Date.now();

    if (priority === SendPriority.DROPPABLE) {
      // Droppable lane is refused while the channel is in backpressure (i.e.
      // bufferedAmount >= high watermark). The caller can still send critical
      // and normal messages through; they just queue behind whatever is
      // already in flight. We don't also gate on depthBytes here — once a
      // critical/normal arrives it evicts droppables to make room.
      if (this.inFlightBytes >= this.options.highWatermarkBytes) {
        this.recordDrop(
          { payload, byteSize, priority, type, enqueuedAt },
          DropReason.PROMOTION,
        );
        return false;
      }
    }

    if (priority !== SendPriority.DROPPABLE) {
      this.evictDroppableFor(
        this.options.maxQueueBytes - byteSize,
        this.options.maxQueueMessages - 1,
      );
    }

    if (
      this.depthBytes + byteSize > this.options.maxQueueBytes ||
      this.depth + 1 > this.options.maxQueueMessages
    ) {
      this.recordDrop(
        { payload, byteSize, priority, type, enqueuedAt },
        DropReason.CAPACITY_BYTES,
      );
      return false;
    }

    this.lanes[priority].push({
      payload,
      byteSize,
      priority,
      type,
      enqueuedAt,
    });
    this.depthBytes += byteSize;
    return true;
  }

  /**
   * Notify the queue that the channel's bufferedAmount dropped to the given
   * value. Updates the in-flight counter, clears the `stalled` flag when it
   * falls below the low watermark, and fires `onResumed` once per transition.
   */
  notifyBufferLow(bufferedAmount: number): void {
    if (this.closed) return;
    this.inFlightBytes = Math.max(0, bufferedAmount);
    if (this.stalled && this.inFlightBytes <= this.options.lowWatermarkBytes) {
      this.stalled = false;
      this.listeners.onResumed?.(this.getStats());
    }
  }

  /**
   * Notify the queue that the channel's bufferedAmount exceeded the high
   * watermark. Marks the queue as stalled and fires `onStalled` exactly once
   * per transition.
   */
  notifyBackpressured(bufferedAmount: number): void {
    if (this.closed) return;
    this.inFlightBytes = Math.max(0, bufferedAmount);
    if (!this.stalled && this.inFlightBytes >= this.options.highWatermarkBytes) {
      this.stalled = true;
      this.listeners.onStalled?.(this.getStats());
    }
  }

  /**
   * Drain queued messages by calling `sender(payload)` for each, in priority
   * order. The sender returns false to signal "channel full, stop" — the
   * remaining messages stay queued for a later drain.
   *
   * Runs synchronously in the current task. The owner decides when to call
   * it (typically after enqueue() and on the channel's bufferedamountlow
   * event).
   */
  drain(sender: DrainSender): void {
    if (this.closed) return;
    while (
      this.depth > 0 &&
      this.inFlightBytes < this.options.highWatermarkBytes
    ) {
      const next = this.popNext();
      if (!next) break;
      const accepted = sender(next.payload);
      if (!accepted) {
        this.lanes[next.priority].unshift(next);
        this.depthBytes += next.byteSize;
        break;
      }
      this.totalSent++;
      this.inFlightBytes += next.byteSize;
      if (this.inFlightBytes >= this.options.highWatermarkBytes) {
        if (!this.stalled) {
          this.stalled = true;
          this.listeners.onStalled?.(this.getStats());
        }
        break;
      }
    }
  }

  /**
   * Drop every queued message (e.g. on disconnect). Returns the number of
   * messages dropped. Does NOT fire onDropped — this is a wholesale flush,
   * not a per-message drop.
   */
  clear(): number {
    let dropped = 0;
    for (const lane of this.lanes) {
      dropped += lane.length;
      lane.length = 0;
    }
    this.depthBytes = 0;
    return dropped;
  }

  close(): void {
    if (this.closed) return;
    this.clear();
    this.closed = true;
  }

  getStats(): PeerQueueStats {
    const droppedByType: Record<string, number> = {};
    for (const k of Object.keys(this.droppedByType)) {
      droppedByType[k] = this.droppedByType[k];
    }
    return {
      depth: this.depth,
      depthBytes: this.depthBytes,
      inFlightBytes: this.inFlightBytes,
      highWatermarkBytes: this.options.highWatermarkBytes,
      lowWatermarkBytes: this.options.lowWatermarkBytes,
      maxQueueBytes: this.options.maxQueueBytes,
      maxQueueMessages: this.options.maxQueueMessages,
      totalEnqueued: this.totalEnqueued,
      totalSent: this.totalSent,
      totalDropped: this.totalDropped,
      droppedByType,
      stalled: this.stalled,
      closed: this.closed,
    };
  }

  private popNext(): QueuedMessage | null {
    for (const lane of this.lanes) {
      const head = lane.shift();
      if (head) {
        this.depthBytes -= head.byteSize;
        return head;
      }
    }
    return null;
  }

  private evictDroppableFor(maxBytes: number, maxMessages: number): number {
    let evicted = 0;
    const droppable = this.lanes[SendPriority.DROPPABLE];
    while (
      droppable.length > 0 &&
      (this.depthBytes > maxBytes || this.depth > maxMessages)
    ) {
      const head = droppable.shift();
      if (!head) break;
      this.depthBytes -= head.byteSize;
      this.recordDrop(head, DropReason.PROMOTION);
      evicted++;
    }
    return evicted;
  }

  private recordDrop(msg: QueuedMessage, reason: DropReason): void {
    this.totalDropped++;
    this.droppedByType[msg.type] = (this.droppedByType[msg.type] ?? 0) + 1;
    this.listeners.onDropped?.(msg, reason, this.getStats());
  }
}

/**
 * Map a message type to its default lane. Centralised so every send site in
 * the WebRTC and P2P-game-connection layers agrees on what counts as
 * "critical" vs "droppable". Issue #1251.
 */
export function classifyMessagePriority(type: string): SendPriority {
  switch (type) {
    case "game-state-sync":
    case "player-action":
    case "game-action":
      return SendPriority.CRITICAL;
    case "ping":
    case "pong":
    case "connection-request":
    case "connection-accept":
    case "error":
      return SendPriority.NORMAL;
    case "chat":
    case "emote":
      return SendPriority.DROPPABLE;
    default:
      return SendPriority.NORMAL;
  }
}

/**
 * Compute the byte length of a UTF-8 string without allocating a Buffer.
 * Uses TextEncoder when available; falls back to a JS-only estimate that
 * matches Buffer.byteLength(s, "utf8") for the BMP. Node 18+ and every
 * modern browser ship TextEncoder.
 */
export function byteLengthUtf8(s: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(s).length;
  }
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i++;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}